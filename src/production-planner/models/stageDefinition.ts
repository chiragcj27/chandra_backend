import { Document, Schema, model, models, type Model } from "mongoose";

import { UNIT_OF_WORK, type UnitOfWork } from "../types";

export interface StageDefinitionDocument extends Document {
  code: string;
  name: string;
  expectedDurationHours: number;
  expectedDurationStdDevHours?: number;
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
    expectedDurationStdDevHours: { type: Number, min: 0 },
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
