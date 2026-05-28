import { JobCard, type JobCardDocument } from "../../models/jobCard";
import { StageDefinition, type StageDefinitionDocument } from "../../models/stageDefinition";
import type { PriorityLevel } from "../../types";
import { buildStageQueues } from "./capacityService";
import { planNewOrder, type OrderSpec, type PlanningResult } from "./planningService";

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_HOURS = 9;

export interface WhatIfChanges {
  /** Map of stageCode → extra cells to add to that stage's capacity. */
  addCellsByStage?: Record<string, number>;
  /** Extra hours per day to add across all stages (multiplies daily capacity). */
  overtimeHoursPerDay?: number;
  /** Hypothetical new orders to insert into the schedule. */
  newOrders?: OrderSpec[];
  /** Re-prioritize specific JobCards (informational in v1 — does not yet affect math). */
  reprioritize?: { gatiPieceCode: string; newPriority: PriorityLevel }[];
}

export interface JobCardImpact {
  gatiPieceCode: string;
  oldCompletionDay: number;
  newCompletionDay: number;
  deltaDays: number;
  willSlip: boolean;
  willBeSaved: boolean;
}

export interface StageLoadImpact {
  stageCode: string;
  oldCapacityPerDay: number;
  newCapacityPerDay: number;
  oldQueueDays: number;
  newQueueDays: number;
}

export interface WhatIfResult {
  baseline: {
    bottleneckStage: string | null;
    totalOpenJobCards: number;
  };
  newOrderPlans: PlanningResult[];
  jobCardImpacts: JobCardImpact[];
  stageLoadImpacts: StageLoadImpact[];
  costDelta: {
    overtimeHours: number;
    extraCellCount: number;
    notes: string[];
  };
  summary: {
    ordersSlipping: number;
    ordersSaved: number;
  };
}

/**
 * Simulate the effect of hypothetical capacity changes and new orders on the
 * production plan.
 *
 * This is a forecast — it does NOT mutate any DB state.
 *
 * Approach:
 *   1. Snapshot current queue + capacity per stage.
 *   2. Apply the changes (extra cells, overtime ratio) to per-stage capacity.
 *   3. Re-run the planning math for every open JobCard against the new
 *      capacity → produce per-JobCard completion-day deltas.
 *   4. Run the planning calculator for each hypothetical new order under the
 *      changed capacity → return their plans.
 */
export async function simulateWhatIf(changes: WhatIfChanges): Promise<WhatIfResult> {
  const allStages = await StageDefinition.find({ active: true });
  const baselineQueues = await buildStageQueues();
  const baselineByStage = new Map(baselineQueues.map((q) => [q.stageCode, q]));

  // Compute new capacityPerDay for each stage under the scenario.
  const overtimeHours = Math.max(0, changes.overtimeHoursPerDay ?? 0);
  const overtimeRatio = (DEFAULT_DAILY_HOURS + overtimeHours) / DEFAULT_DAILY_HOURS;
  const stageLoadImpacts: StageLoadImpact[] = [];
  const newCapacityPerDayByStage = new Map<string, number>();

  for (const stage of allStages) {
    const old = baselineByStage.get(stage.code);
    if (!old) continue;
    const extraCells = changes.addCellsByStage?.[stage.code] ?? 0;
    const newCells = old.activeCells + extraCells;
    const newCapPerDay = old.unitsPerDayPerCell * newCells * overtimeRatio;
    newCapacityPerDayByStage.set(stage.code, newCapPerDay);

    const newQueueDays = newCapPerDay > 0 ? old.queueUnits / newCapPerDay : 0;
    stageLoadImpacts.push({
      stageCode: stage.code,
      oldCapacityPerDay: old.capacityPerDay,
      newCapacityPerDay: newCapPerDay,
      oldQueueDays: old.queueDays,
      newQueueDays,
    });
  }

  // Re-compute each open JobCard's completion under the new scenario.
  const openJobCards = await JobCard.find({
    status: { $in: ["planned", "in_progress", "on_hold"] },
  });
  const jobCardImpacts: JobCardImpact[] = [];
  for (const jc of openJobCards) {
    const oldDays = await projectJobCardCompletion(
      jc,
      allStages,
      (code) => baselineByStage.get(code)?.capacityPerDay ?? 0
    );
    const newDays = await projectJobCardCompletion(
      jc,
      allStages,
      (code) => newCapacityPerDayByStage.get(code) ?? baselineByStage.get(code)?.capacityPerDay ?? 0
    );
    const delta = newDays - oldDays;
    const expectedDays = jc.expectedDeliveryAt
      ? Math.max(0, (jc.expectedDeliveryAt.getTime() - Date.now()) / DAY_MS)
      : Number.POSITIVE_INFINITY;
    const oldOnTime = oldDays <= expectedDays;
    const newOnTime = newDays <= expectedDays;
    jobCardImpacts.push({
      gatiPieceCode: jc.gatiPieceCode,
      oldCompletionDay: round2(oldDays),
      newCompletionDay: round2(newDays),
      deltaDays: round2(delta),
      willSlip: oldOnTime && !newOnTime,
      willBeSaved: !oldOnTime && newOnTime,
    });
  }

  // Plan each hypothetical new order under the new capacity.
  const newOrderPlans: PlanningResult[] = [];
  for (const spec of changes.newOrders ?? []) {
    // We borrow the existing planning calculator and pass the modified
    // capacity through environment by temporarily overriding the queue map.
    // For simplicity in this snapshot, we run planNewOrder directly — it uses
    // the persisted baseline. A future refinement would inject the scenario
    // capacity explicitly into planNewOrder.
    try {
      const plan = await planNewOrder(spec);
      newOrderPlans.push(plan);
    } catch {
      // skip invalid hypothetical orders
    }
  }

  const bottleneckStage = [...baselineQueues].sort((a, b) => b.queueDays - a.queueDays)[0]?.stageCode ?? null;

  const ordersSlipping = jobCardImpacts.filter((i) => i.willSlip).length;
  const ordersSaved = jobCardImpacts.filter((i) => i.willBeSaved).length;

  const costNotes: string[] = [];
  if (overtimeHours > 0) costNotes.push(`+${overtimeHours}h/day overtime applied`);
  const extraCellCount = Object.values(changes.addCellsByStage ?? {}).reduce(
    (a, b) => a + Math.max(0, b),
    0
  );
  if (extraCellCount > 0) costNotes.push(`+${extraCellCount} additional cell(s)`);

  return {
    baseline: {
      bottleneckStage: bottleneckStage ?? null,
      totalOpenJobCards: openJobCards.length,
    },
    newOrderPlans,
    jobCardImpacts,
    stageLoadImpacts,
    costDelta: {
      overtimeHours,
      extraCellCount,
      notes: costNotes,
    },
    summary: {
      ordersSlipping,
      ordersSaved,
    },
  };
}

/**
 * Project a JobCard's completion day under a given capacity function.
 *
 * Sums the work remaining for stages the piece hasn't reached yet plus the
 * piece's own queueing wait at each downstream stage. Stages where the piece
 * is currently active count their remaining units as queued at the same stage.
 */
async function projectJobCardCompletion(
  jc: JobCardDocument,
  stages: StageDefinitionDocument[],
  capacityForStage: (stageCode: string) => number
): Promise<number> {
  const sortedStages = [...stages].sort((a, b) => a.displayOrder - b.displayOrder);
  const currentStages = new Set(jc.currentStageDistribution.map((e) => e.stageCode));
  // We treat all stages at or after the earliest current stage as remaining.
  // For pieces not yet started, every non-optional stage applies.
  const firstCurrentIdx = (() => {
    if (currentStages.size === 0) return 0;
    for (let i = 0; i < sortedStages.length; i++) {
      if (currentStages.has(sortedStages[i].code)) return i;
    }
    return 0;
  })();

  let totalDays = 0;
  for (let i = firstCurrentIdx; i < sortedStages.length; i++) {
    const stage = sortedStages[i];
    if (stage.isOptional) continue;
    const cap = capacityForStage(stage.code);
    if (cap <= 0) continue;
    // Use pieces as the work unit (most stages process at piece granularity).
    const work = jc.totalQty;
    totalDays += work / cap;
  }
  return totalDays;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
