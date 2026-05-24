import { Document, Schema, model, models, type Model } from "mongoose";

export interface CellDocument extends Document {
  code: string;
  name: string;
  stageCodes: string[];
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
    description: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Cell =
  (models.Cell as Model<CellDocument>) ?? model<CellDocument>("Cell", CellSchema);
