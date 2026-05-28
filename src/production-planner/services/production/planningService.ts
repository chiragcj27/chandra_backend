import { StageDefinition, type StageDefinitionDocument } from "../../models/stageDefinition";
import type { PriorityLevel, UnitOfWork } from "../../types";
import {
  activeCellsForStage,
  buildStageQueues,
  getBaselineForStage,
} from "./capacityService";

const DAY_MS = 86_400_000;

export type CapacityStatus =
  | "WITHIN_RANGE"
  | "AT_LIMIT"
  | "NEEDS_OVERTIME"
  | "NEEDS_HIRE";

export type OnTimeProbability = "high" | "medium" | "low";

export interface OrderSpec {
  totalQty: number;
  totalStones?: number;
  totalGrams?: number;
  requiresStages?: string[];
  excludeStages?: string[];
  expectedDeliveryAt?: Date;
  priority?: PriorityLevel;
}

export interface StageImpact {
  stageCode: string;
  unit: UnitOfWork;
  newOrderUnits: number;
  queueUnits: number;
  capacityPerDay: number;
  waitDays: number;
  processingDays: number;
  endDay: number; // working days from "now" until this stage completes for the new order
  isCritical: boolean;
}

export interface PlanningResult {
  leadTimeDays: number;
  estimatedCompletionAt: Date;
  bottleneckStage: string | null;
  capacityStatus: CapacityStatus;
  overtimeHoursNeeded: number;
  onTimeProbability: OnTimeProbability;
  criticalPath: string[];
  perStage: StageImpact[];
  warnings: string[];
}

/** Resolve how many units of work this order represents for a given stage. */
function unitsForStage(stage: StageDefinitionDocument, spec: OrderSpec): number {
  switch (stage.unitOfWork) {
    case "stones":
      return Math.max(spec.totalStones ?? 0, 0);
    case "grams":
      return Math.max(spec.totalGrams ?? 0, 0);
    case "piece":
    default:
      return Math.max(spec.totalQty, 0);
  }
}

/**
 * Topologically order the candidate stages by `dependencies[]`. Stages with
 * empty dependencies fall back to `displayOrder` (so an un-configured
 * dependency graph still produces a sensible linear plan).
 */
function topoSortStages(stages: StageDefinitionDocument[]): StageDefinitionDocument[] {
  const byCode = new Map(stages.map((s) => [s.code, s]));
  const visited = new Set<string>();
  const result: StageDefinitionDocument[] = [];

  function visit(stage: StageDefinitionDocument): void {
    if (visited.has(stage.code)) return;
    visited.add(stage.code);
    for (const depCode of stage.dependencies ?? []) {
      const dep = byCode.get(depCode);
      if (dep) visit(dep);
    }
    result.push(stage);
  }

  const orderedSeed = [...stages].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );
  for (const s of orderedSeed) visit(s);
  return result;
}

/**
 * Compute the lead time, completion date, bottleneck, and capacity status for
 * a hypothetical new order, using current queue state + rolling baselines.
 *
 * - "endDay" = working day index by which this stage's portion of the new
 *   order is done (0-based from today).
 * - Lead time = max endDay across all required stages.
 * - Dependencies are honored via topo sort: a stage's start day is the latest
 *   endDay of its declared dependencies.
 * - Stages without explicit dependencies fall back to a linear chain by
 *   displayOrder — so the system works even before the dependency graph is
 *   configured.
 */
export async function planNewOrder(spec: OrderSpec): Promise<PlanningResult> {
  if (spec.totalQty <= 0) {
    throw new Error("totalQty must be > 0");
  }

  const warnings: string[] = [];

  const allActive = await StageDefinition.find({ active: true });
  if (allActive.length === 0) {
    throw new Error("No active stages configured");
  }

  // Filter stages to those required for this order.
  let stages = [...allActive];
  if (spec.requiresStages && spec.requiresStages.length > 0) {
    const required = new Set(spec.requiresStages.map((s) => s.toUpperCase()));
    stages = stages.filter((s) => required.has(s.code) || !s.isOptional);
  } else {
    stages = stages.filter((s) => !s.isOptional);
  }
  if (spec.excludeStages && spec.excludeStages.length > 0) {
    const excluded = new Set(spec.excludeStages.map((s) => s.toUpperCase()));
    stages = stages.filter((s) => !excluded.has(s.code));
  }

  const sorted = topoSortStages(stages);

  // Pre-build queue & capacity info once.
  const queueInfos = await buildStageQueues();
  const queueByStage = new Map(queueInfos.map((q) => [q.stageCode, q]));

  const endDayByStage = new Map<string, number>();
  const perStage: StageImpact[] = [];
  let prevLinearEndDay = 0; // Fallback for stages with empty dependency lists.

  for (const stage of sorted) {
    const baseline = await getBaselineForStage(stage);
    const cells = await activeCellsForStage(stage.code);
    const capacityPerDay = baseline.unitsPerDay * cells;

    if (capacityPerDay <= 0) {
      warnings.push(
        `Stage ${stage.code} has no capacity (no baseline data and no expectedDurationHours)`
      );
    }

    const queue = queueByStage.get(stage.code);
    const queueUnits = queue?.queueUnits ?? 0;
    const newUnits = unitsForStage(stage, spec);
    const processingDays = capacityPerDay > 0 ? newUnits / capacityPerDay : 0;

    // Start day = max endDay of dependencies (or prevLinearEndDay if no deps).
    let startDay = 0;
    if (stage.dependencies && stage.dependencies.length > 0) {
      for (const dep of stage.dependencies) {
        const depEnd = endDayByStage.get(dep) ?? 0;
        if (depEnd > startDay) startDay = depEnd;
      }
    } else {
      startDay = prevLinearEndDay;
    }

    const waitDays = capacityPerDay > 0 ? queueUnits / capacityPerDay : 0;
    const endDay = startDay + waitDays + processingDays;

    endDayByStage.set(stage.code, endDay);
    prevLinearEndDay = endDay;

    perStage.push({
      stageCode: stage.code,
      unit: stage.unitOfWork,
      newOrderUnits: newUnits,
      queueUnits,
      capacityPerDay,
      waitDays: round2(waitDays),
      processingDays: round2(processingDays),
      endDay: round2(endDay),
      isCritical: false,
    });
  }

  // Pick the bottleneck = highest queueDays among the stages this order touches.
  const orderStageCodes = new Set(sorted.map((s) => s.code));
  const candidateBottleneck = [...queueInfos]
    .filter((q) => orderStageCodes.has(q.stageCode))
    .sort((a, b) => b.queueDays - a.queueDays)[0];
  const bottleneckStage =
    candidateBottleneck && candidateBottleneck.queueDays > 0 ? candidateBottleneck.stageCode : null;

  // Lead time = max endDay; critical path = stages whose endDay matches lead time.
  const leadTimeDays = perStage.reduce((m, s) => Math.max(m, s.endDay), 0);
  const criticalPath: string[] = [];
  for (const stage of sorted) {
    const end = endDayByStage.get(stage.code) ?? 0;
    if (Math.abs(end - leadTimeDays) < 0.01) {
      criticalPath.push(stage.code);
      const impact = perStage.find((p) => p.stageCode === stage.code);
      if (impact) impact.isCritical = true;
    }
  }

  // Completion date = today + leadTimeDays (calendar days; calendar-aware refinement deferred).
  const estimatedCompletionAt = new Date(Date.now() + leadTimeDays * DAY_MS);

  // Capacity status & overtime calc.
  let capacityStatus: CapacityStatus = "WITHIN_RANGE";
  let overtimeHoursNeeded = 0;

  if (spec.expectedDeliveryAt) {
    const deliveryDays = Math.max(
      0,
      (spec.expectedDeliveryAt.getTime() - Date.now()) / DAY_MS
    );
    if (leadTimeDays > deliveryDays) {
      const slipDays = leadTimeDays - deliveryDays;
      // Find the bottleneck stage on the critical path and compute the overtime
      // hours/day needed to absorb the slip.
      const bottleneckImpact = perStage
        .filter((s) => s.isCritical)
        .sort((a, b) => b.processingDays + b.waitDays - (a.processingDays + a.waitDays))[0];
      if (bottleneckImpact && bottleneckImpact.capacityPerDay > 0 && deliveryDays > 0) {
        const targetCapPerDay =
          (bottleneckImpact.queueUnits + bottleneckImpact.newOrderUnits) / deliveryDays;
        const ratio = targetCapPerDay / bottleneckImpact.capacityPerDay;
        const dailyHours = 9;
        const requiredHours = dailyHours * ratio;
        overtimeHoursNeeded = round2(Math.max(0, requiredHours - dailyHours));
      }

      if (overtimeHoursNeeded === 0) capacityStatus = "AT_LIMIT";
      else if (overtimeHoursNeeded <= 4) capacityStatus = "NEEDS_OVERTIME";
      else capacityStatus = "NEEDS_HIRE";

      warnings.push(
        `Estimated completion exceeds requested delivery by ${round2(slipDays)} working day(s)`
      );
    } else if (leadTimeDays > deliveryDays * 0.9) {
      capacityStatus = "AT_LIMIT";
    }
  }

  // On-time probability bucket (qualitative based on whether we're inside, near, or past delivery).
  let onTimeProbability: OnTimeProbability = "high";
  if (capacityStatus === "AT_LIMIT") onTimeProbability = "medium";
  else if (capacityStatus === "NEEDS_OVERTIME" || capacityStatus === "NEEDS_HIRE") {
    onTimeProbability = "low";
  }

  return {
    leadTimeDays: round2(leadTimeDays),
    estimatedCompletionAt,
    bottleneckStage,
    capacityStatus,
    overtimeHoursNeeded,
    onTimeProbability,
    criticalPath,
    perStage,
    warnings,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
