import { Document, Schema, model, models, type Model } from "mongoose";

export interface LegacyClientDocument extends Document {
  Name?: string;
  ImageUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const LegacyClientSchema = new Schema<LegacyClientDocument>(
  {
    Name: { type: String, trim: true },
    ImageUrl: { type: String, trim: true },
  },
  {
    strict: false,
    collection: "clients",
    timestamps: false,
  }
);

export const LegacyClient =
  models.LegacyClient
    ? (models.LegacyClient as Model<LegacyClientDocument>)
    : model<LegacyClientDocument>("LegacyClient", LegacyClientSchema);
