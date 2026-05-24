import { Alert } from "../../models/alert";
import { JobCard } from "../../models/jobCard";
import { StageDefinition } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";
import { buildRequirementsTable } from "../inventory/requirementsService";
import type { AlertSeverity, AlertType } from "../../types";
import { detectAnomalies } from "./anomalyDetector";

/** How much past `expectedDurationHours` is considered "stuck" / "severely stuck". */
const STUCK_MULTIPLIER = 2.0;
const SEVERELY_STUCK_MULTIPLIER = 3.0;

/** Once an order is overdue by this many days and still not completed → ZOMBIE. */
const ZOMBIE_DAYS = 7;

interface AlertCandidate {
  type: AlertType;
  severity: AlertSeverity;
  subjectType: "jobCard" | "order" | "stage" | "cell" | "diamond";
  subjectId: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface AlertRunSummary {
  scanned: number;
  raised: number;
  skipped: number;
  raisedTypes: Record<string, number>;
}

/**
 * Run all currently-implemented alert rules across the open JobCards.
 *
 * Idempotency: each rule keys an alert by `(type, subjectType, subjectId)`.
 * If an open (unresolved) alert with that key already exists, we don't raise
 * a duplicate. If one was previously resolved and the condition fires again,
 * we raise a fresh alert.
 *
 * This is intentionally a single-shot scan that re-evaluates everything from
 * the current DB state — safe to call from the WIP importer or a periodic cron.
 */
export async function runAlertRules(): Promise<AlertRunSummary> {
  const now = new Date();

  // Stages → expectedDurationHours (active only)
  const stages = await StageDefinition.find({ active: true });
  const expectedHoursByStage = new Map<string, number>();
  for (const s of stages) expectedHoursByStage.set(s.code, s.expectedDurationHours);
  const stageOrderByCode = new Map<string, number>();
  for (const s of stages) stageOrderByCode.set(s.code, s.displayOrder);

  // Consider all JobCards not yet completed/cancelled.
  const openJobCards = await JobCard.find({
    status: { $in: ["planned", "in_progress", "on_hold"] },
  });

  const candidates: AlertCandidate[] = [];

  for (const jc of openJobCards) {
    // ───── PIECE_STUCK / PIECE_SEVERELY_STUCK ─────
    // For each open StageMovement on this JobCard, check time-in-stage.
    const openMovs = await StageMovement.find({
      jobCardId: jc._id,
      exitedAt: { $exists: false },
    });
    for (const mv of openMovs) {
      const expected = expectedHoursByStage.get(mv.toStageCode);
      if (expected == null || expected <= 0) continue;
      const hoursInStage = (now.getTime() - mv.enteredAt.getTime()) / 3_600_000;
      const ratio = hoursInStage / expected;
      if (ratio >= SEVERELY_STUCK_MULTIPLIER) {
        candidates.push({
          type: "PIECE_SEVERELY_STUCK",
          severity: "critical",
          subjectType: "jobCard",
          subjectId: jc.gatiPieceCode,
          message: `Piece ${jc.gatiPieceCode} stuck at ${mv.toStageCode} for ${Math.round(hoursInStage)}h (expected ${expected}h, ratio ${ratio.toFixed(1)}×)`,
          payload: {
            stageCode: mv.toStageCode,
            cellCode: mv.cellCode,
            hoursInStage,
            expectedHours: expected,
            ratio,
            enteredAt: mv.enteredAt,
          },
        });
      } else if (ratio >= STUCK_MULTIPLIER) {
        candidates.push({
          type: "PIECE_STUCK",
          severity: "warning",
          subjectType: "jobCard",
          subjectId: jc.gatiPieceCode,
          message: `Piece ${jc.gatiPieceCode} at ${mv.toStageCode} for ${Math.round(hoursInStage)}h (expected ${expected}h, ratio ${ratio.toFixed(1)}×)`,
          payload: {
            stageCode: mv.toStageCode,
            cellCode: mv.cellCode,
            hoursInStage,
            expectedHours: expected,
            ratio,
            enteredAt: mv.enteredAt,
          },
        });
      }
    }

    // ───── DELIVERY_OVERDUE / ZOMBIE_ORDER ─────
    if (jc.expectedDeliveryAt) {
      const daysOverdue = (now.getTime() - jc.expectedDeliveryAt.getTime()) / 86_400_000;
      if (daysOverdue > 0) {
        candidates.push({
          type: "DELIVERY_OVERDUE",
          severity: "critical",
          subjectType: "jobCard",
          subjectId: jc.gatiPieceCode,
          message: `Piece ${jc.gatiPieceCode} overdue by ${Math.round(daysOverdue)}d (expected ${jc.expectedDeliveryAt.toISOString().slice(0, 10)})`,
          payload: { expectedDeliveryAt: jc.expectedDeliveryAt, daysOverdue },
        });
        if (daysOverdue >= ZOMBIE_DAYS) {
          candidates.push({
            type: "ZOMBIE_ORDER",
            severity: "warning",
            subjectType: "jobCard",
            subjectId: jc.gatiPieceCode,
            message: `Piece ${jc.gatiPieceCode} is a zombie order — overdue ${Math.round(daysOverdue)}d and still not completed`,
            payload: { expectedDeliveryAt: jc.expectedDeliveryAt, daysOverdue },
          });
        }
      }
    }

    // ───── QC_REWORK ─────
    // Look at the JobCard's last two distinct (closed) movements: if the most
    // recent open or last-closed movement is at a *lower* displayOrder than the
    // previous movement, the piece moved backwards → rework.
    const recentMovs = await StageMovement.find({ jobCardId: jc._id })
      .sort({ enteredAt: -1 })
      .limit(5);
    if (recentMovs.length >= 2) {
      const latest = recentMovs[0];
      const previous = recentMovs[1];
      const latestOrder = stageOrderByCode.get(latest.toStageCode);
      const previousOrder = stageOrderByCode.get(previous.toStageCode);
      if (
        latestOrder != null &&
        previousOrder != null &&
        latestOrder < previousOrder
      ) {
        candidates.push({
          type: "QC_REWORK",
          severity: "info",
          subjectType: "jobCard",
          subjectId: jc.gatiPieceCode,
          message: `Piece ${jc.gatiPieceCode} moved backwards from ${previous.toStageCode} → ${latest.toStageCode} (likely rework)`,
          payload: {
            previousStage: previous.toStageCode,
            currentStage: latest.toStageCode,
            previousOrder,
            currentOrder: latestOrder,
            atMovementId: latest._id,
          },
        });
      }
    }
  }

  // ───── DIAMOND SHORTAGES / LOW STOCK ─────
  // One pass across the requirements table.
  try {
    const reqs = await buildRequirementsTable();
    for (const r of reqs) {
      if (r.status === "critical") {
        candidates.push({
          type: "DIAMOND_IMMINENT_SHORTAGE",
          severity: "critical",
          subjectType: "diamond",
          subjectId: r.diamondCode,
          message: `Diamond ${r.diamondCode}: shortage of ${Math.abs(r.delta)} stones; lead time ${r.procurementLeadTimeDays}d exceeds days-until-needed`,
          payload: {
            onHand: r.onHand,
            allocated: r.allocated,
            available: r.available,
            required: r.required,
            delta: r.delta,
            reorderSuggestedQty: r.reorderSuggestedQty,
          },
        });
      } else if (r.status === "shortage") {
        candidates.push({
          type: "DIAMOND_SHORTAGE",
          severity: "critical",
          subjectType: "diamond",
          subjectId: r.diamondCode,
          message: `Diamond ${r.diamondCode}: short by ${Math.abs(r.delta)} stones (need ${r.required}, have ${r.available})`,
          payload: {
            onHand: r.onHand,
            allocated: r.allocated,
            available: r.available,
            required: r.required,
            delta: r.delta,
            reorderSuggestedQty: r.reorderSuggestedQty,
          },
        });
      } else if (r.status === "low") {
        candidates.push({
          type: "DIAMOND_LOW_STOCK",
          severity: "warning",
          subjectType: "diamond",
          subjectId: r.diamondCode,
          message: `Diamond ${r.diamondCode}: available ${r.available} below reorder threshold ${r.reorderThreshold}`,
          payload: {
            onHand: r.onHand,
            allocated: r.allocated,
            available: r.available,
            reorderThreshold: r.reorderThreshold,
          },
        });
      }
    }
  } catch (err) {
    // Inventory not yet seeded → skip silently.
    void err;
  }

  // ───── ANOMALY DETECTION (baseline drift, stale stages, loss spikes) ─────
  try {
    const anomaly = await detectAnomalies();
    for (const a of anomaly.candidates) candidates.push(a);
  } catch (err) {
    void err;
  }

  // Persist candidates, skipping duplicates of OPEN alerts (same type+subject).
  let raised = 0;
  let skipped = 0;
  const raisedTypes: Record<string, number> = {};

  for (const c of candidates) {
    const existingOpen = await Alert.findOne({
      type: c.type,
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      resolvedAt: { $exists: false },
    });
    if (existingOpen) {
      skipped++;
      continue;
    }
    await Alert.create({
      type: c.type,
      severity: c.severity,
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      message: c.message,
      payload: c.payload,
      raisedAt: now,
    });
    raised++;
    raisedTypes[c.type] = (raisedTypes[c.type] ?? 0) + 1;
  }

  return {
    scanned: openJobCards.length,
    raised,
    skipped,
    raisedTypes,
  };
}

/** Convenience: synchronously trigger the engine without blocking the caller. */
export function runAlertRulesAsync(): void {
  void runAlertRules().catch((err) => {
    // Best-effort logging — the engine runs as a side-effect of imports, never
    // a critical path. Future Phase 5 polish can wire structured logging.
    // eslint-disable-next-line no-console
    console.error("[alertEngine] runAlertRules failed:", err);
  });
}

/** Resolve an alert (called from the route layer). */
export async function resolveAlert(alertId: string, resolvedBy?: string): Promise<boolean> {
  const update: Record<string, unknown> = { resolvedAt: new Date() };
  if (resolvedBy) update.resolvedBy = resolvedBy;
  const res = await Alert.updateOne(
    { _id: alertId, resolvedAt: { $exists: false } },
    { $set: update }
  );
  return res.modifiedCount === 1;
}

/** Acknowledge an alert (called from the route layer). */
export async function acknowledgeAlert(
  alertId: string,
  acknowledgedBy?: string
): Promise<boolean> {
  const update: Record<string, unknown> = { acknowledgedAt: new Date() };
  if (acknowledgedBy) update.acknowledgedBy = acknowledgedBy;
  const res = await Alert.updateOne(
    { _id: alertId, acknowledgedAt: { $exists: false } },
    { $set: update }
  );
  return res.modifiedCount === 1;
}

/** Used by the JobCard detail view to surface live time-in-stage info. */
export interface StageAgeInfo {
  stageCode: string;
  cellCode: string;
  qty: number;
  hoursInStage: number | null;
  expectedHours: number | null;
  ratio: number | null;
  enteredAt: Date | null;
}
