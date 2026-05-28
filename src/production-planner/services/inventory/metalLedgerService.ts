import type { Types } from "mongoose";

import { MetalLedger, type MetalLedgerDocument } from "../../models/metalLedger";
import type { MetalLedgerType } from "../../types";

export interface MetalLedgerInput {
  metalType: string;
  movementType: MetalLedgerType;
  /**
   * Signed grams. By convention:
   *   issue           → NEGATIVE  (gold sent to the floor)
   *   return / adjustment → POSITIVE
   *   loss            → NEGATIVE
   */
  weightGrams: number;
  jobCardId?: Types.ObjectId;
  gatiPieceCode?: string;
  stageCode?: string;
  cellCode?: string;
  notes?: string;
  at?: Date;
}

export async function addMetalLedger(input: MetalLedgerInput): Promise<MetalLedgerDocument> {
  return MetalLedger.create({
    metalType: input.metalType,
    movementType: input.movementType,
    weightGrams: input.weightGrams,
    jobCardId: input.jobCardId,
    gatiPieceCode: input.gatiPieceCode,
    stageCode: input.stageCode?.toUpperCase(),
    cellCode: input.cellCode?.toUpperCase(),
    notes: input.notes,
    at: input.at ?? new Date(),
  });
}

export async function listMetalLedgerByJobCard(
  jobCardId: Types.ObjectId | string
): Promise<MetalLedgerDocument[]> {
  return MetalLedger.find({ jobCardId }).sort({ at: -1 });
}

/** Sum of signed grams for one JobCard, optionally by metal type. */
export async function getMetalNetForJobCard(
  jobCardId: Types.ObjectId | string,
  metalType?: string
): Promise<number> {
  const match: Record<string, unknown> = { jobCardId };
  if (metalType) match.metalType = metalType;
  const rows = await MetalLedger.aggregate<{ total: number }>([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$weightGrams" } } },
  ]);
  return rows[0]?.total ?? 0;
}
