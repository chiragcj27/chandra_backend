import { Document, Schema, model, models, type Model } from "mongoose";

import { UNIT_OF_WORK, type UnitOfWork } from "../types";

/** Per-category + weight-range override for expectedDurationHours. */
export interface DurationRule {
  /** Jewelry category, e.g. "Ring". Empty string = applies to all categories. */
  category: string;
  /** Human-readable weight label, e.g. "5-10g". Used for display only. */
  weightLabel: string;
  /** Minimum metal weight in grams (inclusive). Use 0 for no lower bound. */
  weightMin: number;
  /** Maximum metal weight in grams (inclusive). Use 9999 for no upper bound. */
  weightMax: number;
  /**
   * Reference quantity for the proportional formula.
   * If > 1: expectedTime = (actualQty / qty) × hours
   * If 0 or 1: hours is returned directly (no scaling).
   */
  qty: number;
  /** Expected hours for `qty` pieces of this category+weight. */
  hours: number;
}

export interface StageDefinitionDocument extends Document {
  code: string;
  name: string;
  expectedDurationHours: number;
  unitsPerWorkerHours: number;
  expectedDurationStdDevHours?: number;
  /** Per-category/weight overrides. Falls back to expectedDurationHours if no rule matches. */
  durationRules: DurationRule[];
  dependencies: string[];
  parallelGroup?: string;
  unitOfWork: UnitOfWork;
  isOptional: boolean;
  isTerminal: boolean;
  displayOrder: number;
  active: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StageDefinitionSchema = new Schema<StageDefinitionDocument>(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    expectedDurationHours: { type: Number, required: true, min: 0, default: 24 },
    unitsPerWorkerHours: { type: Number, min: 0, default: 0 },
    expectedDurationStdDevHours: { type: Number, min: 0 },
    durationRules: {
      type: [{
        category:    { type: String, default: "" },
        weightLabel: { type: String, default: "" },
        weightMin:   { type: Number, required: true, min: 0, default: 0 },
        weightMax:   { type: Number, required: true, min: 0, default: 9999 },
        qty:         { type: Number, min: 0, default: 1 },
        hours:       { type: Number, required: true, min: 0 },
        _id: false,
      }],
      default: [],
    },
    dependencies: { type: [String], default: [] },
    parallelGroup: { type: String, trim: true },
    unitOfWork: { type: String, required: true, enum: UNIT_OF_WORK, default: "piece" },
    isOptional: { type: Boolean, default: false },
    isTerminal: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

export const StageDefinition =
  (models.StageDefinition as Model<StageDefinitionDocument>) ??
  model<StageDefinitionDocument>("StageDefinition", StageDefinitionSchema);
