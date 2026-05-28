import type { Types } from "mongoose";

import {
  DiamondInventoryLedger,
  type DiamondInventoryLedgerDocument,
} from "../../models/diamondInventoryLedger";
import type { DiamondLedgerType } from "../../types";

export interface LedgerEntryInput {
  diamondCode: string;
  movementType: DiamondLedgerType;
  /**
   * Signed quantity in stones. By convention:
   *   receipt / return       → POSITIVE
   *   allocation / consumption / loss → NEGATIVE
   *   adjustment             → either sign
   * The service does not flip signs — caller is responsible for getting it right.
   */
  quantity: number;
  jobCardId?: Types.ObjectId;
  gatiPieceCode?: string;
  referenceDoc?: string;
  notes?: string;
  at?: Date;
}

/** Append one signed inventory movement. */
export async function addLedgerEntry(
  input: LedgerEntryInput
): Promise<DiamondInventoryLedgerDocument> {
  return DiamondInventoryLedger.create({
    diamondCode: input.diamondCode,
    movementType: input.movementType,
    quantity: input.quantity,
    jobCardId: input.jobCardId,
    gatiPieceCode: input.gatiPieceCode,
    referenceDoc: input.referenceDoc,
    notes: input.notes,
    at: input.at ?? new Date(),
  });
}

/** Sum every ledger entry for a single diamond SKU → current on-hand stones. */
export async function getOnHand(diamondCode: string): Promise<number> {
  const res = await DiamondInventoryLedger.aggregate<{ total: number }>([
    { $match: { diamondCode } },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]);
  return res[0]?.total ?? 0;
}

/** Bulk-compute on-hand per diamondCode (one query, all SKUs). */
export async function getOnHandMap(): Promise<Map<string, number>> {
  const rows = await DiamondInventoryLedger.aggregate<{ _id: string; total: number }>([
    { $group: { _id: "$diamondCode", total: { $sum: "$quantity" } } },
  ]);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r._id, r.total);
  return out;
}

/** Full ledger for one SKU, newest first. */
export async function listLedgerForCode(
  diamondCode: string,
  limit = 200
): Promise<DiamondInventoryLedgerDocument[]> {
  return DiamondInventoryLedger.find({ diamondCode })
    .sort({ at: -1 })
    .limit(Math.min(Math.max(limit, 1), 1000));
}

export interface LedgerStats {
  /** Net on-hand stones = sum of all signed quantities. */
  onHand: number;
  /** Total stones received via GRN / receipt movements. */
  totalReceived: number;
  /** Total stones returned from cancelled/modified orders. */
  totalReturned: number;
  /** Total stones written off as lost/broken/chipped (positive count). */
  totalLost: number;
  /** Total stones soft-reserved for active JobCards (positive count). */
  totalAllocated: number;
  /** Total stones physically consumed (set into jewelry pieces). */
  totalConsumed: number;
}

/**
 * Single-pass aggregation giving the issued / lost / allocated / consumed
 * breakdown for one diamond SKU. Used by the ledger screen summary card.
 */
export async function getLedgerStats(diamondCode: string): Promise<LedgerStats> {
  const res = await DiamondInventoryLedger.aggregate<{
    onHand: number;
    totalReceived: number;
    totalReturned: number;
    totalLost: number;
    totalAllocated: number;
    totalConsumed: number;
  }>([
    { $match: { diamondCode } },
    {
      $group: {
        _id: null,
        onHand: { $sum: "$quantity" },
        totalReceived: {
          $sum: { $cond: [{ $eq: ["$movementType", "receipt"] }, "$quantity", 0] },
        },
        totalReturned: {
          $sum: { $cond: [{ $eq: ["$movementType", "return"] }, "$quantity", 0] },
        },
        totalLost: {
          $sum: { $cond: [{ $eq: ["$movementType", "loss"] }, { $abs: "$quantity" }, 0] },
        },
        totalAllocated: {
          $sum: { $cond: [{ $eq: ["$movementType", "allocation"] }, { $abs: "$quantity" }, 0] },
        },
        totalConsumed: {
          $sum: { $cond: [{ $eq: ["$movementType", "consumption"] }, { $abs: "$quantity" }, 0] },
        },
      },
    },
  ]);
  return {
    onHand: res[0]?.onHand ?? 0,
    totalReceived: res[0]?.totalReceived ?? 0,
    totalReturned: res[0]?.totalReturned ?? 0,
    totalLost: res[0]?.totalLost ?? 0,
    totalAllocated: res[0]?.totalAllocated ?? 0,
    totalConsumed: res[0]?.totalConsumed ?? 0,
  };
}
