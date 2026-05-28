import type { Types } from "mongoose";

import { GatiColumnMap, type GatiColumnMapDocument } from "../../models/gatiColumnMap";
import { GatiImportRun, type GatiImportRunDocument } from "../../models/gatiImportRun";
import type { DiamondSpec, FindingEntry, ImportRowError } from "../../types";
import {
  DEFAULT_ALIASES,
  DEFAULT_ORDER_COLUMNS,
} from "../bootstrap/columnMapDefaults";
import { findOrCreateDiamond } from "../inventory/diamondSeedService";
import {
  upsertFromOrderImport,
  type JobCardImportPayload,
  type UpsertAction,
} from "../production/jobCardService";
import { parseWorkbookFromBuffer } from "./excelParser";
import {
  buildGatiPieceCode,
  classifyRow,
  parseGatiDate,
  toNumber,
  toStr,
  type RowKind,
} from "./columnMapper";

export interface IngestOrdersInput {
  buffer: Buffer;
  fileName: string;
  uploadedBy?: Types.ObjectId;
}

interface GroupedRow {
  kind: RowKind;
  raw: Record<string, unknown>;
  rowIndex: number;
}

/**
 * Read the Order Excel/CSV, pivot rows, upsert JobCards, auto-seed Diamond master,
 * and return a fully-populated `GatiImportRun` (persisted).
 *
 * Synchronous: the caller awaits this. Errors are collected per row group;
 * a single bad group never fails the whole run.
 */
export async function ingestOrdersFile(
  input: IngestOrdersInput
): Promise<GatiImportRunDocument> {
  const startedAt = new Date();
  const run = await GatiImportRun.create({
    fileType: "orders",
    fileName: input.fileName,
    uploadedBy: input.uploadedBy,
    uploadedAt: startedAt,
    status: "processing",
    startedAt,
  });

  try {
    // Load the active column map (or create a fresh default if none).
    // NOTE: always include aliases so a DB-wipe-without-restart doesn't
    // produce a blank map and fail every row with "Unknown RawAliasName".
    let columnMap = await GatiColumnMap.findOne({ fileType: "orders", active: true });
    if (!columnMap) {
      columnMap = await GatiColumnMap.create({
        fileType: "orders",
        version: 1,
        aliases: DEFAULT_ALIASES,
        orderColumns: DEFAULT_ORDER_COLUMNS.map((c) => ({ ...c })),
        wipColumns: [],
        active: true,
      });
    }

    // Parse workbook — combine ALL sheets so GatiSOFT files that spread orders
    // across multiple tabs (e.g. "Sheet" + "New Sheet") are fully imported.
    const parsed = parseWorkbookFromBuffer(input.buffer, undefined, true);
    run.rowCount = parsed.rowCount;

    // Group rows by `${OrderNoWithoutSrNo}/${OrderItemSrNo}`.
    const groups = new Map<string, GroupedRow[]>();
    const rowErrors: ImportRowError[] = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      const rowIndex = i + 2; // +1 header, +1 to make it 1-based for humans

      const orderNumber = toStr(raw.OrderNoWithoutSrNo);
      const srNoNum = toNumber(raw.OrderItemSrNo);

      if (!orderNumber || srNoNum == null) {
        // Trailing totals row (no order number) — silently skip.
        if (orderNumber == null && srNoNum == null) continue;
        rowErrors.push({
          row: rowIndex,
          reason: "Missing OrderNoWithoutSrNo or OrderItemSrNo",
          raw,
        });
        continue;
      }

      const key = buildGatiPieceCode(orderNumber, srNoNum);
      const kind = classifyRow(raw.RawAliasName, columnMap.aliases);
      if (kind === "unknown") {
        rowErrors.push({
          row: rowIndex,
          reason: `Unknown RawAliasName "${toStr(raw.RawAliasName) ?? ""}" — add to column-map aliases`,
          raw,
        });
        continue;
      }
      const list = groups.get(key) ?? [];
      list.push({ kind, raw, rowIndex });
      groups.set(key, list);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // Build a JobCard per group.
    for (const [pieceCode, rows] of groups) {
      try {
        const result = await processGroup(pieceCode, rows, columnMap);
        if (result.action === "inserted") inserted++;
        else if (result.action === "updated") updated++;
        else skipped++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        rowErrors.push({
          row: rows[0]?.rowIndex ?? 0,
          reason: `${pieceCode}: ${reason}`,
        });
      }
    }

    run.inserted = inserted;
    run.updated = updated;
    run.skipped = skipped;
    run.errored = rowErrors.length;
    run.rowErrors = rowErrors;
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

async function processGroup(
  pieceCode: string,
  rows: GroupedRow[],
  _columnMap: GatiColumnMapDocument
): Promise<{ action: UpsertAction }> {
  const diamondRows = rows.filter((r) => r.kind === "diamond");
  const metalRows = rows.filter((r) => r.kind === "metal");
  const findingRows = rows.filter((r) => r.kind === "finding");

  if (diamondRows.length === 0) {
    throw new Error("No diamond row found");
  }
  if (metalRows.length === 0) {
    throw new Error("No metal row found");
  }
  if (metalRows.length > 1) {
    throw new Error(`Expected exactly 1 metal row, got ${metalRows.length}`);
  }

  const metalRow = metalRows[0].raw;

  // Common fields — pull from any row (they should agree across rows in the group).
  const anchor = rows[0].raw;
  const orderNumber = toStr(anchor.OrderNoWithoutSrNo);
  const srNo = toNumber(anchor.OrderItemSrNo);
  if (!orderNumber || srNo == null) throw new Error("Missing order number / sr no");

  const totalQty = toNumber(anchor.OrderQty) ?? 1;
  const styleNo = toStr(anchor.StyleCode_Repeat);
  const size = toStr(anchor.ItmItemSizeName);
  const customerCode = toStr(anchor.Customer);
  const orderedAt = parseGatiDate(anchor.OrderDate) ?? undefined;
  const expectedDeliveryAt = parseGatiDate(anchor.ItmPrdDelDate) ?? undefined;

  // Build diamond specs (one entry per diamond row).
  const diamondSpecs: DiamondSpec[] = [];
  for (const dr of diamondRows) {
    const gSize = toStr(dr.raw.GSize);
    const sieve = toStr(dr.raw.Size);
    const diaSizeMM = toNumber(dr.raw.DiaSizeMM);
    const pointer = toNumber(dr.raw.Pointer);
    const totalCaratsPerPiece = toNumber(dr.raw.NetWeight);

    if (!gSize || !sieve || diaSizeMM == null) {
      throw new Error(`Diamond row missing GSize/Size/DiaSizeMM (row ${dr.rowIndex})`);
    }
    if (pointer == null || pointer <= 0) {
      throw new Error(`Diamond row has invalid Pointer (row ${dr.rowIndex})`);
    }
    if (totalCaratsPerPiece == null) {
      throw new Error(`Diamond row missing NetWeight (row ${dr.rowIndex})`);
    }

    const stonesPerPiece = Math.round(totalCaratsPerPiece / pointer);
    diamondSpecs.push({
      gSize,
      sieve,
      diaSizeMM,
      pointer,
      totalCaratsPerPiece,
      stonesPerPiece,
    });

    // Auto-seed the Diamond master for this spec.
    await findOrCreateDiamond({ gSize, sieve, diaSizeMM, pointer });
  }

  const totalStones = diamondSpecs.reduce((acc, d) => acc + d.stonesPerPiece, 0) * totalQty;

  // Metal
  const metalType = toStr(metalRow.ItemCode);
  const metalWeightPerPiece = toNumber(metalRow.NetWeight) ?? 0;
  const totalMetalWeight = metalWeightPerPiece * totalQty;

  // Findings
  const findings: FindingEntry[] = findingRows.map((fr) => ({
    code: toStr(fr.raw.ItemCode) ?? "UNKNOWN",
    qty: toNumber(fr.raw.NetWeight) ?? 0,
  }));

  const payload: JobCardImportPayload = {
    gatiPieceCode: pieceCode,
    orderNumber,
    orderItemSrNo: srNo,
    totalQty,
    styleNo,
    size,
    customerCode,
    diamondSpecs,
    totalStones,
    metalType,
    metalWeightPerPiece,
    totalMetalWeight,
    findings,
    expectedDeliveryAt,
    orderedAt,
  };

  const { action } = await upsertFromOrderImport(payload);
  return { action };
}
