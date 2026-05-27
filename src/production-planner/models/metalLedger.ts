import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { METAL_LEDGER_TYPES, type MetalLedgerType } from "../types";

export interface MetalLedgerDocument extends Document {
  metalType: string;
  movementType: MetalLedgerType;
  /**
   * Signed grams. Convention (matches frontend UX):
   *   issue      → positive  (+50.00g  — metal going to the production floor)
   *   return     → negative  (−12.00g  — scrap coming back to the vault)
   *   loss       → negative  (−0.10g   — irrecoverable dust / breakage)
   *   adjustment → positive or negative (admin-supplied correction)
   *
   * Material-loss formulas use $abs per movementType, so the sign on stored
   * documents is not load-bearing for calculations — only for display.
   */
  weightGrams: number;
  jobCardId?: Types.ObjectId;
  gatiPieceCode?: string;
  stageCode?: string;
  cellCode?: string;
  at: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MetalLedgerSchema = new Schema<MetalLedgerDocument>(
  {
    metalType: { type: String, required: true, trim: true, index: true },
    movementType: { type: String, required: true, enum: METAL_LEDGER_TYPES, index: true },
    weightGrams: { type: Number, required: true },
    jobCardId: { type: Schema.Types.ObjectId, ref: "JobCard", index: true },
    gatiPieceCode: { type: String, trim: true },
    stageCode: { type: String, trim: true, uppercase: true },
    cellCode: { type: String, trim: true, uppercase: true },
    at: { type: Date, required: true, default: Date.now, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

MetalLedgerSchema.index({ jobCardId: 1, at: -1 });

export const MetalLedger =
  (models.MetalLedger as Model<MetalLedgerDocument>) ??
  model<MetalLedgerDocument>("MetalLedger", MetalLedgerSchema);
