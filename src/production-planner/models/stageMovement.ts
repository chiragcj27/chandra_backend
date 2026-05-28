import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { QC_RESULTS, type QcResult } from "../types";

export interface StageMovementDocument extends Document {
  jobCardId: Types.ObjectId;
  gatiPieceCode: string;
  fromStageCode?: string;
  toStageCode: string;
  cellCode: string;
  cellId?: Types.ObjectId;
  seatId?: Types.ObjectId;
  qty: number;
  enteredAt: Date;
  exitedAt?: Date;
  durationHours?: number;
  qcResult?: QcResult;
  rejectionReason?: string;
  weightInGrams?: number;
  weightOutGrams?: number;
  stonesIn?: number;
  stonesOut?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StageMovementSchema = new Schema<StageMovementDocument>(
  {
    jobCardId: { type: Schema.Types.ObjectId, ref: "JobCard", required: true, index: true },
    gatiPieceCode: { type: String, required: true, index: true },
    fromStageCode: { type: String, trim: true, uppercase: true },
    toStageCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    cellCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    cellId: { type: Schema.Types.ObjectId, ref: "Cell" },
    seatId: { type: Schema.Types.ObjectId, ref: "Seat" },
    qty: { type: Number, required: true, min: 1 },
    enteredAt: { type: Date, required: true, default: Date.now, index: true },
    exitedAt: { type: Date, index: true },
    durationHours: { type: Number, min: 0 },
    qcResult: { type: String, enum: QC_RESULTS },
    rejectionReason: { type: String, trim: true },
    weightInGrams: { type: Number, min: 0 },
    weightOutGrams: { type: Number, min: 0 },
    stonesIn: { type: Number, min: 0 },
    stonesOut: { type: Number, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

StageMovementSchema.index({ jobCardId: 1, enteredAt: -1 });
StageMovementSchema.index({ toStageCode: 1, cellCode: 1, exitedAt: 1 });

export const StageMovement =
  (models.StageMovement as Model<StageMovementDocument>) ??
  model<StageMovementDocument>("StageMovement", StageMovementSchema);
