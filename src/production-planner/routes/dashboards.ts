import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { JobCard, type JobCardDocument } from "../models/jobCard";
import { StageDefinition } from "../models/stageDefinition";
import { getAnalyticsSnapshot } from "../services/production/analyticsService";
import type { StageDistributionEntry } from "../types";

const router = Router();

/**
 * Guard: return `undefined` for nullish, invalid, or unreasonably old dates
 * (before year 2000 — catches bad imports like 1970-01-01).
 */
function sanitizeDate(d: Date | null | undefined): Date | undefined {
  if (d == null) return undefined;
  if (!Number.isFinite(d.getTime())) return undefined;
  if (d.getFullYear() < 2000) return undefined;
  return d;
}

function asString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function asDate(x: unknown): Date | undefined {
  if (typeof x !== "string") return undefined;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

interface OrderRollup {
  orderNumber: string;
  customerCode?: string;
  expectedDeliveryAt?: Date;
  totalPieces: number;
  totalQty: number;
  completedCount: number;
  inProgressCount: number;
  onHoldCount: number;
  plannedCount: number;
  delayedCount: number;
  worstLatenessDays: number;
  stageDistribution: { stageCode: string; cellCode: string; qty: number }[];
  priority: "normal" | "urgent" | "critical";
  status: "planned" | "in_progress" | "on_hold" | "completed";
}

function rollupOneOrder(jobCards: JobCardDocument[]): OrderRollup {
  const first = jobCards[0];
  const orderNumber = first.orderNumber;
  const now = new Date();

  let totalQty = 0;
  let completed = 0;
  let inProgress = 0;
  let onHold = 0;
  let planned = 0;
  let delayed = 0;
  let worstLatenessDays = 0;
  let earliestDelivery: Date | undefined;
  let priority: OrderRollup["priority"] = "normal";

  const distMap = new Map<string, StageDistributionEntry>();

  for (const jc of jobCards) {
    totalQty += jc.totalQty ?? 0;
    if (jc.status === "completed") completed++;
    else if (jc.status === "in_progress") inProgress++;
    else if (jc.status === "on_hold") onHold++;
    else if (jc.status === "planned") planned++;

    const delDate = sanitizeDate(jc.expectedDeliveryAt);
    if (delDate) {
      if (!earliestDelivery || delDate < earliestDelivery) {
        earliestDelivery = delDate;
      }
      const days = (now.getTime() - delDate.getTime()) / 86_400_000;
      if (days > 0 && jc.status !== "completed") {
        delayed++;
        if (days > worstLatenessDays) worstLatenessDays = days;
      }
    }

    // Roll up the stage distribution across all the order's JobCards.
    for (const e of jc.currentStageDistribution ?? []) {
      const key = `${e.stageCode}|${e.cellCode}`;
      const existing = distMap.get(key);
      if (existing) existing.qty += e.qty;
      else distMap.set(key, { stageCode: e.stageCode, cellCode: e.cellCode, qty: e.qty });
    }

    // Order priority = highest of any of its pieces (normal < urgent < critical).
    if (jc.priority === "critical") priority = "critical";
    else if (jc.priority === "urgent" && priority !== "critical") priority = "urgent";
  }

  let status: OrderRollup["status"];
  if (jobCards.every((j) => j.status === "completed")) status = "completed";
  else if (jobCards.some((j) => j.status === "on_hold")) status = "on_hold";
  else if (jobCards.some((j) => j.status === "in_progress")) status = "in_progress";
  else status = "planned";

  return {
    orderNumber,
    customerCode: first.customerCode,
    expectedDeliveryAt: earliestDelivery,
    totalPieces: jobCards.length,
    totalQty,
    completedCount: completed,
    inProgressCount: inProgress,
    onHoldCount: onHold,
    plannedCount: planned,
    delayedCount: delayed,
    worstLatenessDays: Math.round(worstLatenessDays * 10) / 10,
    stageDistribution: Array.from(distMap.values()).sort((a, b) =>
      a.stageCode.localeCompare(b.stageCode)
    ),
    priority,
    status,
  };
}

/**
 * GET /dashboards/orders — order-grouped tracking (primary tracking view).
 *
 * Returns one row per `OrderNoWithoutSrNo` with a rolled-up summary of every
 * line item (JobCard) in that order.
 */
router.get("/dashboards/orders", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};

    const status = asString(req.query.status);
    const customerCode = asString(req.query.customerCode);
    const priority = asString(req.query.priority);
    const deliveryBefore = asDate(req.query.deliveryBefore);
    const isLate = req.query.isLate === "true" || req.query.isLate === "1";
    const search = asString(req.query.search);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    if (customerCode) filter.customerCode = customerCode;
    if (priority) filter.priority = priority;
    if (status && status !== "all") filter.status = status;
    if (deliveryBefore) filter.expectedDeliveryAt = { $lte: deliveryBefore };
    if (isLate) {
      filter.expectedDeliveryAt = { ...((filter.expectedDeliveryAt as object | undefined) ?? {}), $lt: new Date() };
      filter.status = { $nin: ["completed", "cancelled"] };
    }
    // search matches against orderNumber or customerCode (case-insensitive)
    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { customerCode: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch all matching JobCards; group by orderNumber in-memory.
    // For very large datasets this should move to a $group aggregation; the
    // current scale (≤ a few thousand open pieces) is fine.
    const jobCards = await JobCard.find(filter).sort({ orderNumber: 1, orderItemSrNo: 1 });

    const byOrder = new Map<string, JobCardDocument[]>();
    for (const jc of jobCards) {
      const list = byOrder.get(jc.orderNumber) ?? [];
      list.push(jc);
      byOrder.set(jc.orderNumber, list);
    }

    const rollups: OrderRollup[] = [];
    for (const list of byOrder.values()) rollups.push(rollupOneOrder(list));

    rollups.sort((a, b) => {
      const ad = a.expectedDeliveryAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bd = b.expectedDeliveryAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    });

    const total = rollups.length;
    const paged = rollups.slice(skip, skip + limit);

    return res.status(200).json({ items: paged, total });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /dashboards/orders/:orderNumber — drill-in for one order.
 *
 * Returns the order header rollup PLUS the full list of JobCards in the order
 * with their current `currentStageDistribution`, lateness, and time-in-stage.
 */
router.get(
  "/dashboards/orders/:orderNumber",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const orderNumber = decodeURIComponent(String(req.params.orderNumber));
      const jobCards = await JobCard.find({ orderNumber }).sort({ orderItemSrNo: 1 });
      if (jobCards.length === 0) return res.status(404).json({ error: "Order not found" });

      const rollup = rollupOneOrder(jobCards);

      const now = new Date();
      const stages = await StageDefinition.find({ active: true });
      const expectedByStage = new Map<string, number>();
      for (const s of stages) expectedByStage.set(s.code, s.expectedDurationHours);

      const pieces = jobCards.map((jc) => {
        const delDate = sanitizeDate(jc.expectedDeliveryAt);
        const latenessDays = delDate
          ? Math.max(0, (now.getTime() - delDate.getTime()) / 86_400_000)
          : 0;
        return {
          gatiPieceCode: jc.gatiPieceCode,
          _id: jc._id,
          orderItemSrNo: jc.orderItemSrNo,
          styleNo: jc.styleNo,
          size: jc.size,
          totalQty: jc.totalQty,
          totalStones: jc.totalStones,
          metalType: jc.metalType,
          status: jc.status,
          priority: jc.priority,
          findingsReceived: jc.findingsReceived,
          expectedDeliveryAt: delDate ?? null,
          currentStageDistribution: jc.currentStageDistribution,
          latenessDays: Math.round(latenessDays * 10) / 10,
          isLate: latenessDays > 0 && jc.status !== "completed",
        };
      });

      return res.status(200).json({ order: rollup, pieces });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * GET /dashboards/analytics?from=&to=
 *
 * On-time delivery %, cycle-time per stage, daily movement trend, anomaly
 * counts, and material-loss summary for the requested date window
 * (default: last 30 days).
 */
router.get("/dashboards/analytics", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snapshot = await getAnalyticsSnapshot({
      from: asDate(req.query.from),
      to: asDate(req.query.to),
    });
    return res.status(200).json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

export default router;
