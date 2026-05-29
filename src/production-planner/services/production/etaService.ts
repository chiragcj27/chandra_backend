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
 * 1. Velocity factor = avg(actualHours / expectedDurationHours) from closed
 *    StageMovements in the last 30 days.  factor > 1 = running slower.
 *
 * 2. For each active JobCard, find its current stage + time already spent there.
 *
 * 3. plannedCompletionAt = now
 *       + remaining time in current stage  (expectedHours × velocity − alreadySpent)
 *       + sum of each subsequent stage     (expectedHours × velocity)
 *
 * One bulk query fetches all open movements so there are no N+1 queries.
 */

import { JobCard } from "../../models/jobCard";
import { StageDefinition } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";

const VELOCITY_LOOKBACK_DAYS = 30;

/**
 * Compute actual velocity factor per stage from recently closed movements.
 * Returns Map<stageCode, factor> — factor > 1 means running slower than expected.
 * Stages with no data fall back to 1.0 at the call site.
 */
export async function computeStageVelocityMap(
  lookbackDays = VELOCITY_LOOKBACK_DAYS
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const closed = await StageMovement.find({
    exitedAt: { $gte: since },
    enteredAt: { $gte: since },
  }).select({ toStageCode: 1, enteredAt: 1, exitedAt: 1, durationHours: 1 });

  const stageExpected = new Map<string, number>(
    (
      await StageDefinition.find({ active: true }).select({
        code: 1,
        expectedDurationHours: 1,
      })
    ).map((s) => [s.code, s.expectedDurationHours])
  );

  const totals = new Map<string, { sum: number; count: number }>();

  for (const mv of closed) {
    const expected = stageExpected.get(mv.toStageCode);
    if (!expected || expected <= 0) continue;

    // Prefer stored durationHours; fall back to exitedAt − enteredAt
    const actual =
      mv.durationHours != null && mv.durationHours > 0
        ? mv.durationHours
        : mv.exitedAt && mv.enteredAt
        ? (mv.exitedAt.getTime() - mv.enteredAt.getTime()) / 3_600_000
        : null;

    if (!actual || actual <= 0) continue;

    const ratio = actual / expected;
    const t = totals.get(mv.toStageCode) ?? { sum: 0, count: 0 };
    t.sum += ratio;
    t.count++;
    totals.set(mv.toStageCode, t);
  }

  const result = new Map<string, number>();
  for (const [code, { sum, count }] of totals) {
    result.set(code, sum / count);
  }
  return result;
}

/**
 * Recompute and persist `plannedCompletionAt` for every active JobCard.
 * Returns the number of job cards updated.
 */
export async function refreshAllETAs(): Promise<{ updated: number }> {
  const now = new Date();

  // ── 1. Load stages — prefer main flow (displayOrder 1–89), but keep ALL
  //    active stages as a fallback so job cards whose currentStageDistribution
  //    still has old/renamed codes (e.g. PRE_POLISH → POL) still get an ETA.
  const allStages = await StageDefinition.find({ active: true }).sort({
    displayOrder: 1,
  });
  const flowStages = allStages.filter(
    (s) => s.displayOrder >= 1 && s.displayOrder < 90
  );
  // Also include inactive stages in the lookup so transitional pieces
  // (still at a renamed stage) don't get silently skipped.
  const allStagesIncInactive = await StageDefinition.find({}).sort({ displayOrder: 1 });
  const stageByCode = new Map(allStagesIncInactive.map((s) => [s.code, s]));

  if (flowStages.length === 0) return { updated: 0 };

  // ── 2. Velocity factors ───────────────────────────────────────────────────
  const velocity = await computeStageVelocityMap();

  // ── 3. Batch-fetch all open movements (avoids N+1) ────────────────────────
  const openMovs = await StageMovement.find({
    exitedAt: { $exists: false },
  }).select({ jobCardId: 1, toStageCode: 1, enteredAt: 1 });

  // Key: `${jobCardId}_${stageCode}` → enteredAt
  const movLookup = new Map<string, Date>();
  for (const m of openMovs) {
    movLookup.set(`${m.jobCardId.toString()}_${m.toStageCode}`, m.enteredAt);
  }

  // ── 4. Active job cards ───────────────────────────────────────────────────
  const jobCards = await JobCard.find({
    status: { $in: ["pending", "planned", "in_progress", "on_hold"] },
  }).select({ _id: 1, currentStageDistribution: 1 });

  // ── 5. Compute ETA per job card ───────────────────────────────────────────
  const bulkOps: object[] = [];

  for (const jc of jobCards) {
    const currentCodes = new Set<string>(
      (jc.currentStageDistribution ?? []).map((s) => s.stageCode)
    );
    if (currentCodes.size === 0) continue;

    // Find where the piece is in the main flow.
    // If the piece is at an old/renamed stage (e.g. PRE_POLISH → POL),
    // use that stage's displayOrder to splice into the flow at the right position.
    let startIdx = flowStages.findIndex((s) => currentCodes.has(s.code));

    if (startIdx === -1) {
      // Fallback: find the first current stage code (even if inactive/renamed),
      // get its displayOrder, and splice in at the nearest flow position.
      for (const code of currentCodes) {
        const fallback = stageByCode.get(code);
        if (!fallback) continue;
        // Find the first flow stage at or after this displayOrder
        const spliceIdx = flowStages.findIndex(
          (s) => s.displayOrder >= fallback.displayOrder
        );
        if (spliceIdx !== -1) {
          startIdx = spliceIdx;
          break;
        }
      }
      // If still not found, start from the last flow stage (almost done)
      if (startIdx === -1) startIdx = Math.max(0, flowStages.length - 1);
    }

    let totalHours = 0;
    const jcId = jc._id.toString();

    for (let i = startIdx; i < flowStages.length; i++) {
      const stage = flowStages[i];
      const expected = stage.expectedDurationHours;
      if (expected <= 0) continue;

      // velocity clamped to [0.5, ∞) — never predict faster than half expected
      const vf = Math.max(velocity.get(stage.code) ?? 1.0, 0.5);
      const adjustedHours = expected * vf;

      if (i === startIdx) {
        // Remaining = adjusted − already spent (min 0)
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

    const plannedCompletionAt = new Date(now.getTime() + totalHours * 3_600_000);

    bulkOps.push({
      updateOne: {
        filter: { _id: jc._id },
        update: { $set: { plannedCompletionAt } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await JobCard.bulkWrite(
      bulkOps as Parameters<typeof JobCard.bulkWrite>[0],
      { ordered: false }
    );
  }

  return { updated: bulkOps.length };
}
