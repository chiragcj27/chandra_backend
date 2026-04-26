import { Document, Schema, Types, model, models, type Model } from "mongoose";

export const ORDER_STATUSES = [
  "order_received",
  "order_confirmed",
  "order_in_production",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderTimelineEntry {
  status: OrderStatus;
  changedAt: Date;
  changedBy: {
    id: Types.ObjectId | string;
    role: "admin" | "client";
  };
  note?: string;
}

export interface OrderItem {
  productId?: Types.ObjectId;
  styleNo?: string;
  title?: string;
  imageUrl?: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  remarks?: string;
  meta?: Record<string, unknown>;
}

export interface OrderDocument extends Document {
  orderNumber: string;
  clientId: string;
  clientName: string;
  clientUsername: string;
  status: OrderStatus;
  items: OrderItem[];
  billingAddress?: string;
  shippingAddress?: string;
  notes?: string;
  currency?: string;
  totalAmount?: number;
  orderMeta?: Record<string, unknown>;
  timeline: OrderTimelineEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const OrderTimelineEntrySchema = new Schema<OrderTimelineEntry>(
  {
    status: { type: String, required: true, enum: ORDER_STATUSES },
    changedAt: { type: Date, required: true, default: Date.now },
    changedBy: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true, enum: ["admin", "client"] },
    },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const OrderItemSchema = new Schema<OrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    styleNo: { type: String, trim: true },
    title: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, min: 0 },
    lineTotal: { type: Number, min: 0 },
    remarks: { type: String, trim: true },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const OrderSchema = new Schema<OrderDocument>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, trim: true, index: true },
    clientName: { type: String, required: true, trim: true },
    clientUsername: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ORDER_STATUSES, default: "order_received", index: true },
    items: { type: [OrderItemSchema], default: [] },
    billingAddress: { type: String, trim: true },
    shippingAddress: { type: String, trim: true },
    notes: { type: String, trim: true },
    currency: { type: String, trim: true },
    totalAmount: { type: Number, min: 0 },
    orderMeta: { type: Schema.Types.Mixed },
    timeline: { type: [OrderTimelineEntrySchema], default: [] },
  },
  { timestamps: true, strict: false }
);

OrderSchema.index({ clientId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });

export const Order =
  models.Order
    ? (models.Order as Model<OrderDocument>)
    : model<OrderDocument>("Order", OrderSchema);
