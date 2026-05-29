/**
 * Idempotent seed helpers — safe to call on every server start.
 *
 * Strategy:
 *  - displayOrder, name, isOptional, isTerminal → always refreshed via $set
 *    (so reordering stages in columnMapDefaults takes effect on next boot).
 *  - expectedDurationHours → always refreshed via $set (canonical hours from columnMapDefaults).
 *  - dependencies, unitOfWork → $setOnInsert only (admin edits preserved across restarts).
 *  - Obsolete stages (merged into other stage's cells) → deactivated.
 */

import { StageDefinition } from "../../models/stageDefinition";
import { DEFAULT_STAGE_DEFINITIONS, OBSOLETE_STAGE_CODES } from "./columnMapDefaults";

export async function seedDefaultStages(): Promise<void> {
  const ops = DEFAULT_STAGE_DEFINITIONS.map((s, i) => ({
    updateOne: {
      filter: { code: s.code },
      update: {
        // Always refresh visual/flow metadata + canonical expected hours
        $set: {
          displayOrder:          s.displayOrder ?? i,
          name:                  s.name,
          isOptional:            s.isOptional  ?? false,
          isTerminal:            s.isTerminal  ?? false,
          active:                true,
          expectedDurationHours: s.expectedDurationHours ?? 24,
          ...(s.parallelGroup != null ? { parallelGroup: s.parallelGroup } : {}),
        },
        // Only set structural fields on first insert
        $setOnInsert: {
          code:        s.code,
          dependencies: [] as string[],
          unitOfWork:   "piece" as const,
        },
      },
      upsert: true,
    },
  }));

  await StageDefinition.bulkWrite(ops, { ordered: false });

  // Deactivate stages that have been merged into other stages as cells
  if (OBSOLETE_STAGE_CODES.length > 0) {
    await StageDefinition.updateMany(
      { code: { $in: [...OBSOLETE_STAGE_CODES] } },
      { $set: { active: false, displayOrder: 100 } }
    );
  }

  if (process.env.NODE_ENV !== "test") {
    console.log(`[ProductionPlanner] Stage seed: ${ops.length} predefined stages ensured.`);
  }
}
