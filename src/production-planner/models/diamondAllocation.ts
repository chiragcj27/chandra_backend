import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { ALLOCATION_STATUSES, type AllocationStatus } from "../types";

export interface DiamondAllocationDocument extends Document {
  jobCardId: Types.ObjectId;
  gatiPieceCode: string;
  diamondCode: string;
  quantityAllocated: number;
  quantityConsumed: number;
  status: AllocationStatus;
  allocatedAt: Date;
  consumedAt?: Date;
  releasedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DiamondAllocationSchema = new Schema<DiamondAllocationDocument>(
  {
    jobCardId: { type: Schema.Types.ObjectId, ref: "JobCard", required: true, index: true },
    gatiPieceCode: { type: String, required: true, index: true },
    diamondCode: { type: String, required: true, trim: true, index: true },
    quantityAllocated: { type: Number, required: true, min: 0 },
    quantityConsumed: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ALLOCATION_STATUSES, default: "active", index: true },
    allocatedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date },
    releasedAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

DiamondAllocationSchema.index({ jobCardId: 1, diamondCode: 1 });

export const DiamondAllocation =
  (models.DiamondAllocation as Model<DiamondAllocationDocument>) ??
  model<DiamondAllocationDocument>("DiamondAllocation", DiamondAllocationSchema);
