import { Document, Schema, Types, model, models, type Model } from "mongoose";

import {
  ALERT_SEVERITIES,
  ALERT_SUBJECT_TYPES,
  ALERT_TYPES,
  type AlertSeverity,
  type AlertSubjectType,
  type AlertType,
} from "../types";

export interface AlertDocument extends Document {
  type: AlertType;
  severity: AlertSeverity;
  subjectType: AlertSubjectType;
  subjectId: string;
  message: string;
  payload?: Record<string, unknown>;
  raisedAt: Date;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema = new Schema<AlertDocument>(
  {
    type: { type: String, required: true, enum: ALERT_TYPES, index: true },
    severity: { type: String, required: true, enum: ALERT_SEVERITIES, index: true },
    subjectType: { type: String, required: true, enum: ALERT_SUBJECT_TYPES, index: true },
    subjectId: { type: String, required: true, index: true },
    message: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed },
    raisedAt: { type: Date, required: true, default: Date.now, index: true },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date, index: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

AlertSchema.index({ type: 1, subjectType: 1, subjectId: 1, resolvedAt: 1 });

export const Alert =
  (models.Alert as Model<AlertDocument>) ?? model<AlertDocument>("Alert", AlertSchema);
