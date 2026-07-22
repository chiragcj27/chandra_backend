import { Diamond, buildDiamondCode, type DiamondDocument } from "../../models/diamond";
import type { AnyBulkWriteOperation } from "mongoose";

/**
 * Batch-upsert diamond master records for an array of specs.
 * Uses a single find + insertMany instead of N serial findOrCreate calls.
 * Safe to call with duplicates — deduplication is done here.
 */
export async function batchSeedDiamonds(
  specs: Array<{ gSize: string; sieve: string; diaSizeMM: number; pointer?: number }>
): Promise<void> {
  if (specs.length === 0) return;

  // Deduplicate by code.
  const byCode = new Map<string, (typeof specs)[0]>();
  for (const s of specs) {
    const code = buildDiamondCode(s.gSize, s.sieve, s.diaSizeMM);
    if (!byCode.has(code)) byCode.set(code, s);
  }

  const codes = Array.from(byCode.keys());

  // One read for all codes.
  const existing = await Diamond.find({ code: { $in: codes } }).select("code pointer");
  const existingMap = new Map(existing.map((d) => [d.code, d]));

  const bulkOps: AnyBulkWriteOperation<InstanceType<typeof Diamond>>[] = [];

  for (const [code, spec] of byCode) {
    const doc = existingMap.get(code);
    if (!doc) {
      // New diamond — insert.
      bulkOps.push({
        insertOne: {
          document: {
            code,
            gSize: spec.gSize,
            sieve: spec.sieve,
            diaSizeMM: spec.diaSizeMM,
            pointer: spec.pointer,
            reorderThreshold: 0,
            reorderQty: 0,
            procurementLeadTimeDays: 0,
            active: true,
          } as any,
        },
      });
    } else if (doc.pointer == null && spec.pointer != null) {
      // Existing diamond missing pointer — fill it in.
      bulkOps.push({
        updateOne: {
          filter: { code },
          update: { $set: { pointer: spec.pointer } },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await Diamond.bulkWrite(bulkOps as AnyBulkWriteOperation[], { ordered: false });
  }
}

/**
 * Find a Diamond master record by its canonical (gSize, sieve, diaSizeMM) key,
 * or create a new one if it doesn't exist. Returns the (existing or new) doc.
 *
 * Auto-seeding is idempotent — repeated calls for the same spec are safe.
 * `pointer` is stored on the master when first encountered but never overwritten
 * (the first import wins; admin can edit via PUT /inventory/diamonds/:code).
 */
export async function findOrCreateDiamond(spec: {
  gSize: string;
  sieve: string;
  diaSizeMM: number;
  pointer?: number;
}): Promise<DiamondDocument> {
  const code = buildDiamondCode(spec.gSize, spec.sieve, spec.diaSizeMM);
  const existing = await Diamond.findOne({ code });
  if (existing) {
    // If the master doesn't yet have a pointer recorded and this import has one, fill it.
    if (existing.pointer == null && spec.pointer != null) {
      existing.pointer = spec.pointer;
      await existing.save();
    }
    return existing;
  }
  return Diamond.create({
    code,
    gSize: spec.gSize,
    sieve: spec.sieve,
    diaSizeMM: spec.diaSizeMM,
    pointer: spec.pointer,
    reorderThreshold: 0,
    reorderQty: 0,
    procurementLeadTimeDays: 0,
    active: true,
  });
}
