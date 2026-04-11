import { Document, Schema, Types, model, models, type Model } from "mongoose";

export interface SubcategoryProfileDocument extends Document {
  categoryId: Types.ObjectId;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubcategoryProfileSchema = new Schema<SubcategoryProfileDocument>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    name: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SubcategoryProfileSchema.index({ categoryId: 1, displayOrder: 1 });

export const SubcategoryProfile =
  models.SubcategoryProfile
    ? (models.SubcategoryProfile as Model<SubcategoryProfileDocument>)
    : model<SubcategoryProfileDocument>("SubcategoryProfile", SubcategoryProfileSchema);

