import { Document, Schema, model, models, type Model } from "mongoose";

export interface CellDocument extends Document {
  code: string;
  name: string;
  stageCodes: string[];
  /** How many people staff this cell. Defaults to 1. */
  workersCount?: number;
  description?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CellSchema = new Schema<CellDocument>(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    stageCodes: { type: [String], default: [], index: true },
    workersCount: { type: Number, min: 1, default: 1 },
    description: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Cell =
  (models.Cell as Model<CellDocument>) ?? model<CellDocument>("Cell", CellSchema);
