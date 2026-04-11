import { Document, Schema, model, models, type Model } from "mongoose";

export interface BannerDocument extends Document {
  title: string;
  imageKey: string;
  imageUrl: string;
  linkUrl?: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BannerSchema = new Schema<BannerDocument>(
  {
    title: { type: String, required: true },
    imageKey: { type: String, required: true },
    imageUrl: { type: String, required: true },
    linkUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Banner =
  models.Banner ? (models.Banner as Model<BannerDocument>) : model<BannerDocument>("Banner", BannerSchema);

