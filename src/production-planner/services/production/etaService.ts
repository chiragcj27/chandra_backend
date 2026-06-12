/**
 * ETA Service — computes per-stage velocity factors from real movement data,
 * then updates `plannedCompletionAt` on every active JobCard.
 *
 * Called:
 *  - At the end of every alertEngine.runAlertRules() pass
 *  - After each WIP import (gatiWipAdapter)
 *
 * Algorithm
 * ─────────
 * 1. Velocity factor = median(actualHours / expectedDurationHours) from closed
 *    StageMovements in the last 30 days (with outlier rejection).
 *    factor > 1 = running slower.
 *
 * 2. Clamp velocity: 0.5 ≤ velocity ≤ 3.0 (never assume faster than 50% or slower than 300%)
 *
 * 3. For each active JobCard, find its current stage + time already spent there.
 *
 * 4. plannedCompletionAt = now
 *       + remaining time in current stage  (expectedHours × velocity − alreadySpent)
 *       + sum of each subsequent stage     (expectedHours × velocity)
 *
 * Safeguards:
 *  - Reject movements with impossible durationHours (< 0.01h or > 240h)
 *  - Use median instead of mean (outlier-resistant)
 *  - Cap velocity factors (0.5x to 3.0x)
 *  - Validate all timestamps and expected hours
 *  - Log anomalies for debugging
 */

import { JobCard } from "../../models/jobCard";
import { StageDefinition, type DurationRule } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";
import { resolveItemCategory } from "../integrations/columnMapper";
import { calculateSettingTimeHours, getTotalDiamondCarats, resolvePerPcPieces, SETTING_STAGE_CODES } from "./settingTimeTable";

/**
 * Look up the expected duration for a specific item at a stage.
 *
 * Priority:
 *   1. Rule matching category + weight range  → use rule.hours
 *   2. Rule matching any category ("") + weight range → use rule.hours
 *   3. Fallback → stage.expectedDurationHours
 */
export function getExpectedHours(
  stage: { expectedDurationHours: number; durationRules?: DurationRule[] },
  itemCategory: string | undefined,
  weightGrams: number,
  actualQty?: number
): number {
  const rules = stage.durationRules;
  if (!rules?.length) return stage.expectedDurationHours;

  const weight = weightGrams ?? 0;

  const applyRule = (r: DurationRule): number => {
    if (r.qty && r.qty > 1 && actualQty && actualQty > 0) {
      return (actualQty / r.qty) * r.hours;
    }
    return r.hours;
  };

  const catLower = (itemCategory ?? "").toLowerCase();
  const exact = rules.find(
    (r) =>
      r.category.toLowerCase() === catLower &&
      weight >= r.weightMin &&
      weight <= r.weightMax
  );
  if (exact) return applyRule(exact);

  const anyCat = rules.find(
    (r) => r.category === "" && weight >= r.weightMin && weight <= r.weightMax
  );
  if (anyCat) return applyRule(anyCat);

  return stage.expectedDurationHours;
}

const VELOCITY_LOOKBACK_DAYS = 30;
const VELOCITY_MIN_HOURS = 0.01;
const VELOCITY_MAX_HOURS = 240;
const VELOCITY_MIN_FACTOR = 0.5;
const VELOCITY_MAX_FACTOR = 3.0;
const VELOCITY_OUTLIER_THRESHOLD = 5.0;

/**
 * Calculate median of an array (outlier-resistant).
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 1.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Validate movement duration — reject corrupted data.
 * Returns actual hours if valid, null otherwise.
 */
function validateMovementDuration(
  mv: any,
  stageExpected: number
): number | null {
  let actual: number | null = null;

  if (mv.durationHours != null && mv.durationHours > 0) {
    actual = mv.durationHours;
  } else if (mv.exitedAt && mv.enteredAt) {
    const diffMs = mv.exitedAt.getTime() - mv.enteredAt.getTime();
    if (diffMs > 0) {
      actual = diffMs / 3_600_000;
    }
  }

  if (!actual || actual <= 0) return null;

  if (actual < VELOCITY_MIN_HOURS || actual > VELOCITY_MAX_HOURS) {
    console.warn(
      `[ETA] ⚠️ Movement ${mv._id} @ ${mv.toStageCode}: duration=${actual.toFixed(2)}h outside valid range [${VELOCITY_MIN_HOURS}, ${VELOCITY_MAX_HOURS}h]. Rejected.`
    );
    return null;
  }

  return actual;
}

/**
 * Compute actual velocity factor per stage from recently closed movements.
 * Uses median with outlier rejection for robustness.
 * Returns Map<stageCode, factor> clamped to [0.5, 3.0].
 */
export async function computeStageVelocityMap(
  lookbackDays = VELOCITY_LOOKBACK_DAYS
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const closed = await StageMovement.find({
    exitedAt: { $gte: since },
    enteredAt: { $gte: since },
  }).select({ toStageCode: 1, enteredAt: 1, exitedAt: 1, durationHours: 1, _id: 1 });

  const stageExpected = new Map<string, number>(
    (
      await StageDefinition.find({ active: true }).select({
        code: 1,
        expectedDurationHours: 1,
      })
    ).map((s) => [s.code, s.expectedDurationHours])
  );

  const stageRatios = new Map<string, number[]>();

  for (const mv of closed) {
    const expected = stageExpected.get(mv.toStageCode);
    if (!expected || expected <= 0) continue;

    const actual = validateMovementDuration(mv, expected);
    if (actual === null) continue;

    const ratio = actual / expected;

    if (ratio > VELOCITY_OUTLIER_THRESHOLD) {
      console.warn(
        `[ETA] 🚨 Outlier movement ${mv._id} @ ${mv.toStageCode}: ratio=${ratio.toFixed(2)}x (${actual.toFixed(2)}h / ${expected}h). Rejected as anomaly.`
      );
      continue;
    }

    const ratios = stageRatios.get(mv.toStageCode) ?? [];
    ratios.push(ratio);
    stageRatios.set(mv.toStageCode, ratios);
  }

  const result = new Map<string, number>();
  for (const [code, ratios] of stageRatios) {
    if (ratios.length === 0) continue;

    const median = calculateMedian(ratios);
    const clamped = Math.max(VELOCITY_MIN_FACTOR, Math.min(median, VELOCITY_MAX_FACTOR));

    if (Math.abs(clamped - median) > 0.1) {
      console.log(
        `[ETA] 📊 ${code}: median=${median.toFixed(2)}x → clamped=${clamped.toFixed(2)}x (${ratios.length} samples)`
      );
    }

    result.set(code, clamped);
  }

  if (result.size > 0) {
    console.log(
      `[ETA] ✓ Computed velocity factors for ${result.size} stages (lookback=${lookbackDays}d)`
    );
  }

  return result;
}

/**
 * Recompute and persist `plannedCompletionAt` for every active JobCard.
 * Includes comprehensive validation and error handling.
 * Returns the number of job cards updated.
 */
export async function refreshAllETAs(): Promise<{ updated: number }> {
  const now = new Date();
  const startTime = Date.now();

  try {
    const allStages = await StageDefinition.find({ active: true }).sort({
      displayOrder: 1,
    });
    const flowStages = allStages.filter(
      (s) => s.displayOrder >= 1 && s.displayOrder < 90
    );
    const allStagesIncInactive = await StageDefinition.find({}).sort({ displayOrder: 1 });
    const stageByCode = new Map(allStagesIncInactive.map((s) => [s.code, s]));

    if (flowStages.length === 0) {
      console.warn("[ETA] ⚠️ No active stages found. Cannot compute ETAs.");
      return { updated: 0 };
    }

    const velocity = await computeStageVelocityMap();

    const openMovs = await StageMovement.find({
      exitedAt: { $exists: false },
    }).select({ jobCardId: 1, toStageCode: 1, enteredAt: 1 });

    const movLookup = new Map<string, Date>();
    for (const m of openMovs) {
      if (!m.enteredAt || !m.jobCardId) continue;
      movLookup.set(`${m.jobCardId.toString()}_${m.toStageCode}`, m.enteredAt);
    }

    const jobCards = await JobCard.find({
      status: { $in: ["pending", "planned", "in_progress", "on_hold"] },
    }).select({
      _id: 1,
      gatiPieceCode: 1,
      currentStageDistribution: 1,
      itemCategory: 1,
      styleNo: 1,
      metalWeightPerPiece: 1,
      totalQty: 1,
      perPcPieces: 1,
      diamondSpecs: 1,
    });

    const bulkOps: object[] = [];
    const etaStats = { total: jobCards.length, updated: 0, skipped: 0, errors: 0 };

    for (const jc of jobCards) {
      try {
        const currentCodes = new Set<string>(
          (jc.currentStageDistribution ?? []).map((s) => s.stageCode)
        );
        if (currentCodes.size === 0) {
          etaStats.skipped++;
          continue;
        }

        let startIdx = flowStages.findIndex((s) => currentCodes.has(s.code));

        if (startIdx === -1) {
          for (const code of currentCodes) {
            const fallback = stageByCode.get(code);
            if (!fallback) continue;
            const spliceIdx = flowStages.findIndex(
              (s) => s.displayOrder >= fallback.displayOrder
            );
            if (spliceIdx !== -1) {
              startIdx = spliceIdx;
              break;
            }
          }
          if (startIdx === -1) startIdx = Math.max(0, flowStages.length - 1);
        }

        let totalHours = 0;
        const jcId = jc._id.toString();

        for (let i = startIdx; i < flowStages.length; i++) {
          const stage = flowStages[i];

          const resolvedCat = resolveItemCategory(
            (jc as { itemCategory?: string }).itemCategory,
            (jc as { styleNo?: string }).styleNo
          );

          let expected = getExpectedHours(
            stage,
            resolvedCat,
            (jc as { metalWeightPerPiece?: number }).metalWeightPerPiece ?? 0,
            (jc as { totalQty?: number }).totalQty
          );

          if (SETTING_STAGE_CODES.has(stage.code)) {
            const nw = getTotalDiamondCarats(
              (jc as { diamondSpecs?: { totalCaratsPerPiece: number }[] }).diamondSpecs
            );
            const pp = resolvePerPcPieces(
              (jc as { perPcPieces?: number }).perPcPieces,
              (jc as { diamondSpecs?: { stonesPerPiece: number }[] }).diamondSpecs
            );
            expected += calculateSettingTimeHours(nw, pp, 0);
          }

          if (expected <= 0) {
            console.warn(
              `[ETA] ⚠️ ${jc.gatiPieceCode} @ ${stage.code}: expected=${expected}h (invalid). Skipping stage.`
            );
            continue;
          }

          const vf = velocity.get(stage.code) ?? 1.0;
          const adjustedHours = expected * vf;

          if (i === startIdx) {
            const enteredAt = movLookup.get(`${jcId}_${stage.code}`);
            const alreadySpent = enteredAt
              ? (now.getTime() - enteredAt.getTime()) / 3_600_000
              : 0;
            totalHours += Math.max(0, adjustedHours - alreadySpent);
          } else {
            totalHours += adjustedHours;
          }

          if (stage.isTerminal) break;
        }

        if (totalHours < 0) {
          console.warn(
            `[ETA] ⚠️ ${jc.gatiPieceCode}: totalHours=${totalHours}h (negative, clamping to 0)`
          );
          totalHours = 0;
        }

        if (totalHours > 5000) {
          console.warn(
            `[ETA] 🚨 ${jc.gatiPieceCode}: totalHours=${totalHours.toFixed(0)}h (suspiciously high, capping at 240h)`
          );
          totalHours = Math.min(totalHours, 240);
        }

        const plannedCompletionAt = new Date(now.getTime() + totalHours * 3_600_000);

        bulkOps.push({
          updateOne: {
            filter: { _id: jc._id },
            update: { $set: { plannedCompletionAt } },
          },
        });

        etaStats.updated++;
      } catch (err) {
        console.error(
          `[ETA] ❌ Error computing ETA for ${jc.gatiPieceCode}:`,
          err instanceof Error ? err.message : String(err)
        );
        etaStats.errors++;
      }
    }

    if (bulkOps.length > 0) {
      await JobCard.bulkWrite(
        bulkOps as Parameters<typeof JobCard.bulkWrite>[0],
        { ordered: false }
      );
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[ETA] ✓ Completed in ${elapsed}ms | Updated: ${etaStats.updated} | Skipped: ${etaStats.skipped} | Errors: ${etaStats.errors} | Total: ${etaStats.total}`
    );

    return { updated: etaStats.updated };
  } catch (err) {
    console.error(
      "[ETA] 💥 Critical error in refreshAllETAs:",
      err instanceof Error ? err.message : String(err)
    );
    return { updated: 0 };
  }
}
