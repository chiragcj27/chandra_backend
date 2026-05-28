import { Types } from "mongoose";

import { DiamondAllocation } from "../../models/diamondAllocation";
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

function buildDateMatch(field: string, range: DateRange): Record<string, unknown> {
  if (!range.from && !range.to) return {};
  const r: Record<string, Date> = {};
  if (range.from) r.$gte = range.from;
  if (range.to) r.$lte = range.to;
  return { [field]: r };
}

/**
 * Aggregate gold & stone loss.
 *
 * Gold sources (spec §6.1):
 *   1. StageMovement.weightInGrams / weightOutGrams  — per-stage floor weighing (primary)
 *   2. MetalLedger issue / return                    — vault-level fallback
 *
 * Stone sources (spec §6.1):
 *   1. StageMovement.stonesIn / stonesOut            — per-stage floor counts (primary)
 *   2. DiamondAllocation.quantityAllocated / quantityConsumed — per-JobCard fallback
 */
export async function getLossSummary(range: DateRange = {}): Promise<MaterialLossSummary> {
  const movMatch = buildDateMatch("enteredAt", range);
  const metalMatch = buildDateMatch("at", range);
  const allocMatch = buildDateMatch("allocatedAt", range);

  const [movAgg, metalAgg, allocAgg] = await Promise.all([
    StageMovement.aggregate<{
      totalIn: number;
      totalOut: number;
      stonesIn: number;
      stonesOut: number;
    }>([
      ...(Object.keys(movMatch).length ? [{ $match: movMatch }] : []),
      {
        $group: {
          _id: null,
          totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
          totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
          stonesIn: { $sum: { $ifNull: ["$stonesIn", 0] } },
          stonesOut: { $sum: { $ifNull: ["$stonesOut", 0] } },
        },
      },
    ]),

    MetalLedger.aggregate<{ issued: number; returned: number }>([
      ...(Object.keys(metalMatch).length ? [{ $match: metalMatch }] : []),
      {
        $group: {
          _id: null,
          issued: {
            $sum: { $cond: [{ $eq: ["$movementType", "issue"] }, { $abs: "$weightGrams" }, 0] },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$movementType", "return"] }, { $abs: "$weightGrams" }, 0] },
          },
        },
      },
    ]),

    // DiamondAllocation: fallback stone source (spec §6.1 — "allocated vs consumed per JobCard").
    // stonesIn  = sum(quantityAllocated)
    // stonesOut = sum(quantityConsumed)
    // stoneLoss = stonesIn - stonesOut
    DiamondAllocation.aggregate<{ allocated: number; consumed: number }>([
      ...(Object.keys(allocMatch).length ? [{ $match: allocMatch }] : []),
      {
        $group: {
          _id: null,
          allocated: { $sum: { $ifNull: ["$quantityAllocated", 0] } },
          consumed: { $sum: { $ifNull: ["$quantityConsumed", 0] } },
        },
      },
    ]),
  ]);

  const totalIn = movAgg[0]?.totalIn ?? 0;
  const totalOut = movAgg[0]?.totalOut ?? 0;
  const movStonesIn = movAgg[0]?.stonesIn ?? 0;
  const movStonesOut = movAgg[0]?.stonesOut ?? 0;

  const issued = metalAgg[0]?.issued ?? 0;
  const returned = metalAgg[0]?.returned ?? 0;

  const allocAllocated = allocAgg[0]?.allocated ?? 0;
  const allocConsumed = allocAgg[0]?.consumed ?? 0;

  // Final piece weight for completed JobCards.
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

  // Gold: prefer stage weights; fall back to MetalLedger.
  const goldLoss = totalIn > 0 ? totalIn - totalOut : Math.max(0, issued - returned - totalFinal);
  const denom = totalIn > 0 ? totalIn : Math.max(issued, 1);
  const goldLossPct = denom > 0 ? Math.round((goldLoss / denom) * 10000) / 100 : 0;

  // Stones: prefer StageMovement counts; fall back to DiamondAllocation.
  const finalStonesIn = movStonesIn > 0 ? movStonesIn : allocAllocated;
  const finalStonesOut = movStonesOut > 0 ? movStonesOut : allocConsumed;
  const finalStoneLoss = Math.max(0, finalStonesIn - finalStonesOut);

  return {
    totalIssuedGrams: Math.max(totalIn, issued),
    totalReturnedGrams: Math.max(totalOut, returned),
    totalFinalPieceGrams: totalFinal,
    totalGoldLossGrams: round2(goldLoss),
    goldLossPct,
    totalStonesIn: finalStonesIn,
    totalStonesOut: finalStonesOut,
    totalStoneLoss: finalStoneLoss,
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
  const match = buildDateMatch("enteredAt", range);
  const rows = await StageMovement.aggregate<{
    _id: string;
    totalIn: number;
    totalOut: number;
    count: number;
    totalQty: number;
  }>([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $group: {
        _id: "$toStageCode",
        totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
        totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
        count: { $sum: 1 },
        totalQty: { $sum: { $ifNull: ["$qty", 0] } },
      },
    },
    { $sort: { totalIn: -1, totalQty: -1 } },
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
  const match = buildDateMatch("enteredAt", range);
  const rows = await StageMovement.aggregate<{
    _id: string;
    totalIn: number;
    totalOut: number;
    count: number;
    totalQty: number;
  }>([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $group: {
        _id: "$cellCode",
        totalIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
        totalOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
        count: { $sum: 1 },
        totalQty: { $sum: { $ifNull: ["$qty", 0] } },
      },
    },
    { $sort: { totalIn: -1, totalQty: -1 } },
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
  /** JobCard status — "completed" loss is final; in-progress shows provisional unaccounted gold */
  status?: string;
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

  const [movs, ledger, allocAgg] = await Promise.all([
    StageMovement.find({ jobCardId: jc._id }),

    MetalLedger.aggregate<{ issued: number; returned: number }>([
      { $match: { jobCardId: jc._id } },
      {
        $group: {
          _id: null,
          issued: {
            $sum: { $cond: [{ $eq: ["$movementType", "issue"] }, { $abs: "$weightGrams" }, 0] },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$movementType", "return"] }, { $abs: "$weightGrams" }, 0] },
          },
        },
      },
    ]),

    // DiamondAllocation: stone fallback per spec §6.1.
    DiamondAllocation.aggregate<{ allocated: number; consumed: number }>([
      { $match: { jobCardId: jc._id } },
      {
        $group: {
          _id: null,
          allocated: { $sum: { $ifNull: ["$quantityAllocated", 0] } },
          consumed: { $sum: { $ifNull: ["$quantityConsumed", 0] } },
        },
      },
    ]),
  ]);

  const movIn = movs.reduce((acc, m) => acc + (m.weightInGrams ?? 0), 0);
  const movOut = movs.reduce((acc, m) => acc + (m.weightOutGrams ?? 0), 0);
  const movStonesIn = movs.reduce((acc, m) => acc + (m.stonesIn ?? 0), 0);
  const movStonesOut = movs.reduce((acc, m) => acc + (m.stonesOut ?? 0), 0);

  const mlIssued = ledger[0]?.issued ?? 0;
  const mlReturned = ledger[0]?.returned ?? 0;
  const finalPiece = jc.status === "completed" ? (jc.totalMetalWeight ?? 0) : 0;

  const allocAllocated = allocAgg[0]?.allocated ?? 0;
  const allocConsumed = allocAgg[0]?.consumed ?? 0;

  // Gold: prefer stage weights; fall back to MetalLedger.
  const goldLoss =
    movIn > 0
      ? Math.max(0, movIn - movOut)
      : mlIssued > 0
        ? Math.max(0, mlIssued - mlReturned - finalPiece)
        : 0;
  const usedIssued = movIn > 0 ? movIn : mlIssued;
  const usedReturned = movIn > 0 ? movOut : mlReturned;
  const pct = usedIssued > 0 ? Math.round((goldLoss / usedIssued) * 10000) / 100 : 0;

  // Stones: prefer StageMovement counts; fall back to DiamondAllocation.
  const stonesIn = movStonesIn > 0 ? movStonesIn : allocAllocated;
  const stonesOut = movStonesOut > 0 ? movStonesOut : allocConsumed;
  const stoneLoss = Math.max(0, stonesIn - stonesOut);

  return {
    gatiPieceCode: jc.gatiPieceCode,
    status: jc.status,
    metalType: jc.metalType,
    totalIssuedGrams: round2(usedIssued),
    totalReturnedGrams: round2(usedReturned),
    finalPieceGrams: round2(finalPiece),
    goldLossGrams: round2(goldLoss),
    goldLossPct: pct,
    stonesIn,
    stonesOut,
    stoneLoss,
    movementCount: movs.length,
  };
}

export interface LossByJobCardRow extends LossByJobCard {
  jobCardId: string;
}

export async function getLossByJobCards(): Promise<LossByJobCardRow[]> {
  const [movAgg, metalAgg, allocAgg] = await Promise.all([
    StageMovement.aggregate<{
      _id: Types.ObjectId;
      weightIn: number;
      weightOut: number;
      stonesIn: number;
      stonesOut: number;
      count: number;
    }>([
      {
        $group: {
          _id: "$jobCardId",
          weightIn: { $sum: { $ifNull: ["$weightInGrams", 0] } },
          weightOut: { $sum: { $ifNull: ["$weightOutGrams", 0] } },
          stonesIn: { $sum: { $ifNull: ["$stonesIn", 0] } },
          stonesOut: { $sum: { $ifNull: ["$stonesOut", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),

    MetalLedger.aggregate<{ _id: Types.ObjectId; issued: number; returned: number }>([
      {
        $group: {
          _id: "$jobCardId",
          issued: {
            $sum: { $cond: [{ $eq: ["$movementType", "issue"] }, { $abs: "$weightGrams" }, 0] },
          },
          returned: {
            $sum: { $cond: [{ $eq: ["$movementType", "return"] }, { $abs: "$weightGrams" }, 0] },
          },
        },
      },
    ]),

    // DiamondAllocation: stone fallback per spec §6.1.
    DiamondAllocation.aggregate<{ _id: Types.ObjectId; allocated: number; consumed: number }>([
      {
        $group: {
          _id: "$jobCardId",
          allocated: { $sum: { $ifNull: ["$quantityAllocated", 0] } },
          consumed: { $sum: { $ifNull: ["$quantityConsumed", 0] } },
        },
      },
    ]),
  ]);

  const movMap = new Map(movAgg.map((r) => [String(r._id), r]));
  const metalMap = new Map(metalAgg.map((r) => [String(r._id), r]));
  const allocMap = new Map(allocAgg.map((r) => [String(r._id), r]));

  const jobCards = await JobCard.find({})
    .select("gatiPieceCode metalType totalMetalWeight status _id")
    .lean();
  const out: LossByJobCardRow[] = [];

  for (const jc of jobCards) {
    const id = String(jc._id);
    const m = movMap.get(id);
    const ml = metalMap.get(id);
    const alloc = allocMap.get(id);

    const movIn = m?.weightIn ?? 0;
    const movOut = m?.weightOut ?? 0;
    const movStonesIn = m?.stonesIn ?? 0;
    const movStonesOut = m?.stonesOut ?? 0;
    const mlIssued = ml?.issued ?? 0;
    const mlReturned = ml?.returned ?? 0;
    const finalPiece = jc.status === "completed" ? (jc.totalMetalWeight ?? 0) : 0;

    const allocAllocated = alloc?.allocated ?? 0;
    const allocConsumed = alloc?.consumed ?? 0;

    // Gold: prefer stage weights; fall back to MetalLedger.
    const goldLoss =
      movIn > 0
        ? Math.max(0, movIn - movOut)
        : mlIssued > 0
          ? Math.max(0, mlIssued - mlReturned - finalPiece)
          : 0;
    const usedIssued = movIn > 0 ? movIn : mlIssued;
    const usedReturned = movIn > 0 ? movOut : mlReturned;
    const pct = usedIssued > 0 ? Math.round((goldLoss / usedIssued) * 10000) / 100 : 0;

    // Stones: prefer StageMovement counts; fall back to DiamondAllocation.
    const stonesIn = movStonesIn > 0 ? movStonesIn : allocAllocated;
    const stonesOut = movStonesOut > 0 ? movStonesOut : allocConsumed;
    const stoneLoss = Math.max(0, stonesIn - stonesOut);

    if (usedIssued > 0 || m?.count || allocAllocated > 0) {
      out.push({
        jobCardId: id,
        gatiPieceCode: jc.gatiPieceCode,
        status: jc.status,
        metalType: jc.metalType,
        totalIssuedGrams: round2(usedIssued),
        totalReturnedGrams: round2(usedReturned),
        finalPieceGrams: round2(finalPiece),
        goldLossGrams: round2(goldLoss),
        goldLossPct: pct,
        stonesIn,
        stonesOut,
        stoneLoss,
        movementCount: m?.count ?? 0,
      });
    }
  }

  out.sort((a, b) => b.goldLossGrams - a.goldLossGrams);
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
