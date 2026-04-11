import { Document, Schema, model, models, type Model } from "mongoose";

export type AdminUserRole = "admin";

export interface AdminUserDocument extends Document {
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminUserSchema = new Schema<AdminUserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const AdminUser = models.AdminUser
  ? (models.AdminUser as Model<AdminUserDocument>)
  : model<AdminUserDocument>("AdminUser", AdminUserSchema);

