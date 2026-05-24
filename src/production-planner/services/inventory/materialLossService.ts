import { Types } from "mongoose";

import { JobCard } from "../../models/jobCard";
import { MetalLedger } from "../../models/metalLedger";
import { StageMovement } from "../../models/stageMovement";

export interface MaterialLossSummary {
  totalIssuedGrams: number;
  totalReturnedGrams: number;
  totalFinalPieceGrams: number;
  totalGoldLossGrams: number;
  goldLossPct: number;
  totalStonesIn: number;
  totalStonesOut: number;
  totalStoneLoss: number;
  jobCardCount: number;
}

interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Aggregate gold & stone loss across all (or a date-filtered slice of) closed
 * StageMovements. Caller can pass a date range to scope by `enteredAt`.
 *
 *   goldLoss(JobCard) = totalIssuedGrams − totalReturnedGrams − finalPieceWeight
 *
 * For the global summary we use the aggregate of StageMovement weights as the
 * primary source — that's what the floor records when weighing pieces in/out.
 * MetalLedger gives the issued/returned at JobCard granularity.
 */
export async function getLossSummary(range: DateRange = {}): Promise<MaterialLossSummary> {
  const match: Record<string, unknown> = {};
  if (range.from || range.to) {
    const r: Record<string, Date> = {};
    if (range.from) r.$gte = range.from;
    if (range.to) r.$lte = range.to;
    match.enteredAt = r;
  }

  const movAgg = await StageMovement.aggregate<{
    totalIn: number;
    totalOut: number;
    stonesIn: number;
    stonesOut: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
        totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
        stonesIn: { $sum: { $ifNull: ["$stonesIn", 0] } },
        stonesOut: { $sum: { $ifNull: ["$stonesOut", 0] } },
      },
    },
  ]);

  const totalIn = movAgg[0]?.totalIn ?? 0;
  const totalOut = movAgg[0]?.totalOut ?? 0;
  const stonesIn = movAgg[0]?.stonesIn ?? 0;
  const stonesOut = movAgg[0]?.stonesOut ?? 0;

  // Pull metal ledger for the same window for issued / returned totals.
  const metalMatch: Record<string, unknown> = {};
  if (range.from || range.to) {
    const r: Record<string, Date> = {};
    if (range.from) r.$gte = range.from;
    if (range.to) r.$lte = range.to;
    metalMatch.at = r;
  }
  const metalAgg = await MetalLedger.aggregate<{
    issued: number;
    returned: number;
  }>([
    { $match: metalMatch },
    {
      $group: {
        _id: null,
        issued: {
          $sum: {
            $cond: [{ $eq: ["$movementType", "issue"] }, { $abs: "$weightGrams" }, 0],
          },
        },
        returned: {
          $sum: {
            $cond: [{ $eq: ["$movementType", "return"] }, { $abs: "$weightGrams" }, 0],
          },
        },
      },
    },
  ]);

  const issued = metalAgg[0]?.issued ?? 0;
  const returned = metalAgg[0]?.returned ?? 0;

  // Final piece weight: sum of `totalMetalWeight` for completed JobCards in window.
  const jcMatch: Record<string, unknown> = { status: "completed" };
  if (range.from || range.to) {
    const r: Record<string, Date> = {};
    if (range.from) r.$gte = range.from;
    if (range.to) r.$lte = range.to;
    jcMatch.actualCompletionAt = r;
  }
  const jcAgg = await JobCard.aggregate<{ totalFinal: number; count: number }>([
    { $match: jcMatch },
    {
      $group: {
        _id: null,
        totalFinal: { $sum: { $ifNull: ["$totalMetalWeight", 0] } },
        count: { $sum: 1 },
      },
    },
  ]);
  const totalFinal = jcAgg[0]?.totalFinal ?? 0;
  const jobCardCount = jcAgg[0]?.count ?? 0;

  // Prefer per-movement weighing if present; else derive from metal ledger.
  const goldLoss = totalIn > 0 ? totalIn - totalOut : Math.max(0, issued - returned - totalFinal);
  const denom = totalIn > 0 ? totalIn : Math.max(issued, 1);
  const goldLossPct = denom > 0 ? Math.round((goldLoss / denom) * 10000) / 100 : 0;

  return {
    totalIssuedGrams: Math.max(totalIn, issued),
    totalReturnedGrams: Math.max(totalOut, returned),
    totalFinalPieceGrams: totalFinal,
    totalGoldLossGrams: round2(goldLoss),
    goldLossPct,
    totalStonesIn: stonesIn,
    totalStonesOut: stonesOut,
    totalStoneLoss: Math.max(0, stonesIn - stonesOut),
    jobCardCount,
  };
}

export interface LossByStageRow {
  stageCode: string;
  totalIn: number;
  totalOut: number;
  goldLoss: number;
  goldLossPct: number;
  movementCount: number;
}

export async function getLossByStage(range: DateRange = {}): Promise<LossByStageRow[]> {
  const match: Record<string, unknown> = { weightInGrams: { $gt: 0 } };
  if (range.from || range.to) {
    const r: Record<string, Date> = {};
    if (range.from) r.$gte = range.from;
    if (range.to) r.$lte = range.to;
    match.enteredAt = r;
  }
  const rows = await StageMovement.aggregate<{
    _id: string;
    totalIn: number;
    totalOut: number;
    count: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: "$toStageCode",
        totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
        totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalIn: -1 } },
  ]);

  return rows.map((r) => {
    const loss = r.totalIn - r.totalOut;
    const pct = r.totalIn > 0 ? Math.round((loss / r.totalIn) * 10000) / 100 : 0;
    return {
      stageCode: r._id,
      totalIn: round2(r.totalIn),
      totalOut: round2(r.totalOut),
      goldLoss: round2(loss),
      goldLossPct: pct,
      movementCount: r.count,
    };
  });
}

export interface LossByCellRow extends Omit<LossByStageRow, "stageCode"> {
  cellCode: string;
}

export async function getLossByCell(range: DateRange = {}): Promise<LossByCellRow[]> {
  const match: Record<string, unknown> = { weightInGrams: { $gt: 0 } };
  if (range.from || range.to) {
    const r: Record<string, Date> = {};
    if (range.from) r.$gte = range.from;
    if (range.to) r.$lte = range.to;
    match.enteredAt = r;
  }
  const rows = await StageMovement.aggregate<{
    _id: string;
    totalIn: number;
    totalOut: number;
    count: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: "$cellCode",
        totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
        totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalIn: -1 } },
  ]);

  return rows.map((r) => {
    const loss = r.totalIn - r.totalOut;
    const pct = r.totalIn > 0 ? Math.round((loss / r.totalIn) * 10000) / 100 : 0;
    return {
      cellCode: r._id,
      totalIn: round2(r.totalIn),
      totalOut: round2(r.totalOut),
      goldLoss: round2(loss),
      goldLossPct: pct,
      movementCount: r.count,
    };
  });
}

export interface LossByJobCard {
  gatiPieceCode: string;
  metalType?: string;
  totalIssuedGrams: number;
  totalReturnedGrams: number;
  finalPieceGrams: number;
  goldLossGrams: number;
  goldLossPct: number;
  stonesIn: number;
  stonesOut: number;
  stoneLoss: number;
  movementCount: number;
}

export async function getLossByJobCard(
  jobCardId: Types.ObjectId | string
): Promise<LossByJobCard | null> {
  const jc = await JobCard.findById(jobCardId);
  if (!jc) return null;

  const movs = await StageMovement.find({ jobCardId: jc._id });
  const movIn = movs.reduce((acc, m) => acc + (m.weightInGrams ?? 0), 0);
  const movOut = movs.reduce((acc, m) => acc + (m.weightOutGrams ?? 0), 0);
  const stonesIn = movs.reduce((acc, m) => acc + (m.stonesIn ?? 0), 0);
  const stonesOut = movs.reduce((acc, m) => acc + (m.stonesOut ?? 0), 0);

  const ledger = await MetalLedger.aggregate<{
    issued: number;
    returned: number;
  }>([
    { $match: { jobCardId: jc._id } },
    {
      $group: {
        _id: null,
        issued: {
          $sum: {
            $cond: [{ $eq: ["$movementType", "issue"] }, { $abs: "$weightGrams" }, 0],
          },
        },
        returned: {
          $sum: {
            $cond: [{ $eq: ["$movementType", "return"] }, { $abs: "$weightGrams" }, 0],
          },
        },
      },
    },
  ]);
  const issued = Math.max(movIn, ledger[0]?.issued ?? 0);
  const returned = Math.max(movOut, ledger[0]?.returned ?? 0);
  const finalPiece = jc.status === "completed" ? jc.totalMetalWeight ?? 0 : 0;

  const goldLoss = issued > 0 ? issued - returned - finalPiece : 0;
  const pct = issued > 0 ? Math.round((goldLoss / issued) * 10000) / 100 : 0;

  return {
    gatiPieceCode: jc.gatiPieceCode,
    metalType: jc.metalType,
    totalIssuedGrams: round2(issued),
    totalReturnedGrams: round2(returned),
    finalPieceGrams: round2(finalPiece),
    goldLossGrams: round2(Math.max(goldLoss, 0)),
    goldLossPct: pct,
    stonesIn,
    stonesOut,
    stoneLoss: Math.max(0, stonesIn - stonesOut),
    movementCount: movs.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
