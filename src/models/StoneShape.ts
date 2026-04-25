import { Document, Schema, model, models, type Model } from "mongoose";

export interface StoneShapeDocument extends Document {
  name: string;
  thumbnailImage: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StoneShapeSchema = new Schema<StoneShapeDocument>(
  {
    name: { type: String, required: true, trim: true },
    thumbnailImage: { type: String, required: true, trim: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

StoneShapeSchema.index({ name: 1 }, { unique: true });

export const StoneShape =
  models.StoneShape
    ? (models.StoneShape as Model<StoneShapeDocument>)
    : model<StoneShapeDocument>("StoneShape", StoneShapeSchema);

