import { Document, Schema, model, models, type Model } from "mongoose";

export interface ProductionShift {
  name: string;
  startTime: string;
  endTime: string;
}

export interface ProductionCalendarDocument extends Document {
  /** Singleton — only one active calendar at a time. */
  key: string;
  shifts: ProductionShift[];
  /** Days of week considered non-working. 0 = Sunday, 6 = Saturday. */
  weekendDays: number[];
  /** ISO date strings YYYY-MM-DD treated as holidays. */
  holidayDates: string[];
  defaultDailyHours: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductionShiftSchema = new Schema<ProductionShift>(
  {
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const ProductionCalendarSchema = new Schema<ProductionCalendarDocument>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    shifts: { type: [ProductionShiftSchema], default: [] },
    weekendDays: { type: [Number], default: [0] },
    holidayDates: { type: [String], default: [] },
    defaultDailyHours: { type: Number, default: 9, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ProductionCalendar =
  (models.ProductionCalendar as Model<ProductionCalendarDocument>) ??
  model<ProductionCalendarDocument>("ProductionCalendar", ProductionCalendarSchema);
