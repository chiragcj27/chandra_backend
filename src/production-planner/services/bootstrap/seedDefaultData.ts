/**
 * Idempotent seed helpers — safe to call on every server start.
 * Uses bulkWrite + $setOnInsert so existing records are never overwritten.
 */

import { StageDefinition } from "../../models/stageDefinition";
import { DEFAULT_STAGE_DEFINITIONS } from "./columnMapDefaults";

/**
 * Ensure every predefined stage exists in StageDefinition.
 * Uses upsert ($setOnInsert) so admin edits (name, duration, etc.) are preserved.
 */
export async function seedDefaultStages(): Promise<void> {
  const ops = DEFAULT_STAGE_DEFINITIONS.map((s, i) => ({
    updateOne: {
      filter: { code: s.code },
      update: {
        $setOnInsert: {
          code: s.code,
          name: s.name,
          expectedDurationHours: 24,
          dependencies: [] as string[],
          unitOfWork: "piece" as const,
          isOptional: false,
          isTerminal: (s as { isTerminal?: boolean }).isTerminal ?? false,
          displayOrder: (s as { displayOrder?: number }).displayOrder ?? i,
          active: true,
        },
      },
      upsert: true,
    },
  }));
  await StageDefinition.bulkWrite(ops, { ordered: false });
  if (process.env.NODE_ENV !== "test") {
    console.log(`[ProductionPlanner] Stage seed: ${ops.length} predefined stages ensured.`);
  }
}
