import { Document, Schema, Types, model, models, type Model } from "mongoose";

export interface SeatDocument extends Document {
  code: string;
  cellId: Types.ObjectId;
  cellCode: string;
  stageCodes: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SeatSchema = new Schema<SeatDocument>(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    cellId: { type: Schema.Types.ObjectId, ref: "Cell", required: true, index: true },
    cellCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    stageCodes: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Seat =
  (models.Seat as Model<SeatDocument>) ?? model<SeatDocument>("Seat", SeatSchema);
