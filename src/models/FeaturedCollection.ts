import { Document, Schema, Types, model, models, type Model } from "mongoose";

export type FeaturedCollectionItemType = "subcategory" | "product";

export interface FeaturedCollectionItem {
  _id: Types.ObjectId;
  type: FeaturedCollectionItemType;
  subcategoryId?: Types.ObjectId;
  productId?: Types.ObjectId;
  displayOrder: number;
}

export interface FeaturedCollectionDocument extends Document {
  name: string;
  description?: string;
  bannerImageKey: string;
  bannerImageUrl: string;
  displayOrder: number;
  isActive: boolean;
  items: FeaturedCollectionItem[];
  createdAt: Date;
  updatedAt: Date;
}

const FeaturedCollectionItemSchema = new Schema<FeaturedCollectionItem>(
  {
    type: { type: String, enum: ["subcategory", "product"], required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: "Subcategory" },
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    displayOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const FeaturedCollectionSchema = new Schema<FeaturedCollectionDocument>(
  {
    name: { type: String, required: true },
    description: { type: String },
    bannerImageKey: { type: String, required: true },
    bannerImageUrl: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    items: { type: [FeaturedCollectionItemSchema], default: [] },
  },
  { timestamps: true },
);

export const FeaturedCollection =
  models.FeaturedCollection
    ? (models.FeaturedCollection as Model<FeaturedCollectionDocument>)
    : model<FeaturedCollectionDocument>("FeaturedCollection", FeaturedCollectionSchema);
