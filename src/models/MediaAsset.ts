import { Document, Schema, model, models, type Model } from "mongoose";

export interface MediaAssetDocument extends Document {
  name: string;
  key: string;
  publicUrl: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

const MediaAssetSchema = new Schema<MediaAssetDocument>(
  {
    name: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    publicUrl: { type: String, required: true },
    size: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: true, strict: false }
);

MediaAssetSchema.index({ name: "text" });

export const MediaAsset =
  models.MediaAsset
    ? (models.MediaAsset as Model<MediaAssetDocument>)
    : model<MediaAssetDocument>("MediaAsset", MediaAssetSchema);
