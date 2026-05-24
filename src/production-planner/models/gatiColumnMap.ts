import { Document, Schema, model, models, type Model } from "mongoose";

import { IMPORT_FILE_TYPES, type ImportFileType } from "../types";

/** Aliases that classify rows in the Order Excel by `RawAliasName`. */
export interface GatiAliasMap {
  diamond: string[];
  metal: string[];
  finding: string[];
}

/** Order Excel: maps a raw column header to a dot-path on the JobCard. */
export interface GatiOrderColumnEntry {
  rawColumn: string;
  fieldPath: string;
  required?: boolean;
}

/** WIP Excel: maps a raw stage-column to (stageCode, cellCode). */
export interface GatiWipColumnEntry {
  rawColumn: string;
  stageCode: string;
  cellCode: string;
}

export interface GatiColumnMapDocument extends Document {
  fileType: ImportFileType;
  version: number;
  aliases: GatiAliasMap;
  orderColumns: GatiOrderColumnEntry[];
  wipColumns: GatiWipColumnEntry[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GatiAliasMapSchema = new Schema<GatiAliasMap>(
  {
    diamond: { type: [String], default: [] },
    metal: { type: [String], default: [] },
    finding: { type: [String], default: [] },
  },
  { _id: false }
);

const GatiOrderColumnEntrySchema = new Schema<GatiOrderColumnEntry>(
  {
    rawColumn: { type: String, required: true, trim: true },
    fieldPath: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const GatiWipColumnEntrySchema = new Schema<GatiWipColumnEntry>(
  {
    rawColumn: { type: String, required: true, trim: true },
    stageCode: { type: String, required: true, trim: true, uppercase: true },
    cellCode: { type: String, required: true, trim: true, uppercase: true },
  },
  { _id: false }
);

const GatiColumnMapSchema = new Schema<GatiColumnMapDocument>(
  {
    fileType: { type: String, required: true, enum: IMPORT_FILE_TYPES, index: true },
    version: { type: Number, required: true, default: 1 },
    aliases: { type: GatiAliasMapSchema, default: () => ({ diamond: [], metal: [], finding: [] }) },
    orderColumns: { type: [GatiOrderColumnEntrySchema], default: [] },
    wipColumns: { type: [GatiWipColumnEntrySchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

GatiColumnMapSchema.index({ fileType: 1, active: 1 });

export const GatiColumnMap =
  (models.GatiColumnMap as Model<GatiColumnMapDocument>) ??
  model<GatiColumnMapDocument>("GatiColumnMap", GatiColumnMapSchema);
