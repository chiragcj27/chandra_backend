import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { DIAMOND_LEDGER_TYPES, type DiamondLedgerType } from "../types";

export interface DiamondInventoryLedgerDocument extends Document {
  diamondCode: string;
  movementType: DiamondLedgerType;
  /** Signed quantity. Receipts positive, allocations/consumptions/losses negative. */
  quantity: number;
  jobCardId?: Types.ObjectId;
  gatiPieceCode?: string;
  referenceDoc?: string;
  at: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DiamondInventoryLedgerSchema = new Schema<DiamondInventoryLedgerDocument>(
  {
    diamondCode: { type: String, required: true, trim: true, index: true },
    movementType: { type: String, required: true, enum: DIAMOND_LEDGER_TYPES, index: true },
    quantity: { type: Number, required: true },
    jobCardId: { type: Schema.Types.ObjectId, ref: "JobCard", index: true },
    gatiPieceCode: { type: String, trim: true },
    referenceDoc: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

DiamondInventoryLedgerSchema.index({ diamondCode: 1, at: -1 });

export const DiamondInventoryLedger =
  (models.DiamondInventoryLedger as Model<DiamondInventoryLedgerDocument>) ??
  model<DiamondInventoryLedgerDocument>(
    "DiamondInventoryLedger",
    DiamondInventoryLedgerSchema
  );
