import type { Types } from "mongoose";

import { GatiColumnMap, type GatiWipColumnEntry } from "../../models/gatiColumnMap";
import { GatiImportRun, type GatiImportRunDocument } from "../../models/gatiImportRun";
import { JobCard, type JobCardDocument } from "../../models/jobCard";
import { StageDefinition } from "../../models/stageDefinition";
import type { ImportRowError, JobCardStatus, StageDistributionEntry } from "../../types";
import {
  closeMovements,
  openMovement,
} from "../production/stageMovementService";
import {
  DEFAULT_ALIASES,
  DEFAULT_WIP_COLUMNS,
} from "../bootstrap/columnMapDefaults";
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
 * Read the WIP Excel/CSV, diff each row against the JobCard's current state,
 * append the resulting StageMovement records, and update the JobCard.
 *
 * - Skips header + the trailing "Customer Order Total" row.
 * - Bad rows go into `run.rowErrors[]`; the import as a whole still completes.
 * - Unmapped stage columns are reported in `run.unmappedColumns[]` so the admin
 *   can update the column map without losing the rest of the import.
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
    // Load column map; build lookups
    const columnMap = await GatiColumnMap.findOne({ fileType: "wip", active: true });
    const stageCellByColumn = new Map<string, MappedStageCell>();
    for (const entry of (columnMap?.wipColumns ?? []) as GatiWipColumnEntry[]) {
      // Skip pending entries (no stageCode/cellCode yet) — they count as unmapped
      if (!entry.stageCode || !entry.cellCode) continue;
      stageCellByColumn.set(entry.rawColumn.trim(), {
        stageCode: entry.stageCode,
        cellCode: entry.cellCode,
      });
    }

    // Discovered stage codes for terminal/hold detection
    const stages = await StageDefinition.find({ active: true });
    const terminalStageCodes = new Set(stages.filter((s) => s.isTerminal).map((s) => s.code));
    const onHoldStageCodes = new Set(["HOLD"]); // simple convention; can be data-driven later

    const parsed = parseWorkbookFromBuffer(input.buffer);
    run.rowCount = parsed.rowCount;

    const rowErrors: ImportRowError[] = [];
    const unmappedColumns = new Set<string>();

    // WIP imports never insert JobCards (those come from the Order import) — they
    // only update existing ones. `inserted` stays 0; we track update/skip.
    let updated = 0;
    let skipped = 0;

    // The reserved (non-stage) columns we know about — used to skip them when
    // walking each row's stage columns.
    const RESERVED_COLUMNS = new Set([
      "Book Name",
      "OrderNo+SrNo",
      "Style No",
      "BalanceQty",
      "PendingQty",
      "OnFloor",
    ]);

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      const rowIndex = i + 2;

      const pieceCode = toStr(raw["OrderNo+SrNo"]);
      const bookName = toStr(raw["Book Name"]);

      // Skip totals row ("Customer Order Total") and other footer/summary rows
      // (heuristic: footer rows have no piece code and a label like "Total" in Book Name).
      if (!pieceCode) continue;
      if (bookName && /total/i.test(bookName) && !pieceCode.includes("/")) continue;

      const balanceQty = toNumber(raw.BalanceQty) ?? 0;

      const jobCard = await JobCard.findOne({ gatiPieceCode: pieceCode });
      if (!jobCard) {
        rowErrors.push({
          row: rowIndex,
          reason: `JobCard not found for ${pieceCode} — upload the Order Excel first`,
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
        // We still process the mapped portion so partial progress is recorded.
      }

      try {
        const result = await applyWipDiff(jobCard, newDistribution, balanceQty, {
          terminalStageCodes,
          onHoldStageCodes,
        });
        if (result.changed) updated++;
        else skipped++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        rowErrors.push({ row: rowIndex, reason: `${pieceCode}: ${reason}` });
      }
    }

    // ── Auto-discover: persist newly-seen stage columns (with blank codes) so
    //    the admin can fill them in on the Column Maps screen.
    if (unmappedColumns.size > 0) {
      let targetMap = columnMap;
      if (!targetMap) {
        targetMap = await GatiColumnMap.create({
          fileType: "wip",
          version: 1,
          aliases: DEFAULT_ALIASES,
          orderColumns: [],
          wipColumns: DEFAULT_WIP_COLUMNS.map((c) => ({ ...c })),
          active: true,
        });
      }
      const existingRaws = new Set(
        (targetMap.wipColumns as GatiWipColumnEntry[]).map((c) => c.rawColumn.trim())
      );
      let mapChanged = false;
      for (const col of unmappedColumns) {
        if (!existingRaws.has(col.trim())) {
          (targetMap.wipColumns as GatiWipColumnEntry[]).push({
            rawColumn: col.trim(),
            stageCode: "",
            cellCode: "",
          });
          mapChanged = true;
        }
      }
      if (mapChanged) await targetMap.save();
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

/**
 * Diff one JobCard's new distribution against its current state, write the
 * resulting StageMovement records, and update the JobCard.
 */
async function applyWipDiff(
  jobCard: JobCardDocument,
  newDistribution: StageDistributionEntry[],
  balanceQty: number,
  opts: DiffOptions
): Promise<DiffResult> {
  const now = new Date();

  // Build key-indexed maps for diffing.
  const keyOf = (e: { stageCode: string; cellCode: string }) => `${e.stageCode}|${e.cellCode}`;
  const oldMap = new Map<string, StageDistributionEntry>();
  for (const e of jobCard.currentStageDistribution) oldMap.set(keyOf(e), e);
  const newMap = new Map<string, StageDistributionEntry>();
  for (const e of newDistribution) newMap.set(keyOf(e), e);

  const allKeys = new Set<string>([...oldMap.keys(), ...newMap.keys()]);

  // Find the most-recent stage the piece had been at, used as `fromStageCode`
  // on opening movements — purely informational.
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
      const delta = newQty - oldQty;
      await openMovement({
        jobCardId: jobCard._id as Types.ObjectId,
        gatiPieceCode: jobCard.gatiPieceCode,
        toStageCode: stageCode,
        cellCode,
        fromStageCode: lastStageCode,
        qty: delta,
        enteredAt: now,
      });
    } else {
      const delta = oldQty - newQty;
      await closeMovements({
        jobCardId: jobCard._id as Types.ObjectId,
        gatiPieceCode: jobCard.gatiPieceCode,
        stageCode,
        cellCode,
        qty: delta,
        exitedAt: now,
      });
    }
  }

  // Update JobCard state.
  jobCard.currentStageDistribution = newDistribution;

  const totalQtyInDistribution = newDistribution.reduce((acc, e) => acc + e.qty, 0);
  const allTerminal = newDistribution.length > 0 && newDistribution.every((e) => opts.terminalStageCodes.has(e.stageCode));
  const anyHold = newDistribution.some((e) => opts.onHoldStageCodes.has(e.stageCode));

  let nextStatus: JobCardStatus = jobCard.status;
  if (balanceQty === 0 || (allTerminal && totalQtyInDistribution >= jobCard.totalQty)) {
    nextStatus = "completed";
    if (!jobCard.actualCompletionAt) jobCard.actualCompletionAt = now;
  } else if (anyHold) {
    nextStatus = "on_hold";
  } else if (newDistribution.length > 0) {
    nextStatus = "in_progress";
  } else {
    nextStatus = "planned";
  }

  if (nextStatus !== jobCard.status) {
    jobCard.status = nextStatus;
    changed = true;
  }

  if (changed) await jobCard.save();

  return { changed };
}
