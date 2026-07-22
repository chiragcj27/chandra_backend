import { Document, Schema, Types, model, models, type Model } from "mongoose";

import {
  IMPORT_FILE_TYPES,
  IMPORT_RUN_STATUSES,
  type ImportFileType,
  type ImportRowError,
  type ImportRunStatus,
} from "../types";

export interface GatiImportRunDocument extends Document {
  fileType: ImportFileType;
  fileName?: string;
  uploadedBy?: Types.ObjectId;
  uploadedAt: Date;
  rowCount: number;
  inserted: number;
  updated: number;
  skipped: number;
  errored: number;
  /** Per-row import errors. Named `rowErrors` (not `errors`) to avoid colliding with Mongoose Document.errors. */
  rowErrors: ImportRowError[];
  unmappedColumns: string[];
  status: ImportRunStatus;
  startedAt?: Date;
  finishedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ImportRowErrorSchema = new Schema<ImportRowError>(
  {
    row: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    raw: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const GatiImportRunSchema = new Schema<GatiImportRunDocument>(
  {
    fileType: { type: String, required: true, enum: IMPORT_FILE_TYPES, index: true },
    fileName: { type: String, trim: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    uploadedAt: { type: Date, required: true, default: Date.now, index: true },
    rowCount: { type: Number, default: 0 },
    inserted: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errored: { type: Number, default: 0 },
    rowErrors: { type: [ImportRowErrorSchema], default: [] },
    unmappedColumns: { type: [String], default: [] },
    status: { type: String, enum: IMPORT_RUN_STATUSES, default: "pending", index: true },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    errorMessage: { type: String, trim: true },
  },
  { timestamps: true }
);

export const GatiImportRun =
  (models.GatiImportRun as Model<GatiImportRunDocument>) ??
  model<GatiImportRunDocument>("GatiImportRun", GatiImportRunSchema);
