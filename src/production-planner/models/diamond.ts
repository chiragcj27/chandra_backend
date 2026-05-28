import { Document, Schema, model, models, type Model } from "mongoose";

export interface DiamondDocument extends Document {
  /** Auto-built: `${gSize}|${sieve}|${diaSizeMM}` */
  code: string;
  gSize: string;
  sieve: string;
  diaSizeMM: number;
  pointer?: number;
  clarity?: string;
  color?: string;
  costPerStone?: number;
  reorderThreshold?: number;
  reorderQty?: number;
  procurementLeadTimeDays?: number;
  preferredSupplier?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DiamondSchema = new Schema<DiamondDocument>(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
    gSize: { type: String, required: true, trim: true, index: true },
    sieve: { type: String, required: true, trim: true, index: true },
    diaSizeMM: { type: Number, required: true, min: 0, index: true },
    pointer: { type: Number, min: 0 },
    clarity: { type: String, trim: true },
    color: { type: String, trim: true },
    costPerStone: { type: Number, min: 0 },
    reorderThreshold: { type: Number, min: 0, default: 0 },
    reorderQty: { type: Number, min: 0, default: 0 },
    procurementLeadTimeDays: { type: Number, min: 0, default: 0 },
    preferredSupplier: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

DiamondSchema.index({ gSize: 1, sieve: 1, diaSizeMM: 1 }, { unique: true });

export const Diamond =
  (models.Diamond as Model<DiamondDocument>) ?? model<DiamondDocument>("Diamond", DiamondSchema);

/** Build the canonical Diamond code from its three key fields. */
export function buildDiamondCode(gSize: string, sieve: string, diaSizeMM: number): string {
  return `${gSize.trim()}|${sieve.trim()}|${diaSizeMM}`;
}
