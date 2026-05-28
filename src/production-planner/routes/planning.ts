import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  buildStageQueues,
  getCurrentBottlenecks,
  getMonthLoadPct,
  recomputeBaselines,
} from "../services/production/capacityService";
import { planNewOrder, type OrderSpec } from "../services/production/planningService";
import { PRIORITY_LEVELS, type PriorityLevel } from "../types";

const router = Router();

function asNumber(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim()) {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asDate(x: unknown): Date | undefined {
  if (typeof x !== "string") return undefined;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function asStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function asPriority(x: unknown): PriorityLevel | undefined {
  if (typeof x !== "string") return undefined;
  return (PRIORITY_LEVELS as readonly string[]).includes(x) ? (x as PriorityLevel) : undefined;
}

/**
 * GET /dashboards/capacity — per-stage queue + capacity + current bottlenecks.
 */
router.get("/dashboards/capacity", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const [stages, bottlenecks, monthLoad] = await Promise.all([
      buildStageQueues(),
      getCurrentBottlenecks(3),
      getMonthLoadPct(),
    ]);
    return res.status(200).json({
      stages,
      bottlenecks,
      monthLoad,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /planning/baselines/recompute — manually re-run the nightly job that
 * builds rolling baselines from real StageMovement data. Useful as a "Refresh"
 * button on the Capacity Dashboard.
 */
router.post(
  "/planning/baselines/recompute",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    try {
      const baselines = await recomputeBaselines();
      return res.status(200).json({ baselines });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /planning/check — Capacity check for a hypothetical new order.
 *
 * Body (OrderSpec):
 *   { totalQty, totalStones?, totalGrams?, requiresStages?[], excludeStages?[],
 *     expectedDeliveryAt?, priority? }
 */
router.post("/planning/check", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const spec = (body.orderSpec ?? body) as Record<string, unknown>;

  const totalQty = asNumber(spec.totalQty);
  if (totalQty == null || totalQty <= 0) {
    return res.status(400).json({ error: "orderSpec.totalQty (positive number) is required" });
  }

  const orderSpec: OrderSpec = {
    totalQty,
    totalStones: asNumber(spec.totalStones),
    totalGrams: asNumber(spec.totalGrams),
    requiresStages: asStringArray(spec.requiresStages)?.map((s) => s.toUpperCase()),
    excludeStages: asStringArray(spec.excludeStages)?.map((s) => s.toUpperCase()),
    expectedDeliveryAt: asDate(spec.expectedDeliveryAt),
    priority: asPriority(spec.priority),
  };

  try {
    const plan = await planNewOrder(orderSpec);
    return res.status(200).json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(400).json({ error: message });
  }
});

/**
 * GET /planning/lead-time — quick lead-time estimate (no delivery comparison).
 * Convenience wrapper around /planning/check using query params.
 */
router.get("/planning/lead-time", requireAuth, requireRole("admin"), async (req, res) => {
  const totalQty = asNumber(req.query.totalQty);
  if (totalQty == null || totalQty <= 0) {
    return res.status(400).json({ error: "totalQty is required" });
  }
  try {
    const plan = await planNewOrder({
      totalQty,
      totalStones: asNumber(req.query.totalStones),
      totalGrams: asNumber(req.query.totalGrams),
      priority: asPriority(req.query.priority),
    });
    return res.status(200).json({
      leadTimeDays: plan.leadTimeDays,
      estimatedCompletionAt: plan.estimatedCompletionAt,
      bottleneckStage: plan.bottleneckStage,
      capacityStatus: plan.capacityStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(400).json({ error: message });
  }
});

export default router;
