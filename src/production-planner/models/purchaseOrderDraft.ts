import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { PO_STATUSES, type PoStatus } from "../types";

export interface PurchaseOrderLine {
  diamondCode: string;
  qty: number;
  costEstimate?: number;
  notes?: string;
}

export interface PurchaseOrderDraftDocument extends Document {
  poNumber: string;
  supplier?: string;
  lines: PurchaseOrderLine[];
  totalCost: number;
  status: PoStatus;
  triggeredByAlertId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  sentAt?: Date;
  receivedAt?: Date;
  cancelledAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseOrderLineSchema = new Schema<PurchaseOrderLine>(
  {
    diamondCode: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0 },
    costEstimate: { type: Number, min: 0 },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const PurchaseOrderDraftSchema = new Schema<PurchaseOrderDraftDocument>(
  {
    poNumber: { type: String, required: true, unique: true, trim: true, index: true },
    supplier: { type: String, trim: true, index: true },
    lines: { type: [PurchaseOrderLineSchema], default: [] },
    totalCost: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: PO_STATUSES, default: "draft", index: true },
    triggeredByAlertId: { type: Schema.Types.ObjectId, ref: "Alert" },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
    approvedAt: { type: Date },
    sentAt: { type: Date },
    receivedAt: { type: Date },
    cancelledAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const PurchaseOrderDraft =
  (models.PurchaseOrderDraft as Model<PurchaseOrderDraftDocument>) ??
  model<PurchaseOrderDraftDocument>("PurchaseOrderDraft", PurchaseOrderDraftSchema);
