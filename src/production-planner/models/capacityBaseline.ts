import { Document, Schema, model, models, type Model } from "mongoose";

export interface CapacityBaselineDocument extends Document {
  stageCode: string;
  windowDays: number;
  unitsPerHour: number;
  unitsPerDay: number;
  stdDev: number;
  sampleSize: number;
  lastComputedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CapacityBaselineSchema = new Schema<CapacityBaselineDocument>(
  {
    stageCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    windowDays: { type: Number, required: true, min: 1, default: 30 },
    unitsPerHour: { type: Number, required: true, min: 0, default: 0 },
    unitsPerDay: { type: Number, required: true, min: 0, default: 0 },
    stdDev: { type: Number, min: 0, default: 0 },
    sampleSize: { type: Number, min: 0, default: 0 },
    lastComputedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

CapacityBaselineSchema.index({ stageCode: 1, windowDays: 1 }, { unique: true });

export const CapacityBaseline =
  (models.CapacityBaseline as Model<CapacityBaselineDocument>) ??
  model<CapacityBaselineDocument>("CapacityBaseline", CapacityBaselineSchema);
