import type { Types } from "mongoose";

import { GatiColumnMap } from "../../models/gatiColumnMap";
import { GatiImportRun, type GatiImportRunDocument } from "../../models/gatiImportRun";
import { JobCard, type JobCardDocument } from "../../models/jobCard";
import { StageDefinition } from "../../models/stageDefinition";
import { StageMovement } from "../../models/stageMovement";
import type { ImportRowError, JobCardStatus, StageDistributionEntry } from "../../types";
import { closeMovements } from "../production/stageMovementService";
import { DEFAULT_WIP_COLUMNS } from "../bootstrap/columnMapDefaults";
import { parseWorkbookFromBuffer } from "./excelParser";
import { toNumber, toStr } from "./columnMapper";

export interface IngestWipInput {
  buffer: Buffer;
  fileName: string;
  uploadedBy?: Types.ObjectId;
}

interface MappedStageCell {
  stageCode: string;
  cellCode: string;
}

/**
 * Read the WIP ("What Is Where") Excel, diff each row against the JobCard's
 * current state, append StageMovement records, and update the JobCard.
 *
 * GatiSOFT "What Is Where" file format:
 *   Row 1  — "Grand Total" merged header (skipped by parser)
 *   Row 2  — Column headers: Book Name | OrderNo+SrNo | Style No | BalanceQty | …stage cols…
 *   Row 3+ — One row per piece; OrderNo+SrNo = gatiPieceCode (e.g. CO/REG/26-27/0112/1)
 *   Last   — Totals row: Book Name = "Customer Order Total", OrderNo+SrNo = blank
 *
 * Returns the persisted GatiImportRun.
 */
export async function ingestWipFile(input: IngestWipInput): Promise<GatiImportRunDocument> {
  const startedAt = new Date();
  const run = await GatiImportRun.create({
    fileType: "wip",
    fileName: input.fileName,
    uploadedBy: input.uploadedBy,
    uploadedAt: startedAt,
    status: "processing",
    startedAt,
  });

  try {
    // Load (or auto-create) the active WIP column map.
    let columnMap = await GatiColumnMap.findOne({ fileType: "wip", active: true });
    if (!columnMap) {
      columnMap = await GatiColumnMap.create({
        fileType: "wip",
        version: 1,
        aliases: {},
        orderColumns: [],
        wipColumns: DEFAULT_WIP_COLUMNS.map((c) => ({ ...c })),
        active: true,
      });
    }

    // Build rawColumn → { stageCode, cellCode } lookup.
    const stageCellByColumn = new Map<string, MappedStageCell>();
    for (const entry of columnMap.wipColumns) {
      if (!entry.stageCode || !entry.cellCode) continue;
      stageCellByColumn.set(entry.rawColumn.trim(), {
        stageCode: entry.stageCode,
        cellCode: entry.cellCode,
      });
    }

    // Discovered stage codes for terminal/hold detection
    const stages = await StageDefinition.find({ active: true });
    const terminalStageCodes = new Set(stages.filter((s) => s.isTerminal).map((s) => s.code));
    const onHoldStageCodes = new Set(["HOLD"]);

    const parsed = parseWorkbookFromBuffer(input.buffer);
    run.rowCount = parsed.rowCount;

    const rowErrors: ImportRowError[] = [];
    const unmappedColumns = new Set<string>();

    let updated = 0;
    let skipped = 0;

    // Non-stage columns — skip when walking stage columns.
    const RESERVED_COLUMNS = new Set([
      "Book Name",
      "OrderNo+SrNo",
      "Style No",
      "BalanceQty",
      "PendingQty",
      "OnFloor",
    ]);

    // ── First pass: collect valid rows ───────────────────────────────────────
    // "OrderNo+SrNo" = gatiPieceCode (e.g. "CO/REG/26-27/0112/1").
    // Totals row has blank OrderNo+SrNo — filtered by !pieceCode check.
    interface ValidWipRow {
      raw: Record<string, unknown>;
      rowIndex: number;
      pieceCode: string;
      balanceQty: number;
    }
    const validRows: ValidWipRow[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      const pieceCode = toStr(raw["OrderNo+SrNo"]);
      if (!pieceCode) continue;
      validRows.push({ raw, rowIndex: i + 2, pieceCode, balanceQty: toNumber(raw.BalanceQty) ?? 0 });
    }

    // ── Single DB round-trip for all job cards ───────────────────────────────
    const jobCardList = await JobCard.find({
      gatiPieceCode: { $in: validRows.map((r) => r.pieceCode) },
    });
    const jobCardMap = new Map<string, JobCardDocument>(
      jobCardList.map((jc) => [jc.gatiPieceCode, jc])
    );

    const pendingMovements: PendingMovement[] = [];
    const pendingJobCardUpdates: PendingJobCardUpdate[] = [];
    const now = new Date();

    for (const { raw, rowIndex, pieceCode, balanceQty } of validRows) {
      const jobCard = jobCardMap.get(pieceCode);
      if (!jobCard) {
        rowErrors.push({
          row: rowIndex,
          reason: `No job card found for ${pieceCode} — upload the Order Excel first`,
        });
        continue;
      }

      // Build the new distribution from non-zero stage columns.
      const newDistribution: StageDistributionEntry[] = [];
      let rowHasUnmappedNonZero = false;

      for (const [col, val] of Object.entries(raw)) {
        if (RESERVED_COLUMNS.has(col)) continue;
        const qty = toNumber(val);
        if (qty == null || qty === 0) continue;

        const mapped = stageCellByColumn.get(col.trim());
        if (!mapped) {
          unmappedColumns.add(col);
          rowHasUnmappedNonZero = true;
          continue;
        }

        newDistribution.push({
          stageCode: mapped.stageCode,
          cellCode: mapped.cellCode,
          qty,
        });
      }

      if (rowHasUnmappedNonZero) {
        rowErrors.push({
          row: rowIndex,
          reason: `${pieceCode}: one or more stage columns are not mapped — update the WIP column map`,
        });
        // Still process the mapped portion so partial progress is recorded.
      }

      try {
        const result = await applyWipDiff(
          jobCard, newDistribution, balanceQty,
          { terminalStageCodes, onHoldStageCodes },
          pendingMovements, pendingJobCardUpdates, now
        );
        if (result.changed) updated++;
        else skipped++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        rowErrors.push({ row: rowIndex, reason: `${pieceCode}: ${reason}` });
      }
    }

    // ── Flush batch writes ───────────────────────────────────────────────────
    if (pendingMovements.length > 0) {
      await StageMovement.insertMany(pendingMovements, { ordered: false });
    }
    if (pendingJobCardUpdates.length > 0) {
      await JobCard.bulkWrite(
        pendingJobCardUpdates.map((u) => ({
          updateOne: {
            filter: { _id: u.id },
            update: {
              $set: {
                currentStageDistribution: u.currentStageDistribution,
                status: u.status,
                ...(u.actualCompletionAt ? { actualCompletionAt: u.actualCompletionAt } : {}),
              },
            },
          },
        })),
        { ordered: false }
      );
    }

    run.inserted = 0;
    run.updated = updated;
    run.skipped = skipped;
    run.errored = rowErrors.length;
    run.rowErrors = rowErrors;
    run.unmappedColumns = Array.from(unmappedColumns);
    run.status = "complete";
    run.finishedAt = new Date();
    await run.save();
    return run;
  } catch (err) {
    run.status = "failed";
    run.errorMessage = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date();
    await run.save();
    return run;
  }
}

interface DiffOptions {
  terminalStageCodes: Set<string>;
  onHoldStageCodes: Set<string>;
}

interface DiffResult {
  changed: boolean;
}

/** Pending open-movement to be batch-inserted after the row loop. */
interface PendingMovement {
  jobCardId: Types.ObjectId;
  gatiPieceCode: string;
  toStageCode: string;
  cellCode: string;
  fromStageCode?: string;
  qty: number;
  enteredAt: Date;
}

/** Pending job-card update to be batch-written after the row loop. */
interface PendingJobCardUpdate {
  id: Types.ObjectId;
  currentStageDistribution: StageDistributionEntry[];
  status: JobCardStatus;
  actualCompletionAt?: Date;
}

/**
 * Diff one JobCard's new distribution against its current state.
 *
 * - Close movements (qty reduced) are written immediately — FIFO reads committed state.
 * - Open movements (qty increased) and JobCard saves are deferred for bulk flush.
 */
async function applyWipDiff(
  jobCard: JobCardDocument,
  newDistribution: StageDistributionEntry[],
  balanceQty: number,
  opts: DiffOptions,
  pendingMovements: PendingMovement[],
  pendingJobCardUpdates: PendingJobCardUpdate[],
  now: Date
): Promise<DiffResult> {
  const keyOf = (e: { stageCode: string; cellCode: string }) => `${e.stageCode}|${e.cellCode}`;
  const oldMap = new Map<string, StageDistributionEntry>();
  for (const e of jobCard.currentStageDistribution) oldMap.set(keyOf(e), e);
  const newMap = new Map<string, StageDistributionEntry>();
  for (const e of newDistribution) newMap.set(keyOf(e), e);

  const allKeys = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
  const lastStageCode = jobCard.currentStageDistribution[0]?.stageCode;

  let changed = false;

  for (const key of allKeys) {
    const oldEntry = oldMap.get(key);
    const newEntry = newMap.get(key);
    const oldQty = oldEntry?.qty ?? 0;
    const newQty = newEntry?.qty ?? 0;
    if (oldQty === newQty) continue;

    const [stageCode, cellCode] = key.split("|");
    changed = true;

    if (newQty > oldQty) {
      pendingMovements.push({
        jobCardId: jobCard._id as Types.ObjectId,
        gatiPieceCode: jobCard.gatiPieceCode,
        toStageCode: stageCode,
        cellCode,
        fromStageCode: lastStageCode,
        qty: newQty - oldQty,
        enteredAt: now,
      });
    } else {
      await closeMovements({
        jobCardId: jobCard._id as Types.ObjectId,
        gatiPieceCode: jobCard.gatiPieceCode,
        stageCode,
        cellCode,
        qty: oldQty - newQty,
        exitedAt: now,
      });
    }
  }

  // Compute next status.
  const totalQtyInDistribution = newDistribution.reduce((acc, e) => acc + e.qty, 0);
  const allTerminal = newDistribution.length > 0 &&
    newDistribution.every((e) => opts.terminalStageCodes.has(e.stageCode));
  const anyHold = newDistribution.some((e) => opts.onHoldStageCodes.has(e.stageCode));

  let nextStatus: JobCardStatus = jobCard.status;
  if (balanceQty === 0 || (allTerminal && totalQtyInDistribution >= jobCard.totalQty)) {
    nextStatus = "completed";
  } else if (anyHold) {
    nextStatus = "on_hold";
  } else if (newDistribution.length > 0) {
    nextStatus = "in_progress";
  } else {
    nextStatus = "pending";
  }

  if (nextStatus !== jobCard.status) changed = true;

  if (changed) {
    pendingJobCardUpdates.push({
      id: jobCard._id as Types.ObjectId,
      currentStageDistribution: newDistribution,
      status: nextStatus,
      actualCompletionAt:
        nextStatus === "completed" && !jobCard.actualCompletionAt ? now : undefined,
    });
  }

  return { changed };
}
