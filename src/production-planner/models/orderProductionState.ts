import { Document, Schema, Types, model, models, type Model } from "mongoose";

import { ORDER_AGGREGATE_STATUSES, type OrderAggregateStatus } from "../types";

export interface OrderProductionStateDocument extends Document {
  orderNumber: string;
  chandraOrderId?: Types.ObjectId;
  aggregateStatus: OrderAggregateStatus;
  jobCardCount: number;
  completedCount: number;
  inProgressCount: number;
  delayedCount: number;
  earliestExpectedDeliveryAt?: Date;
  worstLatenessDays: number;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderProductionStateSchema = new Schema<OrderProductionStateDocument>(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true, index: true },
    chandraOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
    aggregateStatus: {
      type: String,
      enum: ORDER_AGGREGATE_STATUSES,
      default: "pending",
      index: true,
    },
    jobCardCount: { type: Number, default: 0, min: 0 },
    completedCount: { type: Number, default: 0, min: 0 },
    inProgressCount: { type: Number, default: 0, min: 0 },
    delayedCount: { type: Number, default: 0, min: 0 },
    earliestExpectedDeliveryAt: { type: Date, index: true },
    worstLatenessDays: { type: Number, default: 0 },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const OrderProductionState =
  (models.OrderProductionState as Model<OrderProductionStateDocument>) ??
  model<OrderProductionStateDocument>("OrderProductionState", OrderProductionStateSchema);
