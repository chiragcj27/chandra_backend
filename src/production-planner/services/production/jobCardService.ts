import { Types } from "mongoose";

import { Order } from "../../../models/Order";
import { JobCard, type JobCardDocument } from "../../models/jobCard";
import {
  type DiamondSpec,
  type FindingEntry,
  type JobCardStatus,
  type PriorityLevel,
} from "../../types";

export interface JobCardImportPayload {
  gatiPieceCode: string;
  orderNumber: string;
  orderItemSrNo: number;
  totalQty: number;
  styleNo?: string;
  size?: string;
  customerCode?: string;
  itemCategory?: string;
  diamondSpecs: DiamondSpec[];
  totalStones: number;
  metalType?: string;
  metalWeightPerPiece: number;
  totalMetalWeight: number;
  findings: FindingEntry[];
  priority?: PriorityLevel;
  expectedDeliveryAt?: Date;
  orderedAt?: Date;
}

export type UpsertAction = "inserted" | "updated" | "noop";

/**
 * Deep-equality on the JobCard fields owned by the Order import.
 * Returns true if `payload` matches what's already on `existing`.
 *
 * Fields NOT compared here (and therefore never touched by an Order re-import):
 *   - currentStageDistribution, status, plannedCompletionAt, actualCompletionAt
 *     (those are owned by the WIP importer in Phase 2)
 *   - findingsReceived / findingsReceivedAt (manual admin toggle)
 *   - notes (manual)
 *   - chandraOrderId (set by the import once; not part of the payload)
 */
function payloadMatchesExisting(payload: JobCardImportPayload, existing: JobCardDocument): boolean {
  if (existing.totalQty !== payload.totalQty) return false;
  if ((existing.styleNo ?? undefined) !== payload.styleNo) return false;
  if ((existing.size ?? undefined) !== payload.size) return false;
  if ((existing.customerCode ?? undefined) !== payload.customerCode) return false;
  if (existing.totalStones !== payload.totalStones) return false;
  if ((existing.metalType ?? undefined) !== payload.metalType) return false;
  if (existing.metalWeightPerPiece !== payload.metalWeightPerPiece) return false;
  if (existing.totalMetalWeight !== payload.totalMetalWeight) return false;

  const a = payload.expectedDeliveryAt?.getTime() ?? null;
  const b = existing.expectedDeliveryAt instanceof Date ? existing.expectedDeliveryAt.getTime() : null;
  if (a !== b) return false;

  const aOrd = payload.orderedAt?.getTime() ?? null;
  const bOrd = existing.orderedAt instanceof Date ? existing.orderedAt.getTime() : null;
  if (aOrd !== bOrd) return false;

  if ((payload.priority ?? "normal") !== existing.priority) return false;

  // Diamond specs deep-equal (order-sensitive)
  if (existing.diamondSpecs.length !== payload.diamondSpecs.length) return false;
  for (let i = 0; i < payload.diamondSpecs.length; i++) {
    const x = payload.diamondSpecs[i];
    const y = existing.diamondSpecs[i];
    if (!y) return false;
    if (x.gSize !== y.gSize) return false;
    if (x.sieve !== y.sieve) return false;
    if (x.diaSizeMM !== y.diaSizeMM) return false;
    if (x.pointer !== y.pointer) return false;
    if (x.totalCaratsPerPiece !== y.totalCaratsPerPiece) return false;
    if (x.stonesPerPiece !== y.stonesPerPiece) return false;
  }

  if (existing.findings.length !== payload.findings.length) return false;
  for (let i = 0; i < payload.findings.length; i++) {
    if (existing.findings[i]?.code !== payload.findings[i].code) return false;
    if (existing.findings[i]?.qty !== payload.findings[i].qty) return false;
  }

  return true;
}

/**
 * Upsert a JobCard from an Order Excel import payload.
 *
 * - If no doc exists for `gatiPieceCode` → insert.
 * - If a doc exists and the payload matches it → `noop`.
 * - Else → mutate non-key fields and save → `updated`.
 *
 * Phase 2 (WIP) fields (`currentStageDistribution`, `status`, completion timestamps)
 * are NEVER touched by this function.
 */
export async function upsertFromOrderImport(
  payload: JobCardImportPayload
): Promise<{ doc: JobCardDocument; action: UpsertAction }> {
  const existing = await JobCard.findOne({ gatiPieceCode: payload.gatiPieceCode });

  if (!existing) {
    // Best-effort parent Order link (read-only against chandra collection).
    const parent = await Order.findOne({ orderNumber: payload.orderNumber })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();

    const doc = await JobCard.create({
      gatiPieceCode: payload.gatiPieceCode,
      orderNumber: payload.orderNumber,
      orderItemSrNo: payload.orderItemSrNo,
      totalQty: payload.totalQty,
      styleNo: payload.styleNo,
      size: payload.size,
      customerCode: payload.customerCode,
      diamondSpecs: payload.diamondSpecs,
      totalStones: payload.totalStones,
      metalType: payload.metalType,
      metalWeightPerPiece: payload.metalWeightPerPiece,
      totalMetalWeight: payload.totalMetalWeight,
      findings: payload.findings,
      findingsReceived: false,
      priority: payload.priority ?? "normal",
      expectedDeliveryAt: payload.expectedDeliveryAt,
      orderedAt: payload.orderedAt,
      status: "pending" satisfies JobCardStatus,
      currentStageDistribution: [],
      chandraOrderId: parent?._id,
    });
    return { doc, action: "inserted" };
  }

  if (payloadMatchesExisting(payload, existing)) {
    return { doc: existing, action: "noop" };
  }

  existing.totalQty = payload.totalQty;
  existing.styleNo = payload.styleNo;
  existing.size = payload.size;
  existing.customerCode = payload.customerCode;
  existing.diamondSpecs = payload.diamondSpecs;
  existing.totalStones = payload.totalStones;
  existing.metalType = payload.metalType;
  existing.metalWeightPerPiece = payload.metalWeightPerPiece;
  existing.totalMetalWeight = payload.totalMetalWeight;
  existing.findings = payload.findings;
  existing.priority = payload.priority ?? existing.priority;
  if (payload.expectedDeliveryAt) existing.expectedDeliveryAt = payload.expectedDeliveryAt;
  if (payload.orderedAt) existing.orderedAt = payload.orderedAt;

  await existing.save();
  return { doc: existing, action: "updated" };
}

export interface ListJobCardsQuery {
  status?: string;
  customerCode?: string;
  priority?: string;
  orderNumber?: string;
  deliveryBefore?: Date;
  isLate?: boolean;
  limit?: number;
  skip?: number;
}

export async function listJobCards(
  q: ListJobCardsQuery
): Promise<{ items: JobCardDocument[]; total: number }> {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.customerCode) filter.customerCode = q.customerCode;
  if (q.priority) filter.priority = q.priority;
  if (q.orderNumber) filter.orderNumber = q.orderNumber;
  if (q.deliveryBefore) filter.expectedDeliveryAt = { $lte: q.deliveryBefore };
  if (q.isLate) {
    filter.expectedDeliveryAt = { ...((filter.expectedDeliveryAt as object | undefined) ?? {}), $lt: new Date() };
    filter.status = { $nin: ["completed", "cancelled"] };
  }

  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const skip = Math.max(q.skip ?? 0, 0);

  const [items, total] = await Promise.all([
    JobCard.find(filter).sort({ expectedDeliveryAt: 1, createdAt: -1 }).skip(skip).limit(limit),
    JobCard.countDocuments(filter),
  ]);

  return { items, total };
}

export async function getJobCardByPieceCode(code: string): Promise<JobCardDocument | null> {
  return JobCard.findOne({ gatiPieceCode: code });
}

export async function setFindingsReceived(
  code: string,
  received: boolean
): Promise<JobCardDocument | null> {
  const doc = await JobCard.findOne({ gatiPieceCode: code });
  if (!doc) return null;
  doc.findingsReceived = received;
  doc.findingsReceivedAt = received ? new Date() : undefined;
  await doc.save();
  return doc;
}

export async function setPriority(
  code: string,
  priority: PriorityLevel
): Promise<JobCardDocument | null> {
  const doc = await JobCard.findOne({ gatiPieceCode: code });
  if (!doc) return null;
  doc.priority = priority;
  await doc.save();
  return doc;
}
