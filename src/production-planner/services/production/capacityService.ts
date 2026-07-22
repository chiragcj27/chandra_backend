import { CapacityBaseline } from "../../models/capacityBaseline";
import { Cell } from "../../models/cell";
import { GatiColumnMap } from "../../models/gatiColumnMap";
import { JobCard } from "../../models/jobCard";
import { ProductionCalendar } from "../../models/productionCalendar";
import { StageDefinition, type StageDefinitionDocument } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";

const DEFAULT_DAILY_HOURS = 9;
const BASELINE_WINDOW_DAYS = 30;
const BOTTLENECK_QUEUE_DAYS = 3; // ≥ 3 days of backlog → flagged as bottleneck

export interface BaselineSummary {
  stageCode: string;
  unitsPerHour: number;
  unitsPerDay: number;
  stdDev: number;
  sampleSize: number;
  source: "data" | "expected";
}

/**
 * Recompute capacity baselines for every active stage from real `StageMovement`
 * data over the last `BASELINE_WINDOW_DAYS`.
 *
 * For each stage:
 *   - Pull all closed movements (exitedAt set) in the window.
 *   - Sum `qty` and `durationHours` across them.
 *   - unitsPerHour = total_qty / total_hours
 *   - unitsPerDay = unitsPerHour * defaultDailyHours
 *
 * If a stage has no real data yet, fall back to `1 / expectedDurationHours`
 * — i.e. the stage's configured expectation. `source` reflects which path was
 * taken so the planning service can downgrade confidence accordingly.
 *
 * Idempotent: result upserted by `(stageCode, windowDays)`. Safe to call repeatedly.
 */
export async function recomputeBaselines(): Promise<BaselineSummary[]> {
  const since = new Date(Date.now() - BASELINE_WINDOW_DAYS * 86_400_000);
  const calendar = await ProductionCalendar.findOne({ key: "default" });
  const dailyHours = calendar?.defaultDailyHours ?? DEFAULT_DAILY_HOURS;

  const stages = await StageDefinition.find({ active: true });
  const out: BaselineSummary[] = [];

  for (const stage of stages) {
    const movements = await StageMovement.find({
      toStageCode: stage.code,
      exitedAt: { $exists: true, $gte: since },
    }).select({ qty: 1, durationHours: 1 });

    const totalQty = movements.reduce((acc, m) => acc + (m.qty ?? 0), 0);
    const totalHours = movements.reduce((acc, m) => acc + (m.durationHours ?? 0), 0);

    let unitsPerHour = 0;
    let unitsPerDay = 0;
    let source: "data" | "expected" = "data";
    let stdDev = 0;

    if (totalHours > 0 && totalQty > 0) {
      unitsPerHour = totalQty / totalHours;
      unitsPerDay = unitsPerHour * dailyHours;

      const perMovementRate = movements
        .filter((m) => (m.durationHours ?? 0) > 0)
        .map((m) => (m.qty ?? 0) / (m.durationHours as number));
      if (perMovementRate.length > 1) {
        const mean = perMovementRate.reduce((a, b) => a + b, 0) / perMovementRate.length;
        const variance =
          perMovementRate.reduce((acc, r) => acc + (r - mean) ** 2, 0) / perMovementRate.length;
        stdDev = Math.sqrt(variance);
      }
    } else {
      // No real data → fall back to the configured expectation.
      source = "expected";
      if (stage.expectedDurationHours > 0) {
        unitsPerHour = 1 / stage.expectedDurationHours;
        unitsPerDay = unitsPerHour * dailyHours;
      }
    }

    await CapacityBaseline.findOneAndUpdate(
      { stageCode: stage.code, windowDays: BASELINE_WINDOW_DAYS },
      {
        $set: {
          stageCode: stage.code,
          windowDays: BASELINE_WINDOW_DAYS,
          unitsPerHour,
          unitsPerDay,
          stdDev,
          sampleSize: movements.length,
          lastComputedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    out.push({
      stageCode: stage.code,
      unitsPerHour,
      unitsPerDay,
      stdDev,
      sampleSize: movements.length,
      source,
    });
  }

  return out;
}

/** Best baseline for a stage. Falls back to expected if no real data. */
export async function getBaselineForStage(stage: StageDefinitionDocument): Promise<{
  unitsPerDay: number;
  stdDev: number;
  source: "data" | "expected";
}> {
  const baseline = await CapacityBaseline.findOne({
    stageCode: stage.code,
    windowDays: BASELINE_WINDOW_DAYS,
  });
  if (baseline && baseline.sampleSize > 0) {
    return {
      unitsPerDay: baseline.unitsPerDay,
      stdDev: baseline.stdDev,
      source: "data",
    };
  }
  const calendar = await ProductionCalendar.findOne({ key: "default" });
  const dailyHours = calendar?.defaultDailyHours ?? DEFAULT_DAILY_HOURS;
  const unitsPerDay = stage.expectedDurationHours > 0 ? dailyHours / stage.expectedDurationHours : 0;
  return { unitsPerDay, stdDev: 0, source: "expected" };
}

/** Count cells configured to operate at a given stage. */
export async function activeCellsForStage(stageCode: string): Promise<number> {
  // Cells configured at this stage in the Cell collection.
  const cellCount = await Cell.countDocuments({
    active: true,
    stageCodes: stageCode,
  });
  if (cellCount > 0) return cellCount;

  // Fallback: distinct cells in the WIP column map for this stage.
  const wipMap = await GatiColumnMap.findOne({ fileType: "wip", active: true });
  if (!wipMap) return 1;
  const cells = new Set<string>();
  for (const entry of wipMap.wipColumns ?? []) {
    if (entry.stageCode === stageCode) cells.add(entry.cellCode);
  }
  return Math.max(cells.size, 1);
}

export interface StageQueueInfo {
  stageCode: string;
  stageName: string;
  displayOrder: number;
  queueUnits: number;
  activeCells: number;
  capacityPerDay: number;
  queueDays: number;
  isBottleneck: boolean;
  unitsPerDayPerCell: number;
  source: "data" | "expected";
  expectedDurationHours: number;
}

/**
 * Build the live per-stage queue/capacity picture used by the Capacity Dashboard
 * and as input to bottleneck detection.
 *
 * - `queueUnits` = sum of `qty` across all open JobCards currently at this stage
 *   (anywhere across cells).
 * - `capacityPerDay` = baseline.unitsPerDay × activeCells.
 * - `queueDays` = queueUnits / capacityPerDay.
 * - `isBottleneck` when queueDays ≥ BOTTLENECK_QUEUE_DAYS.
 */
export async function buildStageQueues(): Promise<StageQueueInfo[]> {
  const stages = await StageDefinition.find({ active: true }).sort({ displayOrder: 1, code: 1 });

  // Aggregate qty by stageCode across all open JobCards' currentStageDistribution.
  const queueByStage = new Map<string, number>();
  const queueAgg = await JobCard.aggregate<{ _id: string; total: number }>([
    { $match: { status: { $in: ["pending", "planned", "in_progress", "on_hold"] } } },
    { $unwind: "$currentStageDistribution" },
    {
      $group: {
        _id: "$currentStageDistribution.stageCode",
        total: { $sum: "$currentStageDistribution.qty" },
      },
    },
  ]);
  for (const row of queueAgg) queueByStage.set(row._id, row.total);

  const out: StageQueueInfo[] = [];
  for (const stage of stages) {
    const queueUnits = queueByStage.get(stage.code) ?? 0;
    const baseline = await getBaselineForStage(stage);
    const cells = await activeCellsForStage(stage.code);
    const capacityPerDay = baseline.unitsPerDay * cells;
    const queueDays = capacityPerDay > 0 ? queueUnits / capacityPerDay : 0;

    out.push({
      stageCode: stage.code,
      stageName: stage.name,
      displayOrder: stage.displayOrder,
      queueUnits,
      activeCells: cells,
      capacityPerDay,
      queueDays,
      isBottleneck: queueDays >= BOTTLENECK_QUEUE_DAYS,
      unitsPerDayPerCell: baseline.unitsPerDay,
      source: baseline.source,
      expectedDurationHours: stage.expectedDurationHours,
    });
  }

  return out;
}

/** Identify the top-N bottleneck stages right now. */
export async function getCurrentBottlenecks(topN = 3): Promise<StageQueueInfo[]> {
  const all = await buildStageQueues();
  return all
    .filter((s) => s.isBottleneck)
    .sort((a, b) => b.queueDays - a.queueDays)
    .slice(0, topN);
}

/**
 * Month-load percentage: how much of this month's capacity is currently
 * spoken for by open work. > 100% means we can't finish everything this month.
 */
export async function getMonthLoadPct(): Promise<{
  pct: number;
  totalQueueUnits: number;
  monthCapacityUnits: number;
}> {
  const stages = await buildStageQueues();
  // Identify the most constrained stage (highest queueDays) and use it as the
  // proxy for "month load". A more sophisticated version would project across
  // the dependency chain, but the bottleneck stage dominates in practice.
  if (stages.length === 0) return { pct: 0, totalQueueUnits: 0, monthCapacityUnits: 0 };

  const tightest = [...stages].sort((a, b) => b.queueDays - a.queueDays)[0];
  const workingDaysLeft = workingDaysRemainingThisMonth();
  const monthCapacityUnits = tightest.capacityPerDay * workingDaysLeft;
  const pct =
    monthCapacityUnits > 0 ? Math.round((tightest.queueUnits / monthCapacityUnits) * 100) : 0;
  return {
    pct,
    totalQueueUnits: tightest.queueUnits,
    monthCapacityUnits,
  };
}

function workingDaysRemainingThisMonth(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0));
  let count = 0;
  for (let d = now.getUTCDate(); d <= endOfMonth.getUTCDate(); d++) {
    const date = new Date(Date.UTC(year, month, d));
    const dow = date.getUTCDay();
    if (dow !== 0) count++; // skip Sundays — calendar-aware refinement deferred to Phase 5
  }
  return Math.max(count, 1);
}

export const CAPACITY_CONSTANTS = {
  BASELINE_WINDOW_DAYS,
  BOTTLENECK_QUEUE_DAYS,
  DEFAULT_DAILY_HOURS,
};
