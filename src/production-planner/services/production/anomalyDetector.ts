import { StageDefinition } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";
import type { AlertSeverity, AlertSubjectType, AlertType } from "../../types";
import { getLossByCell } from "../inventory/materialLossService";

/** Lookback window for "current" performance. */
const CURRENT_WINDOW_DAYS = 7;
/** Window for the "prior" baseline (immediately preceding the current window). */
const PRIOR_WINDOW_DAYS = 30;
/** Drift thresholds — > +20% slower or > -20% faster vs prior. */
const SLOW_THRESHOLD = 1.2;
const FAST_THRESHOLD = 0.8;
/** Material-loss spike: per-cell loss % > LOSS_MULTIPLIER × rolling average. */
const LOSS_MULTIPLIER = 2.0;
/** STAGE_STALE: an active stage with no movement in this many days is suspicious. */
const STALE_DAYS = 5;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface AnomalyCandidate {
  type: AlertType;
  severity: AlertSeverity;
  subjectType: AlertSubjectType;
  subjectId: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface AnomalyRunSummary {
  scannedStages: number;
  candidates: AnomalyCandidate[];
  by: Record<AlertType, number>;
}

/**
 * Run every anomaly rule and return the resulting alert candidates.
 *
 * Pure: does not persist anything. The caller (typically the main `runAlertRules`
 * in alertEngine.ts) is responsible for merging these into the alert pool and
 * applying the (type, subject) idempotency check.
 */
export async function detectAnomalies(): Promise<AnomalyRunSummary> {
  const now = Date.now();
  const candidates: AnomalyCandidate[] = [];

  // ───── BASELINE_DRIFT and STAGE_STALE ─────
  const stages = await StageDefinition.find({ active: true });

  const currentStart = new Date(now - CURRENT_WINDOW_DAYS * DAY_MS);
  const priorEnd = currentStart;
  const priorStart = new Date(priorEnd.getTime() - PRIOR_WINDOW_DAYS * DAY_MS);

  for (const stage of stages) {
    const [current, prior, anyRecent] = await Promise.all([
      avgDurationHoursForStage(stage.code, currentStart, new Date(now)),
      avgDurationHoursForStage(stage.code, priorStart, priorEnd),
      StageMovement.findOne({
        toStageCode: stage.code,
        enteredAt: { $gte: new Date(now - STALE_DAYS * DAY_MS) },
      }).select({ _id: 1 }),
    ]);

    // STAGE_STALE — stage exists & active but hasn't seen any movement in N days.
    if (!anyRecent) {
      candidates.push({
        type: "STAGE_STALE",
        severity: "info",
        subjectType: "stage",
        subjectId: stage.code,
        message: `Stage ${stage.code} has had no movement in the last ${STALE_DAYS} days`,
        payload: { staleDays: STALE_DAYS },
      });
    }

    // Drift requires meaningful samples in both windows.
    if (current && prior && current.sampleSize >= 3 && prior.sampleSize >= 3) {
      const ratio = current.avgHours / prior.avgHours;
      if (ratio >= SLOW_THRESHOLD) {
        candidates.push({
          type: "BASELINE_DRIFT_SLOW",
          severity: "warning",
          subjectType: "stage",
          subjectId: stage.code,
          message: `Stage ${stage.code} ${Math.round((ratio - 1) * 100)}% slower than 30-day baseline (avg ${current.avgHours.toFixed(1)}h vs ${prior.avgHours.toFixed(1)}h)`,
          payload: {
            currentAvgHours: round2(current.avgHours),
            priorAvgHours: round2(prior.avgHours),
            ratio: round2(ratio),
            currentSampleSize: current.sampleSize,
            priorSampleSize: prior.sampleSize,
          },
        });
      } else if (ratio <= FAST_THRESHOLD) {
        candidates.push({
          type: "BASELINE_DRIFT_FAST",
          severity: "info",
          subjectType: "stage",
          subjectId: stage.code,
          message: `Stage ${stage.code} ${Math.round((1 - ratio) * 100)}% faster than baseline (avg ${current.avgHours.toFixed(1)}h vs ${prior.avgHours.toFixed(1)}h) — verify data quality`,
          payload: {
            currentAvgHours: round2(current.avgHours),
            priorAvgHours: round2(prior.avgHours),
            ratio: round2(ratio),
            currentSampleSize: current.sampleSize,
            priorSampleSize: prior.sampleSize,
          },
        });
      }
    }
  }

  // ───── MATERIAL_LOSS_SPIKE per cell ─────
  try {
    const currentLoss = await getLossByCell({ from: currentStart });
    const priorLoss = await getLossByCell({ from: priorStart, to: priorEnd });
    const priorByCell = new Map(priorLoss.map((r) => [r.cellCode, r.goldLossPct]));

    for (const c of currentLoss) {
      const priorPct = priorByCell.get(c.cellCode) ?? 0;
      if (priorPct > 0 && c.goldLossPct > priorPct * LOSS_MULTIPLIER && c.goldLossPct > 1) {
        candidates.push({
          type: "MATERIAL_LOSS_SPIKE",
          severity: "warning",
          subjectType: "cell",
          subjectId: c.cellCode,
          message: `Cell ${c.cellCode} gold loss ${c.goldLossPct}% — ${Math.round(c.goldLossPct / priorPct)}× the 30-day baseline of ${priorPct}%`,
          payload: {
            currentLossPct: c.goldLossPct,
            priorLossPct: priorPct,
            multiplier: round2(c.goldLossPct / priorPct),
            currentTotalIn: c.totalIn,
            currentGoldLoss: c.goldLoss,
          },
        });
      }
    }
  } catch (err) {
    void err;
  }

  const by: Record<string, number> = {};
  for (const c of candidates) by[c.type] = (by[c.type] ?? 0) + 1;

  return {
    scannedStages: stages.length,
    candidates,
    by: by as Record<AlertType, number>,
  };
}

interface StageDurationStats {
  avgHours: number;
  sampleSize: number;
  totalQty: number;
}

/**
 * Mean closed-movement duration for a stage in a given window, weighted by qty.
 * Returns null if no qualifying movements were found.
 */
async function avgDurationHoursForStage(
  stageCode: string,
  from: Date,
  to: Date
): Promise<StageDurationStats | null> {
  const rows = await StageMovement.aggregate<{
    weightedSum: number;
    qty: number;
    count: number;
  }>([
    {
      $match: {
        toStageCode: stageCode,
        exitedAt: { $gte: from, $lte: to },
        durationHours: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        weightedSum: { $sum: { $multiply: ["$qty", "$durationHours"] } },
        qty: { $sum: "$qty" },
        count: { $sum: 1 },
      },
    },
  ]);

  if (rows.length === 0 || rows[0].qty <= 0) return null;
  return {
    avgHours: rows[0].weightedSum / rows[0].qty,
    sampleSize: rows[0].count,
    totalQty: rows[0].qty,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const ANOMALY_CONSTANTS = {
  CURRENT_WINDOW_DAYS,
  PRIOR_WINDOW_DAYS,
  SLOW_THRESHOLD,
  FAST_THRESHOLD,
  LOSS_MULTIPLIER,
  STALE_DAYS,
  HOUR_MS,
};
