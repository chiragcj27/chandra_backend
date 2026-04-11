import { Document, Schema, model, models, type Model } from "mongoose";

export interface ClientUserDocument extends Document {
  clientName: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClientUserSchema = new Schema<ClientUserDocument>(
  {
    clientName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const ClientUser =
  models.ClientUser
    ? (models.ClientUser as Model<ClientUserDocument>)
    : model<ClientUserDocument>("ClientUser", ClientUserSchema);

