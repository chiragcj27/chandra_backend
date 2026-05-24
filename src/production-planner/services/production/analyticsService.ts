import { Alert } from "../../models/alert";
import { JobCard } from "../../models/jobCard";
import { StageMovement } from "../../models/stageMovement";
import { getLossSummary } from "../inventory/materialLossService";

const DAY_MS = 86_400_000;

export interface AnalyticsRange {
  /** Defaults to last 30 days if neither bound is supplied. */
  from?: Date;
  to?: Date;
}

export interface OnTimeKpi {
  completedCount: number;
  onTimeCount: number;
  lateCount: number;
  onTimePct: number;
  avgLatenessDays: number;
}

export interface CycleTimeRow {
  stageCode: string;
  avgHours: number;
  movementCount: number;
  totalQty: number;
}

export interface StageMovementTrendBucket {
  bucket: string; // ISO yyyy-MM-dd
  totalMovements: number;
  totalQty: number;
}

export interface AnomalyCountRow {
  type: string;
  count: number;
}

export interface AnalyticsSnapshot {
  range: { from: string; to: string; days: number };
  onTime: OnTimeKpi;
  avgOrderCycleDays: number;
  totalCompleted: number;
  totalInProgress: number;
  totalDelayed: number;
  cycleTimeByStage: CycleTimeRow[];
  movementsTrend: StageMovementTrendBucket[];
  anomalyCountsByType: AnomalyCountRow[];
  materialLossSummary: Awaited<ReturnType<typeof getLossSummary>>;
}

/** Resolve a date range — defaults to the last 30 days. */
function resolveRange(range: AnalyticsRange): { from: Date; to: Date; days: number } {
  const to = range.to ?? new Date();
  const from = range.from ?? new Date(to.getTime() - 30 * DAY_MS);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return { from, to, days };
}

export async function getAnalyticsSnapshot(
  range: AnalyticsRange = {}
): Promise<AnalyticsSnapshot> {
  const { from, to, days } = resolveRange(range);

  // ───── On-time delivery + cycle-time ─────
  const completed = await JobCard.find({
    status: "completed",
    actualCompletionAt: { $gte: from, $lte: to },
  }).select({
    actualCompletionAt: 1,
    expectedDeliveryAt: 1,
    orderedAt: 1,
  });

  let onTime = 0;
  let late = 0;
  let totalLatenessDays = 0;
  let totalCycleDays = 0;
  let cycleSamples = 0;
  for (const jc of completed) {
    if (jc.actualCompletionAt && jc.expectedDeliveryAt) {
      const delta =
        (jc.actualCompletionAt.getTime() - jc.expectedDeliveryAt.getTime()) / DAY_MS;
      if (delta <= 0) onTime++;
      else {
        late++;
        totalLatenessDays += delta;
      }
    }
    if (jc.actualCompletionAt && jc.orderedAt) {
      totalCycleDays += (jc.actualCompletionAt.getTime() - jc.orderedAt.getTime()) / DAY_MS;
      cycleSamples++;
    }
  }
  const totalDeliv = onTime + late;
  const onTimeKpi: OnTimeKpi = {
    completedCount: totalDeliv,
    onTimeCount: onTime,
    lateCount: late,
    onTimePct: totalDeliv > 0 ? Math.round((onTime / totalDeliv) * 1000) / 10 : 0,
    avgLatenessDays:
      late > 0 ? round2(totalLatenessDays / late) : 0,
  };

  // ───── Status counts (current state, not range-bound) ─────
  const [inProgressCount, plannedCount, onHoldCount, delayedCount] = await Promise.all([
    JobCard.countDocuments({ status: "in_progress" }),
    JobCard.countDocuments({ status: "planned" }),
    JobCard.countDocuments({ status: "on_hold" }),
    JobCard.countDocuments({
      status: { $nin: ["completed", "cancelled"] },
      expectedDeliveryAt: { $lt: new Date() },
    }),
  ]);

  // ───── Cycle time per stage ─────
  const cycleAgg = await StageMovement.aggregate<{
    _id: string;
    weightedSum: number;
    qty: number;
    count: number;
  }>([
    {
      $match: {
        exitedAt: { $gte: from, $lte: to },
        durationHours: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: "$toStageCode",
        weightedSum: { $sum: { $multiply: ["$qty", "$durationHours"] } },
        qty: { $sum: "$qty" },
        count: { $sum: 1 },
      },
    },
    { $sort: { weightedSum: -1 } },
  ]);
  const cycleTimeByStage: CycleTimeRow[] = cycleAgg.map((r) => ({
    stageCode: r._id,
    avgHours: r.qty > 0 ? round2(r.weightedSum / r.qty) : 0,
    movementCount: r.count,
    totalQty: r.qty,
  }));

  // ───── Daily movement trend ─────
  const trendAgg = await StageMovement.aggregate<{
    _id: string;
    totalMovements: number;
    totalQty: number;
  }>([
    { $match: { enteredAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$enteredAt" } },
        totalMovements: { $sum: 1 },
        totalQty: { $sum: "$qty" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const movementsTrend: StageMovementTrendBucket[] = trendAgg.map((r) => ({
    bucket: r._id,
    totalMovements: r.totalMovements,
    totalQty: r.totalQty,
  }));

  // ───── Anomaly counts by type ─────
  const anomalyAgg = await Alert.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        raisedAt: { $gte: from, $lte: to },
        type: {
          $in: [
            "BASELINE_DRIFT_SLOW",
            "BASELINE_DRIFT_FAST",
            "STAGE_STALE",
            "MATERIAL_LOSS_SPIKE",
            "MASS_REWORK",
          ],
        },
      },
    },
    { $group: { _id: "$type", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const anomalyCountsByType: AnomalyCountRow[] = anomalyAgg.map((r) => ({
    type: r._id,
    count: r.count,
  }));

  // ───── Material loss for the range ─────
  const materialLossSummary = await getLossSummary({ from, to });

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days },
    onTime: onTimeKpi,
    avgOrderCycleDays: cycleSamples > 0 ? round2(totalCycleDays / cycleSamples) : 0,
    totalCompleted: completed.length,
    totalInProgress: inProgressCount + plannedCount + onHoldCount,
    totalDelayed: delayedCount,
    cycleTimeByStage,
    movementsTrend,
    anomalyCountsByType,
    materialLossSummary,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
