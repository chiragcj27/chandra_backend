import type { Types } from "mongoose";

import { GatiColumnMap, type GatiColumnMapDocument } from "../../models/gatiColumnMap";
import { GatiImportRun, type GatiImportRunDocument } from "../../models/gatiImportRun";
import { JobCard, type JobCardDocument } from "../../models/jobCard";
import { Order } from "../../../models/Order";
import type { DiamondSpec, FindingEntry, ImportRowError } from "../../types";
import {
  DEFAULT_ALIASES,
  DEFAULT_ORDER_COLUMNS,
} from "../bootstrap/columnMapDefaults";
import { batchSeedDiamonds } from "../inventory/diamondSeedService";
import type { JobCardImportPayload } from "../production/jobCardService";
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

    // ── Batch-seed all diamonds in ONE round-trip before processing groups ──
    // Collect every unique diamond spec across all groups, then bulk upsert.
    // This replaces N×2-3 serial findOrCreateDiamond calls with 1 query + 1 insertMany.
    const diamondSpecsForSeed: Array<{ gSize: string; sieve: string; diaSizeMM: number; pointer?: number }> = [];
    for (const rows of groups.values()) {
      for (const r of rows) {
        if (r.kind !== "diamond") continue;
        const gSize = toStr(r.raw.GSize);
        const sieve = toStr(r.raw.Size);
        const diaSizeMM = toNumber(r.raw.DiaSizeMM);
        const pointer = toNumber(r.raw.Pointer) ?? undefined;
        if (gSize && sieve && diaSizeMM != null) {
          diamondSpecsForSeed.push({ gSize, sieve, diaSizeMM, pointer });
        }
      }
    }
    if (diamondSpecsForSeed.length > 0) await batchSeedDiamonds(diamondSpecsForSeed);

    // ── Two-pass: build all payloads first (pure transform, no DB) ──────────
    interface ValidPayload { payload: JobCardImportPayload; rowIndex: number }
    const validPayloads: ValidPayload[] = [];
    for (const [pieceCode, rows] of groups) {
      try {
        const payload = buildGroupPayload(pieceCode, rows);
        validPayloads.push({ payload, rowIndex: rows[0]?.rowIndex ?? 0 });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        rowErrors.push({ row: rows[0]?.rowIndex ?? 0, reason: `${pieceCode}: ${reason}` });
      }
    }

    // ── Bulk fetch existing JobCards + parent Orders in one round-trip each ──
    const pieceCodes = validPayloads.map((p) => p.payload.gatiPieceCode);
    const orderNums = [...new Set(validPayloads.map((p) => p.payload.orderNumber))];
    const [existingList, parentOrderList] = await Promise.all([
      pieceCodes.length > 0
        ? JobCard.find({ gatiPieceCode: { $in: pieceCodes } })
        : Promise.resolve([]),
      orderNums.length > 0
        ? Order.find({ orderNumber: { $in: orderNums } }).select({ _id: 1, orderNumber: 1 }).lean()
        : Promise.resolve([]),
    ]);
    const existingMap = new Map<string, JobCardDocument>(
      (existingList as JobCardDocument[]).map((jc) => [jc.gatiPieceCode, jc])
    );
    const parentOrderMap = new Map<string, unknown>(
      (parentOrderList as Array<{ orderNumber: string; _id: unknown }>).map((o) => [o.orderNumber, o._id])
    );

    // ── Categorize into inserts, updates, noops ───────────────────────────
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: Array<{ doc: JobCardDocument; payload: JobCardImportPayload }> = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const { payload, rowIndex } of validPayloads) {
      try {
        const existing = existingMap.get(payload.gatiPieceCode);
        if (!existing) {
          toInsert.push({
            gatiPieceCode: payload.gatiPieceCode,
            orderNumber: payload.orderNumber,
            orderItemSrNo: payload.orderItemSrNo,
            totalQty: payload.totalQty,
            styleNo: payload.styleNo,
            size: payload.size,
            customerCode: payload.customerCode,
            itemCategory: payload.itemCategory,
            perPcPieces:  payload.perPcPieces,
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
            status: "pending",
            currentStageDistribution: [
              { stageCode: "PENDING", cellCode: "PENDING", qty: payload.totalQty },
            ],
            chandraOrderId: parentOrderMap.get(payload.orderNumber),
          });
          inserted++;
        } else if (payloadMatchesExisting(payload, existing)) {
          skipped++;
        } else {
          toUpdate.push({ doc: existing, payload });
          updated++;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        rowErrors.push({ row: rowIndex, reason: `${payload.gatiPieceCode}: ${reason}` });
      }
    }

    // ── Flush inserts ─────────────────────────────────────────────────────
    if (toInsert.length > 0) {
      await JobCard.insertMany(toInsert, { ordered: false });
    }
    // ── Flush updates ─────────────────────────────────────────────────────
    if (toUpdate.length > 0) {
      await JobCard.bulkWrite(
        toUpdate.map(({ doc, payload }) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                totalQty: payload.totalQty,
                styleNo: payload.styleNo,
                size: payload.size,
                customerCode: payload.customerCode,
                ...(payload.itemCategory !== undefined ? { itemCategory: payload.itemCategory } : {}),
                ...(payload.perPcPieces  !== undefined ? { perPcPieces:  payload.perPcPieces  } : {}),
                diamondSpecs: payload.diamondSpecs,
                totalStones: payload.totalStones,
                metalType: payload.metalType,
                metalWeightPerPiece: payload.metalWeightPerPiece,
                totalMetalWeight: payload.totalMetalWeight,
                findings: payload.findings,
                ...(payload.priority ? { priority: payload.priority } : {}),
                ...(payload.expectedDeliveryAt ? { expectedDeliveryAt: payload.expectedDeliveryAt } : {}),
                ...(payload.orderedAt ? { orderedAt: payload.orderedAt } : {}),
              },
            },
          },
        })),
        { ordered: false }
      );
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

function buildGroupPayload(
  pieceCode: string,
  rows: GroupedRow[],
): JobCardImportPayload {
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
  const itemCategory = toStr(anchor.ItemCategory) ?? undefined;
  const perPcPieces  = toNumber(anchor.PerPc_Pieces) ?? undefined;
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
    // Diamond master already seeded via batchSeedDiamonds before this loop.
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

  return {
    gatiPieceCode: pieceCode,
    orderNumber,
    orderItemSrNo: srNo,
    totalQty,
    styleNo,
    size,
    customerCode,
    itemCategory,
    perPcPieces,
    diamondSpecs,
    totalStones,
    metalType,
    metalWeightPerPiece,
    totalMetalWeight,
    findings,
    expectedDeliveryAt,
    orderedAt,
  };
}

/**
 * Deep-equality check on the Order-import-owned fields of a JobCard.
 * Returns true if the payload already matches the persisted doc (noop).
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
  if (existing.diamondSpecs.length !== payload.diamondSpecs.length) return false;
  for (let i = 0; i < payload.diamondSpecs.length; i++) {
    const x = payload.diamondSpecs[i];
    const y = existing.diamondSpecs[i];
    if (!y) return false;
    if (x.gSize !== y.gSize || x.sieve !== y.sieve || x.diaSizeMM !== y.diaSizeMM ||
        x.pointer !== y.pointer || x.totalCaratsPerPiece !== y.totalCaratsPerPiece ||
        x.stonesPerPiece !== y.stonesPerPiece) return false;
  }
  if (existing.findings.length !== payload.findings.length) return false;
  for (let i = 0; i < payload.findings.length; i++) {
    if (existing.findings[i]?.code !== payload.findings[i].code ||
        existing.findings[i]?.qty !== payload.findings[i].qty) return false;
  }
  return true;
}
