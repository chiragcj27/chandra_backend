import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Alert } from "../models/alert";
import { computeStageVelocityMap } from "../services/production/etaService";
import { CapacityBaseline } from "../models/capacityBaseline";
import { GatiColumnMap } from "../models/gatiColumnMap";
import { JobCard, type JobCardDocument } from "../models/jobCard";
import { ProductionCalendar } from "../models/productionCalendar";
import { StageDefinition } from "../models/stageDefinition";
import { StageMovement } from "../models/stageMovement";
import { getAnalyticsSnapshot } from "../services/production/analyticsService";
import type { StageDistributionEntry } from "../types";

const DEFAULT_DAILY_HOURS = 9;
const BOTTLENECK_QUEUE_DAYS = 3;

/** Working days left this month (Sun = non-working). */
function workingDaysLeft(): number {
  const now = new Date();
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const end = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let count = 0;
  for (let d = now.getUTCDate(); d <= end; d++) {
    if (new Date(Date.UTC(year, month, d)).getUTCDay() !== 0) count++;
  }
  return Math.max(count, 1);
}

// ── Capacity caching ──────────────────────────────────────────────────────────
interface ConfigCache {
  baselines: { stageCode: string; unitsPerDay: number; sampleSize: number }[];
  stages: { code: string; expectedDurationHours: number }[];
  /** stageCode → number of distinct cell codes */
  stageCells: Map<string, number>;
  dailyHours: number;
}

interface CapacityPayload {
  monthLoadPct: number;
  totalQueueUnits: number;
  monthCapacityUnits: number;
  bottlenecks: { stageCode: string; queueUnits: number; capacityPerDay: number; queueDays: number }[];
}

/**
 * Static config (baselines, stage defs, WIP cell counts, calendar hours).
 * Expires after CONFIG_TTL_MS so pull-to-refresh always gets fresh data.
 * Explicitly invalidated after WIP imports and data resets.
 */
let _configCache: ConfigCache | null = null;
let _configCacheExpiry = 0;
const CONFIG_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Computed capacity result — valid for CAPACITY_TTL_MS.
 * Call invalidateCapacityCache() after a WIP upload to force a refresh.
 */
let _capacityCache: { result: CapacityPayload; expiresAt: number } | null = null;
const CAPACITY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Force-refresh capacity on next request (e.g. after WIP import). */
export function invalidateCapacityCache(): void {
  _capacityCache = null;
}

/** Wipe both caches — call after a full data reset or WIP import. */
export function invalidateAllCaches(): void {
  _capacityCache     = null;
  _configCache       = null;
  _configCacheExpiry = 0;
}

async function loadConfig(): Promise<ConfigCache> {
  if (_configCache && Date.now() < _configCacheExpiry) return _configCache;

  const [baselines, stages, wipMap, calendar] = await Promise.all([
    CapacityBaseline.find({ windowDays: 30 })
      .select({ stageCode: 1, unitsPerDay: 1, sampleSize: 1 })
      .lean(),
    StageDefinition.find({ active: true })
      .select({ code: 1, expectedDurationHours: 1 })
      .lean(),
    GatiColumnMap.findOne({ fileType: "wip", active: true })
      .select({ wipColumns: 1 })
      .lean(),
    ProductionCalendar.findOne({ key: "default" })
      .select({ defaultDailyHours: 1 })
      .lean(),
  ]);

  // Build distinct-cell-count per stage from the WIP column map
  const cellSets = new Map<string, Set<string>>();
  for (const col of (wipMap as { wipColumns?: { stageCode: string; cellCode: string }[] } | null)
    ?.wipColumns ?? []) {
    const s = cellSets.get(col.stageCode) ?? new Set<string>();
    s.add(col.cellCode);
    cellSets.set(col.stageCode, s);
  }
  const stageCells = new Map<string, number>();
  for (const [code, s] of cellSets) stageCells.set(code, s.size);

  _configCache = {
    baselines: baselines as { stageCode: string; unitsPerDay: number; sampleSize: number }[],
    stages: stages as { code: string; expectedDurationHours: number }[],
    stageCells,
    dailyHours:
      (calendar as { defaultDailyHours?: number } | null)?.defaultDailyHours ??
      DEFAULT_DAILY_HOURS,
  };
  _configCacheExpiry = Date.now() + CONFIG_TTL_MS;
  return _configCache;
}

function computeCapacity(cfg: ConfigCache, queueByStage: Map<string, number>): CapacityPayload {
  const baselineMap = new Map(cfg.baselines.map((b) => [b.stageCode, b]));
  const bottlenecks: CapacityPayload["bottlenecks"] = [];
  let tightestQueueDays = 0;
  let tightestQueueUnits = 0;
  let tightestCapacityPerDay = 0;

  for (const stage of cfg.stages) {
    const bl = baselineMap.get(stage.code);
    const unitsPerDay =
      bl && bl.sampleSize > 0
        ? bl.unitsPerDay
        : stage.expectedDurationHours > 0
        ? cfg.dailyHours / stage.expectedDurationHours
        : 0;

    const cells = Math.max(cfg.stageCells.get(stage.code) ?? 0, 1);
    const capacityPerDay = unitsPerDay * cells;
    const queueUnits = queueByStage.get(stage.code) ?? 0;
    const queueDays = capacityPerDay > 0 ? queueUnits / capacityPerDay : 0;

    if (queueDays >= BOTTLENECK_QUEUE_DAYS) {
      bottlenecks.push({
        stageCode: stage.code,
        queueUnits,
        capacityPerDay,
        queueDays: Math.round(queueDays * 10) / 10,
      });
    }
    if (queueDays > tightestQueueDays) {
      tightestQueueDays = queueDays;
      tightestQueueUnits = queueUnits;
      tightestCapacityPerDay = capacityPerDay;
    }
  }

  bottlenecks.sort((a, b) => b.queueDays - a.queueDays);
  const daysLeft = workingDaysLeft();
  const monthCapacityUnits = tightestCapacityPerDay * daysLeft;

  return {
    monthLoadPct:
      monthCapacityUnits > 0
        ? Math.round((tightestQueueUnits / monthCapacityUnits) * 100)
        : 0,
    totalQueueUnits: tightestQueueUnits,
    monthCapacityUnits: Math.round(monthCapacityUnits * 10) / 10,
    bottlenecks: bottlenecks.slice(0, 3),
  };
}

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
  pendingCount: number;
  delayedCount: number;
  worstLatenessDays: number;
  stageDistribution: { stageCode: string; cellCode: string; qty: number }[];
  priority: "normal" | "urgent" | "critical";
  status: string;
}

function rollupOneOrder(jobCards: JobCardDocument[]): OrderRollup {
  const first = jobCards[0];
  const orderNumber = first.orderNumber;
  const now = new Date();

  let totalQty = 0;
  let completed = 0;
  let inProgress = 0;
  let onHold = 0;
  let pending = 0;
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
    else if (jc.status === "pending") pending++;

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

  const PROCEED_STATUSES = new Set([
    "proceed_cancel", "proceed_po", "proceed_stock_assign",
    "proceed_manufacturer", "proceed_pending",
  ]);

  let status: string;
  if (jobCards.every((j) => j.status === "completed")) {
    status = "completed";
  } else if (jobCards.some((j) => j.status === "in_progress")) {
    status = "in_progress";
  } else if (jobCards.some((j) => j.status === "on_hold")) {
    status = "on_hold";
  } else if (jobCards.some((j) => PROCEED_STATUSES.has(j.status))) {
    // Use the specific proceed status — pick most common one if mixed
    const proceedCounts: Record<string, number> = {};
    jobCards.forEach((j) => {
      if (PROCEED_STATUSES.has(j.status)) {
        proceedCounts[j.status] = (proceedCounts[j.status] ?? 0) + 1;
      }
    });
    status = Object.entries(proceedCounts).sort((a, b) => b[1] - a[1])[0][0];
  } else {
    status = "pending";
  }

  return {
    orderNumber,
    customerCode: first.customerCode,
    expectedDeliveryAt: earliestDelivery,
    totalPieces: jobCards.length,
    totalQty,
    completedCount: completed,
    inProgressCount: inProgress,
    onHoldCount: onHold,
    pendingCount: pending,
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
 * GET /dashboards/summary — lightweight dashboard summary.
 *
 * Returns order counts, late-order count, open-alert count + 10 items,
 * and capacity numbers (month-load %, top-3 bottlenecks).
 *
 * Optimizations vs. the naive 8-query approach:
 *  - Static config (baselines / stages / cells / calendar) is cached for the
 *    process lifetime — fetched exactly once after server start.
 *  - The computed capacity result is cached for CAPACITY_TTL_MS (5 min).
 *    On a cache hit only 3 queries run (orders agg + 2 alert queries).
 *  - The order aggregation only scans non-completed/non-cancelled job cards,
 *    skipping potentially thousands of historical documents.
 */
router.get("/dashboards/summary", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const now = new Date();
    const badDateFloor = new Date("2000-01-01");

    // ── Order agg (only open job cards — skips all historical completed docs) ─
    const orderAggP = JobCard.aggregate<{
      open: { n: number }[];
      late: { n: number }[];
    }>([
      { $match: { status: { $nin: ["completed", "cancelled"] } } },
      { $group: { _id: "$orderNumber", minDelivery: { $min: "$expectedDeliveryAt" } } },
      {
        $project: {
          isLate: {
            $and: [
              { $ne:  ["$minDelivery", null]        },
              { $gte: ["$minDelivery", badDateFloor] },
              { $lt:  ["$minDelivery", now]          },
            ],
          },
        },
      },
      {
        $facet: {
          open: [{ $count: "n" }],
          late: [{ $match: { isLate: true } }, { $count: "n" }],
        },
      },
    ]);

    const alertCountP  = Alert.countDocuments({ resolvedAt: { $exists: false } });
    const alertItemsP  = Alert.find({ resolvedAt: { $exists: false } })
      .sort({ severity: 1, raisedAt: -1 })
      .limit(10)
      .lean();

    const useCache = _capacityCache !== null && _capacityCache.expiresAt > Date.now();

    let capacity: CapacityPayload;
    let orderFacet: { open: { n: number }[]; late: { n: number }[] };
    let alertsCount: number;
    let recentAlerts: unknown[];

    if (useCache) {
      // ── Cache hit: only 3 queries ──────────────────────────────────────────
      const [oa, ac, ra] = await Promise.all([orderAggP, alertCountP, alertItemsP]);
      orderFacet  = oa[0] ?? { open: [], late: [] };
      alertsCount = ac;
      recentAlerts = ra;
      capacity    = _capacityCache!.result;
    } else {
      // ── Cache miss: also fetch queue data + static config ─────────────────
      const stageLoadP = JobCard.aggregate<{ _id: string; qty: number }>([
        { $match: { status: { $in: ["pending", "planned", "in_progress", "on_hold"] } } },
        { $unwind: "$currentStageDistribution" },
        {
          $group: {
            _id:  "$currentStageDistribution.stageCode",
            qty:  { $sum: "$currentStageDistribution.qty" },
          },
        },
      ]);

      const [oa, ac, ra, stageLoad, cfg] = await Promise.all([
        orderAggP, alertCountP, alertItemsP, stageLoadP, loadConfig(),
      ]);
      orderFacet  = oa[0] ?? { open: [], late: [] };
      alertsCount = ac;
      recentAlerts = ra;

      const queueByStage = new Map<string, number>(stageLoad.map((r) => [r._id, r.qty]));
      capacity = computeCapacity(cfg, queueByStage);
      _capacityCache = { result: capacity, expiresAt: Date.now() + CAPACITY_TTL_MS };
    }

    return res.status(200).json({
      orders: {
        open: orderFacet.open[0]?.n ?? 0,
        late: orderFacet.late[0]?.n ?? 0,
      },
      capacity,
      alerts: {
        total: alertsCount,
        items: recentAlerts,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /dashboards/capacity — full per-stage capacity breakdown.
 *
 * Used by the dedicated Capacity Dashboard screen. Returns all active stages
 * with their current queue depth and load metrics. Reuses the module-level
 * config cache so baselines/stages/cells/calendar are fetched at most once
 * per process lifetime — only a single stageLoadAgg query runs per request.
 */
router.get("/dashboards/capacity", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const now = new Date();

    const [stageLoad, cfg, velocity, overdueAgg] = await Promise.all([
      JobCard.aggregate<{ _id: string; qty: number }>([
        { $match: { status: { $in: ["pending", "planned", "in_progress", "on_hold"] } } },
        { $unwind: "$currentStageDistribution" },
        {
          $group: {
            _id:  "$currentStageDistribution.stageCode",
            qty:  { $sum: "$currentStageDistribution.qty" },
          },
        },
      ]),
      loadConfig(),
      computeStageVelocityMap(),
      // Count pieces whose time-in-stage has exceeded expectedDurationHours
      StageMovement.aggregate<{ _id: string; count: number; worstRatio: number }>([
        { $match: { exitedAt: { $exists: false } } },
        {
          $lookup: {
            from: "stagedefinitions",
            localField: "toStageCode",
            foreignField: "code",
            as: "stageDef",
          },
        },
        { $unwind: "$stageDef" },
        {
          $addFields: {
            hoursInStage: {
              $divide: [{ $subtract: [now, "$enteredAt"] }, 3_600_000],
            },
            expectedHours: "$stageDef.expectedDurationHours",
          },
        },
        {
          $addFields: {
            ratio: {
              $cond: [
                { $gt: ["$expectedHours", 0] },
                { $divide: ["$hoursInStage", "$expectedHours"] },
                0,
              ],
            },
          },
        },
        { $match: { ratio: { $gte: 1.0 } } },
        {
          $group: {
            _id: "$toStageCode",
            count: { $sum: 1 },
            worstRatio: { $max: "$ratio" },
          },
        },
      ]),
    ]);

    const queueByStage = new Map<string, number>(stageLoad.map((r) => [r._id, r.qty]));
    const baselineMap  = new Map(cfg.baselines.map((b) => [b.stageCode, b]));
    const overdueByStage = new Map(overdueAgg.map((r) => [r._id, r]));

    const stageRows: {
      stageCode: string;
      queueUnits: number;
      capacityPerDay: number;
      queueDays: number;
      isBottleneck: boolean;
      expectedDurationHours: number;
      velocityFactor: number;
      overduePieces: number;
    }[] = [];

    let tightestQueueDays = 0;
    let tightestQueueUnits = 0;
    let tightestCapacityPerDay = 0;

    for (const stage of cfg.stages) {
      const bl = baselineMap.get(stage.code);
      const unitsPerDay =
        bl && bl.sampleSize > 0
          ? bl.unitsPerDay
          : stage.expectedDurationHours > 0
          ? cfg.dailyHours / stage.expectedDurationHours
          : 0;

      const cells = Math.max(cfg.stageCells.get(stage.code) ?? 0, 1);
      const capacityPerDay = unitsPerDay * cells;
      const queueUnits = queueByStage.get(stage.code) ?? 0;
      const queueDays = capacityPerDay > 0 ? queueUnits / capacityPerDay : 0;

      const overdue = overdueByStage.get(stage.code);
      const velocityFactor = Math.round((velocity.get(stage.code) ?? 1.0) * 100) / 100;

      stageRows.push({
        stageCode: stage.code,
        queueUnits,
        capacityPerDay: Math.round(capacityPerDay * 100) / 100,
        queueDays: Math.round(queueDays * 10) / 10,
        isBottleneck: queueDays >= BOTTLENECK_QUEUE_DAYS || (overdue?.count ?? 0) > 0,
        expectedDurationHours: stage.expectedDurationHours,
        velocityFactor,
        overduePieces: overdue?.count ?? 0,
      });

      if (queueDays > tightestQueueDays) {
        tightestQueueDays    = queueDays;
        tightestQueueUnits   = queueUnits;
        tightestCapacityPerDay = capacityPerDay;
      }
    }

    const bottlenecks = stageRows
      .filter((s) => s.isBottleneck)
      .sort((a, b) => b.queueDays - a.queueDays);

    const daysLeft = workingDaysLeft();
    const monthCapacityUnits = tightestCapacityPerDay * daysLeft;

    return res.status(200).json({
      monthLoad: {
        pct: monthCapacityUnits > 0
          ? Math.round((tightestQueueUnits / monthCapacityUnits) * 100)
          : 0,
        totalQueueUnits: tightestQueueUnits,
        monthCapacityUnits: Math.round(monthCapacityUnits * 10) / 10,
      },
      stages: stageRows,
      bottlenecks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

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
