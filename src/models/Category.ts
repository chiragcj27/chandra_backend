import { Document, Schema, model, models, type Model } from "mongoose";

export interface CategoryDocument extends Document {
  name: string;
  thumbnailImage?: string;
  categoryBannerImages: string[];
  productCount: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<CategoryDocument>(
  {
    name: { type: String, required: true },
    thumbnailImage: { type: String },
    categoryBannerImages: { type: [String], default: [] },
    productCount: { type: Number, default: 0 },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Category =
  models.Category
    ? (models.Category as Model<CategoryDocument>)
    : model<CategoryDocument>("Category", CategorySchema);

