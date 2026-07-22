import { Types } from "mongoose";

import {
  DiamondAllocation,
  type DiamondAllocationDocument,
} from "../../models/diamondAllocation";
import { JobCard } from "../../models/jobCard";
import { addLedgerEntry } from "./inventoryLedgerService";

export interface AllocateInput {
  jobCardId: Types.ObjectId;
  diamondCode: string;
  qty: number;
  notes?: string;
}

/**
 * Soft-reserve `qty` stones of a diamond SKU against a JobCard.
 * Writes both the `DiamondAllocation` row AND a balancing ledger entry
 * (movementType="allocation", quantity negative) so `available = onHand - allocated`
 * automatically reflects the reservation.
 */
export async function allocate(input: AllocateInput): Promise<DiamondAllocationDocument> {
  if (input.qty <= 0) throw new Error("qty must be > 0");

  const jc = await JobCard.findById(input.jobCardId).select({ gatiPieceCode: 1 });
  if (!jc) throw new Error("JobCard not found");

  const allocation = await DiamondAllocation.create({
    jobCardId: input.jobCardId,
    gatiPieceCode: jc.gatiPieceCode,
    diamondCode: input.diamondCode,
    quantityAllocated: input.qty,
    quantityConsumed: 0,
    status: "active",
    allocatedAt: new Date(),
    notes: input.notes,
  });

  await addLedgerEntry({
    diamondCode: input.diamondCode,
    movementType: "allocation",
    quantity: -input.qty,
    jobCardId: input.jobCardId,
    gatiPieceCode: jc.gatiPieceCode,
    notes: `Allocation #${String(allocation._id)}`,
  });

  return allocation;
}

/**
 * Convert (part of) an active allocation into actual consumption.
 * If `qty` is omitted, the full remaining allocated qty is consumed.
 *
 * - Bumps `quantityConsumed` on the allocation.
 * - Appends a ledger entry of movementType="consumption" (already a sub-zero
 *   delta — but since the allocation entry already decremented onHand at
 *   reserve time, the *additional* effect of consumption on onHand is zero.
 *   We log it with quantity=0 so the audit trail still shows the event without
 *   double-counting.)
 * - Closes the allocation when fully consumed.
 */
export async function consume(
  allocationId: Types.ObjectId | string,
  qty?: number
): Promise<DiamondAllocationDocument> {
  const allocation = await DiamondAllocation.findById(allocationId);
  if (!allocation) throw new Error("Allocation not found");
  if (allocation.status !== "active") throw new Error("Allocation is not active");

  const remaining = allocation.quantityAllocated - allocation.quantityConsumed;
  const consumeQty = qty == null ? remaining : Math.min(qty, remaining);
  if (consumeQty <= 0) throw new Error("Nothing left to consume");

  allocation.quantityConsumed += consumeQty;
  if (allocation.quantityConsumed >= allocation.quantityAllocated) {
    allocation.status = "completed";
    allocation.consumedAt = new Date();
  }
  await allocation.save();

  await addLedgerEntry({
    diamondCode: allocation.diamondCode,
    movementType: "consumption",
    // Zero net effect on onHand — the original allocation entry already
    // debited the stones. Logged for audit (with consumeQty in notes).
    quantity: 0,
    jobCardId: allocation.jobCardId,
    gatiPieceCode: allocation.gatiPieceCode,
    notes: `Consume ${consumeQty} from allocation #${String(allocation._id)}`,
  });

  return allocation;
}

/**
 * Release an active allocation that's no longer needed (e.g. JobCard cancelled).
 * Writes a positive `return` ledger entry to undo the allocation's effect on onHand.
 */
export async function release(
  allocationId: Types.ObjectId | string
): Promise<DiamondAllocationDocument> {
  const allocation = await DiamondAllocation.findById(allocationId);
  if (!allocation) throw new Error("Allocation not found");
  if (allocation.status !== "active") throw new Error("Allocation is not active");

  const remaining = allocation.quantityAllocated - allocation.quantityConsumed;
  if (remaining > 0) {
    await addLedgerEntry({
      diamondCode: allocation.diamondCode,
      movementType: "return",
      quantity: remaining,
      jobCardId: allocation.jobCardId,
      gatiPieceCode: allocation.gatiPieceCode,
      notes: `Release allocation #${String(allocation._id)}`,
    });
  }

  allocation.status = "released";
  allocation.releasedAt = new Date();
  await allocation.save();
  return allocation;
}

/** Active allocated stones per diamond code (across all active allocations). */
export async function getAllocatedMap(): Promise<Map<string, number>> {
  const rows = await DiamondAllocation.aggregate<{ _id: string; total: number }>([
    { $match: { status: "active" } },
    {
      $group: {
        _id: "$diamondCode",
        total: { $sum: { $subtract: ["$quantityAllocated", "$quantityConsumed"] } },
      },
    },
  ]);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r._id, r.total);
  return out;
}

export async function getAllocationsByJobCard(
  jobCardId: Types.ObjectId | string
): Promise<DiamondAllocationDocument[]> {
  return DiamondAllocation.find({ jobCardId }).sort({ allocatedAt: -1 });
}
