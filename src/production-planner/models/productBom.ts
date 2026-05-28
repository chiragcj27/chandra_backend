import { Document, Schema, model, models, type Model } from "mongoose";

import type { DiamondSpec } from "../types";

export interface ProductBomDocument extends Document {
  styleNo: string;
  expectedDiamonds: DiamondSpec[];
  expectedMetalGrams: number;
  expectedMetalType?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExpectedDiamondSchema = new Schema<DiamondSpec>(
  {
    gSize: { type: String, required: true, trim: true },
    sieve: { type: String, required: true, trim: true },
    diaSizeMM: { type: Number, required: true, min: 0 },
    pointer: { type: Number, required: true, min: 0 },
    totalCaratsPerPiece: { type: Number, required: true, min: 0 },
    stonesPerPiece: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ProductBomSchema = new Schema<ProductBomDocument>(
  {
    styleNo: { type: String, required: true, unique: true, trim: true, index: true },
    expectedDiamonds: { type: [ExpectedDiamondSchema], default: [] },
    expectedMetalGrams: { type: Number, default: 0, min: 0 },
    expectedMetalType: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const ProductBom =
  (models.ProductBom as Model<ProductBomDocument>) ??
  model<ProductBomDocument>("ProductBom", ProductBomSchema);
