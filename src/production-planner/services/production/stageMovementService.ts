import { Types } from "mongoose";

import { StageMovement, type StageMovementDocument } from "../../models/stageMovement";

/**
 * Append an "entry" StageMovement for `qty` pieces at (stage, cell) for a JobCard.
 * Caller is responsible for figuring out the qty delta from the WIP diff.
 */
export async function openMovement(input: {
  jobCardId: Types.ObjectId;
  gatiPieceCode: string;
  toStageCode: string;
  cellCode: string;
  fromStageCode?: string;
  qty: number;
  enteredAt?: Date;
}): Promise<StageMovementDocument> {
  return StageMovement.create({
    jobCardId: input.jobCardId,
    gatiPieceCode: input.gatiPieceCode,
    toStageCode: input.toStageCode,
    cellCode: input.cellCode,
    fromStageCode: input.fromStageCode,
    qty: input.qty,
    enteredAt: input.enteredAt ?? new Date(),
  });
}

/**
 * Close `qty` pieces leaving (stage, cell) for a JobCard.
 *
 * Implementation: FIFO across the open movements for that (jobCard, stage, cell).
 * Each open movement is consumed oldest-first until `qty` is satisfied.
 * If the last consumed movement has more qty than we're closing, it is **split**:
 * the closed portion becomes a NEW closed movement (with the original `enteredAt`),
 * and the original movement's qty is reduced by the closed amount.
 *
 * Returns the list of closed (or newly-created closed-split) movements.
 */
export async function closeMovements(input: {
  jobCardId: Types.ObjectId;
  gatiPieceCode: string;
  stageCode: string;
  cellCode: string;
  qty: number;
  exitedAt?: Date;
  toStageCode?: string;
}): Promise<StageMovementDocument[]> {
  const exitedAt = input.exitedAt ?? new Date();
  let remaining = input.qty;
  const closed: StageMovementDocument[] = [];

  const openMovs = await StageMovement.find({
    jobCardId: input.jobCardId,
    toStageCode: input.stageCode,
    cellCode: input.cellCode,
    exitedAt: { $exists: false },
  }).sort({ enteredAt: 1 });

  for (const mv of openMovs) {
    if (remaining <= 0) break;

    if (mv.qty <= remaining) {
      mv.exitedAt = exitedAt;
      mv.durationHours = (exitedAt.getTime() - mv.enteredAt.getTime()) / 3_600_000;
      await mv.save();
      closed.push(mv);
      remaining -= mv.qty;
    } else {
      // Split: this movement has more qty than we need to close.
      // Create a new closed movement with the closed qty preserving enteredAt.
      const split = await StageMovement.create({
        jobCardId: mv.jobCardId,
        gatiPieceCode: mv.gatiPieceCode,
        toStageCode: mv.toStageCode,
        cellCode: mv.cellCode,
        fromStageCode: mv.fromStageCode,
        qty: remaining,
        enteredAt: mv.enteredAt,
        exitedAt,
        durationHours: (exitedAt.getTime() - mv.enteredAt.getTime()) / 3_600_000,
      });
      mv.qty = mv.qty - remaining;
      await mv.save();
      closed.push(split);
      remaining = 0;
    }
  }

  // If `remaining > 0` here we asked to close more qty than was open. This
  // can happen with messy WIP exports — we don't throw; the caller should
  // log it and the next import will rebalance.
  return closed;
}

/** Full StageMovement timeline (newest first) for a JobCard. */
export async function timelineForJobCard(jobCardId: Types.ObjectId): Promise<StageMovementDocument[]> {
  return StageMovement.find({ jobCardId }).sort({ enteredAt: -1 });
}
