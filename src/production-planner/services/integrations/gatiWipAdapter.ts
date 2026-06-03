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
import { calculateSettingTimeHours, getTotalDiamondCarats, resolvePerPcPieces, SETTING_STAGE_CODES } from "../production/settingTimeTable";

export interface IngestWipInput {
  buffer: Buffer;
  fileName: string;
  uploadedBy?: Types.ObjectId;
  /**
   * DEV/TEST ONLY — multiplier applied to each stage's `expectedDurationHours`
   * to compute a shifted `enteredAt`.
   *
   *   enteredAt = now − (expectedDurationHours × testDelayMultiplier)
   *
   * e.g. 2.5 → every stage appears 1.5× past its expected time:
   *   CAD  8h expected  → enteredAt = now−20h → 12h overdue
   *   GRN  4h expected  → enteredAt = now−10h →  6h overdue
   *   IGI 48h expected  → enteredAt = now−120h → 72h overdue
   *
   * Only honoured when NODE_ENV !== "production".
   */
  testDelayMultiplier?: number;
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

    // Discovered stage codes for terminal/hold detection + stage flow for smart enteredAt
    const stages = await StageDefinition.find({ active: true }).sort({ displayOrder: 1 });
    const terminalStageCodes = new Set(stages.filter((s) => s.isTerminal).map((s) => s.code));
    const onHoldStageCodes   = new Set(["HOLD"]);
    // Main flow stages (displayOrder 1–89) used for skip detection
    const stageFlow = stages
      .filter((s) => s.displayOrder >= 1 && s.displayOrder < 90)
      .map((s) => ({ code: s.code, expectedDurationHours: s.expectedDurationHours, displayOrder: s.displayOrder }));

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

    // ── Pre-load all open movements for these job cards ───────────────────────
    // Used to get prevConfirmedAt (enteredAt of closing movement) for smart
    // enteredAt estimation when stages are skipped between WIP imports.
    const existingOpenMovements = jobCardList.length > 0
      ? await StageMovement.find({
          jobCardId: { $in: jobCardList.map((jc) => jc._id) },
          exitedAt:  { $exists: false },
        }).select({ jobCardId: 1, toStageCode: 1, enteredAt: 1 })
      : [];
    // key: `${jobCardId}_${stageCode}` → enteredAt (last WIP confirmation time)
    const prevEnteredAtMap = new Map<string, Date>();
    for (const m of existingOpenMovements) {
      prevEnteredAtMap.set(`${m.jobCardId.toString()}_${m.toStageCode}`, m.enteredAt);
    }

    const pendingMovements: PendingMovement[] = [];
    const pendingJobCardUpdates: PendingJobCardUpdate[] = [];
    const now = new Date();
    // NODE_ENV guard is already enforced in importsWip.ts before the multiplier
    // is set — if it reached here, it was explicitly allowed.
    const isTestDelay = !!input.testDelayMultiplier;
    // For new movements in test mode we use now — the per-stage updateMany
    // at the end will apply the correct stage-proportional shift anyway.
    const enteredAtStamp = now;

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
        const jcDiaCarats = getTotalDiamondCarats(jobCard.diamondSpecs as { totalCaratsPerPiece: number }[]);
        const jcDiaStones = resolvePerPcPieces(
          (jobCard as { perPcPieces?: number }).perPcPieces,
          (jobCard as { diamondSpecs?: { stonesPerPiece: number }[] }).diamondSpecs
        );
        const jcStageFlow = stageFlow.map((s) =>
          SETTING_STAGE_CODES.has(s.code) && jcDiaCarats && jcDiaStones
            ? { ...s, expectedDurationHours: calculateSettingTimeHours(jcDiaCarats, jcDiaStones, s.expectedDurationHours) }
            : s
        );

      const result = await applyWipDiff(
          jobCard, newDistribution, balanceQty,
          { terminalStageCodes, onHoldStageCodes },
          pendingMovements, pendingJobCardUpdates, now, enteredAtStamp,
          jcStageFlow, prevEnteredAtMap, isTestDelay
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

    // ── Refresh enteredAt on all still-open movements ────────────────────────
    // Normal: resets clock to import time ("time since last WIP confirmation").
    // Test delay: sets enteredAt = now − (expectedDurationHours × multiplier)
    // per stage, so every stage appears proportionally overdue (not a flat shift).
    const processedJobCardIds = jobCardList.map((jc) => jc._id);
    if (processedJobCardIds.length > 0) {
      // Only refresh enteredAt for movements that existed BEFORE this import.
      // Newly created movements already have smart proportional enteredAt set.
      const importStartedAt = startedAt; // captured at top of ingestWipFile
      if (isTestDelay) {
        // Per-stage update: each stage gets its own past timestamp so the
        // delay shown is always (multiplier − 1) × expectedDurationHours.
        const stageDefs = await StageDefinition.find({ active: true })
          .select({ code: 1, expectedDurationHours: 1 });
        await Promise.all(
          stageDefs.map((s) =>
            StageMovement.updateMany(
              {
                jobCardId:    { $in: processedJobCardIds },
                toStageCode:  s.code,
                exitedAt:     { $exists: false },
              },
              {
                $set: {
                  enteredAt: new Date(
                    now.getTime() -
                    s.expectedDurationHours * (input.testDelayMultiplier!) * 3_600_000
                  ),
                },
              }
            )
          )
        );
      } else {
        // Only update pre-existing open movements (unchanged stages).
        // Newly inserted movements (createdAt >= importStartedAt) already
        // have their smart proportional enteredAt — don't overwrite them.
        await StageMovement.updateMany(
          {
            jobCardId: { $in: processedJobCardIds },
            exitedAt:  { $exists: false },
            createdAt: { $lt: importStartedAt },
          },
          { $set: { enteredAt: now } }
        );
      }
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

interface StageFlowEntry {
  code: string;
  expectedDurationHours: number;
  displayOrder: number;
}

/**
 * Smart enteredAt estimation when a piece skips multiple stages between WIP imports.
 *
 * Formula (proportional distribution):
 *   estimatedEnteredAt = prevConfirmedAt + elapsed × (E_before / E_total)
 *
 * Where:
 *   prevConfirmedAt = when piece was last confirmed at fromStage
 *   elapsed         = importTime - prevConfirmedAt
 *   E_before        = sum of expectedHours for all stages FROM fromStage up to (not including) toStage
 *   E_total         = E_before + expectedHours of toStage
 *
 * Example:
 *   10 AM at CAD → 10 AM+24h WIP shows at POL
 *   E_before = CAD(8)+CAM(4)+WAX(8)+WAX_SET(6)+CASTING(12)+CENTERING(4)+GRN(4)+REFINING(6)+FILING(8)+ASSEMBLE(6) = 66h
 *   E_total  = 66 + 6 = 72h
 *   fraction = 66/72 = 0.917
 *   estimatedEnteredAt = 10 AM + 24h × 0.917 = 10 AM + 22h = 8 AM next day
 *   → piece is 2h at POL when WIP is imported (vs 6h expected) — not overdue yet ✅
 *
 * Rework (backward movement): uses importTime (fresh timer, QC_REWORK alert handles flagging).
 */
function computeSmartEnteredAt(
  fromCode: string | undefined,
  toCode: string,
  importTime: Date,
  prevConfirmedAt: Date,
  stageFlow: StageFlowEntry[]
): Date {
  if (!fromCode) return importTime;

  const fromIdx = stageFlow.findIndex((s) => s.code === fromCode);
  const toIdx   = stageFlow.findIndex((s) => s.code === toCode);

  // Not found, adjacent (normal progression), or rework (backward) → use import time
  if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx + 1) return importTime;

  // Sum expected hours from fromStage up to (not including) toStage
  let E_before = 0;
  for (let i = fromIdx; i < toIdx; i++) E_before += stageFlow[i].expectedDurationHours;
  const E_total = E_before + stageFlow[toIdx].expectedDurationHours;
  if (E_total === 0) return importTime;

  const elapsedMs  = importTime.getTime() - prevConfirmedAt.getTime();
  const fraction   = E_before / E_total;
  const estimated  = new Date(prevConfirmedAt.getTime() + elapsedMs * fraction);

  // Must be strictly before import time (at least 1 min gap so delay calc isn't zero)
  return estimated < importTime ? estimated : new Date(importTime.getTime() - 60_000);
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
  now: Date,
  enteredAtStamp: Date = now,
  stageFlow: StageFlowEntry[] = [],
  prevEnteredAtMap: Map<string, Date> = new Map(),
  skipSmartEnteredAt = false    // true in test-delay mode — use enteredAtStamp as-is
): Promise<DiffResult> {
  const keyOf = (e: { stageCode: string; cellCode: string }) => `${e.stageCode}|${e.cellCode}`;
  const oldMap = new Map<string, StageDistributionEntry>();
  for (const e of jobCard.currentStageDistribution) oldMap.set(keyOf(e), e);
  const newMap = new Map<string, StageDistributionEntry>();
  for (const e of newDistribution) newMap.set(keyOf(e), e);

  const allKeys = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
  const lastStageCode = jobCard.currentStageDistribution[0]?.stageCode;

  let changed = false;

  // Track close operations that need the smart date from corresponding opens
  const pendingCloses: Array<{
    stageCode: string;
    cellCode: string;
    qty: number;
    enteredAt: Date;
  }> = [];

  for (const key of allKeys) {
    const oldEntry = oldMap.get(key);
    const newEntry = newMap.get(key);
    const oldQty = oldEntry?.qty ?? 0;
    const newQty = newEntry?.qty ?? 0;
    if (oldQty === newQty) continue;

    const [stageCode, cellCode] = key.split("|");
    changed = true;

    if (newQty > oldQty) {
      // If stages were skipped, estimate enteredAt proportionally.
      // For adjacent moves or rework (backward), enteredAtStamp is used as-is.
      const prevConfirmedAt = prevEnteredAtMap.get(
        `${(jobCard._id as Types.ObjectId).toString()}_${lastStageCode ?? ""}`
      ) ?? enteredAtStamp;
      const smartEnteredAt = skipSmartEnteredAt
        ? enteredAtStamp  // test delay mode: use the shifted stamp as-is
        : computeSmartEnteredAt(lastStageCode, stageCode, enteredAtStamp, prevConfirmedAt, stageFlow);

      pendingMovements.push({
        jobCardId: jobCard._id as Types.ObjectId,
        gatiPieceCode: jobCard.gatiPieceCode,
        toStageCode: stageCode,
        cellCode,
        fromStageCode: lastStageCode,
        qty: newQty - oldQty,
        enteredAt: smartEnteredAt,
      });

      // Close the previous stage's movement with the SAME timestamp
      // so its duration isn't inflated by time spent in subsequent stages.
      if (lastStageCode) {
        const prevQty = oldMap.get(`${lastStageCode}|${cellCode}`)?.qty;
        if (prevQty != null && prevQty > 0) {
          pendingCloses.push({
            stageCode: lastStageCode,
            cellCode,
            qty: Math.min(newQty - oldQty, prevQty),
            enteredAt: smartEnteredAt,
          });
        }
      }
    } else {
      // Close remaining qty that didn't move to lastStageCode (other reductions)
      const alreadyClosing = pendingCloses
        .filter((c) => c.stageCode === stageCode && c.cellCode === cellCode)
        .reduce((sum, c) => sum + c.qty, 0);
      const remainingQty = oldQty - newQty - alreadyClosing;
      if (remainingQty > 0) {
        pendingCloses.push({
          stageCode,
          cellCode,
          qty: remainingQty,
          enteredAt: now,
        });
      }
    }
  }

  // Flush all pending closes with their correct timestamps
  for (const pc of pendingCloses) {
    await closeMovements({
      jobCardId: jobCard._id as Types.ObjectId,
      gatiPieceCode: jobCard.gatiPieceCode,
      stageCode: pc.stageCode,
      cellCode: pc.cellCode,
      qty: pc.qty,
      exitedAt: pc.enteredAt,
    });
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
