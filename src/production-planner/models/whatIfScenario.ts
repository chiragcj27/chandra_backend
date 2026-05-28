import { Document, Schema, Types, model, models, type Model } from "mongoose";

export interface WhatIfScenarioDocument extends Document {
  name: string;
  description?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WhatIfScenarioSchema = new Schema<WhatIfScenarioDocument>(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true },
    inputs: { type: Schema.Types.Mixed, default: {} },
    outputs: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

export const WhatIfScenario =
  (models.WhatIfScenario as Model<WhatIfScenarioDocument>) ??
  model<WhatIfScenarioDocument>("WhatIfScenario", WhatIfScenarioSchema);
