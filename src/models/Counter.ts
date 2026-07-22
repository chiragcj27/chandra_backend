import { Document, Schema, model, models, type Model } from "mongoose";

export interface CounterDocument extends Document<string> {
  seq: number;
}

const CounterSchema = new Schema<CounterDocument>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter =
  models.Counter
    ? (models.Counter as Model<CounterDocument>)
    : model<CounterDocument>("Counter", CounterSchema);
