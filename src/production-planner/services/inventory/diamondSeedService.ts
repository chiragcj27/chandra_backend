import { Diamond, buildDiamondCode, type DiamondDocument } from "../../models/diamond";

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
