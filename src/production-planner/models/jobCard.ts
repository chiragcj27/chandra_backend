import { Document, Schema, Types, model, models, type Model } from "mongoose";

import {
  JOB_CARD_STATUSES,
  PRIORITY_LEVELS,
  type DiamondSpec,
  type FindingEntry,
  type JobCardStatus,
  type PriorityLevel,
  type StageDistributionEntry,
} from "../types";

export interface JobCardDocument extends Document {
  /** GatiSOFT unique key: `${OrderNoWithoutSrNo}/${OrderItemSrNo}` */
  gatiPieceCode: string;
  orderNumber: string;
  orderItemSrNo: number;
  totalQty: number;
  styleNo?: string;
  size?: string;
  customerCode?: string;
  diamondSpecs: DiamondSpec[];
  totalStones: number;
  metalType?: string;
  metalWeightPerPiece: number;
  totalMetalWeight: number;
  findings: FindingEntry[];
  findingsReceived: boolean;
  findingsReceivedAt?: Date;
  priority: PriorityLevel;
  expectedDeliveryAt?: Date;
  status: JobCardStatus;
  currentStageDistribution: StageDistributionEntry[];
  plannedCompletionAt?: Date;
  actualCompletionAt?: Date;
  orderedAt?: Date;
  /** Optional FK to chandra Order if matched on import. */
  chandraOrderId?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DiamondSpecSchema = new Schema<DiamondSpec>(
  {
    gSize: { type: String, required: true, trim: true },
    sieve: { type: String, required: true, trim: true },
    diaSizeMM: { type: Number, required: true, min: 0 },
    pointer: { type: Number, required: true, min: 0 },
    totalCaratsPerPiece: { type: Number, required: true, min: 0 },
    stonesPerPiece: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const FindingEntrySchema = new Schema<FindingEntry>(
  {
    code: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const StageDistributionEntrySchema = new Schema<StageDistributionEntry>(
  {
    stageCode: { type: String, required: true, trim: true, uppercase: true },
    cellCode: { type: String, required: true, trim: true, uppercase: true },
    qty: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const JobCardSchema = new Schema<JobCardDocument>(
  {
    gatiPieceCode: { type: String, required: true, unique: true, trim: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    orderItemSrNo: { type: Number, required: true, min: 1 },
    totalQty: { type: Number, required: true, min: 1, default: 1 },
    styleNo: { type: String, trim: true, index: true },
    size: { type: String, trim: true },
    customerCode: { type: String, trim: true, index: true },
    diamondSpecs: { type: [DiamondSpecSchema], default: [] },
    totalStones: { type: Number, default: 0, min: 0 },
    metalType: { type: String, trim: true },
    metalWeightPerPiece: { type: Number, default: 0, min: 0 },
    totalMetalWeight: { type: Number, default: 0, min: 0 },
    findings: { type: [FindingEntrySchema], default: [] },
    findingsReceived: { type: Boolean, default: false },
    findingsReceivedAt: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "normal", index: true },
    expectedDeliveryAt: { type: Date, index: true },
    status: { type: String, enum: JOB_CARD_STATUSES, default: "planned", index: true },
    currentStageDistribution: { type: [StageDistributionEntrySchema], default: [] },
    plannedCompletionAt: { type: Date },
    actualCompletionAt: { type: Date },
    orderedAt: { type: Date },
    chandraOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

JobCardSchema.index({ orderNumber: 1, orderItemSrNo: 1 });
JobCardSchema.index({ status: 1, expectedDeliveryAt: 1 });
JobCardSchema.index({ "currentStageDistribution.stageCode": 1 });

export const JobCard =
  (models.JobCard as Model<JobCardDocument>) ?? model<JobCardDocument>("JobCard", JobCardSchema);
