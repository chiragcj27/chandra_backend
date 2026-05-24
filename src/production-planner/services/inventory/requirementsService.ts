import { Diamond, buildDiamondCode } from "../../models/diamond";
import { JobCard } from "../../models/jobCard";
import { getAllocatedMap } from "./allocationService";
import { getOnHandMap } from "./inventoryLedgerService";

export type SkuStatus = "ok" | "low" | "shortage" | "critical";

export interface RequirementRow {
  diamondCode: string;
  gSize: string;
  sieve: string;
  diaSizeMM: number;
  pointer?: number;
  costPerStone?: number;
  reorderThreshold: number;
  reorderQty: number;
  procurementLeadTimeDays: number;
  preferredSupplier?: string;
  onHand: number;
  allocated: number;
  available: number;
  required: number;
  delta: number;
  reorderSuggestedQty: number;
  status: SkuStatus;
}

/**
 * Compute the live requirements-vs-stock table across every Diamond SKU.
 *
 *   onHand     = sum of all `DiamondInventoryLedger.quantity` for the SKU
 *                (receipts +ve, allocations/consumptions/losses -ve)
 *   allocated  = sum of active allocations' remaining qty (= allocated − consumed)
 *   available  = onHand − allocated
 *   required   = sum across OPEN JobCards of stoneCountPerPiece × totalQty
 *                for diamond specs matching this SKU (by gSize + sieve + diaSizeMM)
 *   delta      = available − required          (negative = shortage)
 *   reorderSuggestedQty
 *              = max(reorderQty, |delta|)      (only if delta < 0 or onHand < threshold)
 *
 *   status:
 *     critical → delta < 0 && procurementLeadTimeDays > daysUntilNeeded
 *     shortage → delta < 0
 *     low      → available < reorderThreshold
 *     ok       → otherwise
 */
export async function buildRequirementsTable(): Promise<RequirementRow[]> {
  const diamonds = await Diamond.find({ active: true });
  const onHandMap = await getOnHandMap();
  const allocatedMap = await getAllocatedMap();

  // Build per-SKU required by aggregating over open JobCards' diamondSpecs.
  const requiredMap = new Map<string, number>();
  // Also track the earliest expectedDeliveryAt per SKU for criticality calc.
  const earliestNeededByCode = new Map<string, Date>();

  const openJobCards = await JobCard.find({
    status: { $in: ["planned", "in_progress", "on_hold"] },
  }).select({
    diamondSpecs: 1,
    totalQty: 1,
    expectedDeliveryAt: 1,
  });

  for (const jc of openJobCards) {
    for (const spec of jc.diamondSpecs ?? []) {
      const code = buildDiamondCode(spec.gSize, spec.sieve, spec.diaSizeMM);
      const need = (spec.stonesPerPiece ?? 0) * (jc.totalQty ?? 0);
      requiredMap.set(code, (requiredMap.get(code) ?? 0) + need);

      if (jc.expectedDeliveryAt) {
        const prior = earliestNeededByCode.get(code);
        if (!prior || jc.expectedDeliveryAt < prior) {
          earliestNeededByCode.set(code, jc.expectedDeliveryAt);
        }
      }
    }
  }

  const now = Date.now();
  const rows: RequirementRow[] = [];

  for (const d of diamonds) {
    const onHand = onHandMap.get(d.code) ?? 0;
    const allocated = allocatedMap.get(d.code) ?? 0;
    const available = onHand - allocated;
    const required = requiredMap.get(d.code) ?? 0;
    const delta = available - required;

    let status: SkuStatus = "ok";
    if (delta < 0) {
      status = "shortage";
      const neededBy = earliestNeededByCode.get(d.code);
      if (neededBy) {
        const daysUntilNeeded = Math.max(0, (neededBy.getTime() - now) / 86_400_000);
        if ((d.procurementLeadTimeDays ?? 0) > daysUntilNeeded) {
          status = "critical";
        }
      }
    } else if (available < (d.reorderThreshold ?? 0)) {
      status = "low";
    }

    const threshold = d.reorderThreshold ?? 0;
    const reorderSuggestedQty =
      status === "ok"
        ? 0
        : Math.max(d.reorderQty ?? 0, delta < 0 ? Math.abs(delta) : threshold - available);

    rows.push({
      diamondCode: d.code,
      gSize: d.gSize,
      sieve: d.sieve,
      diaSizeMM: d.diaSizeMM,
      pointer: d.pointer,
      costPerStone: d.costPerStone,
      reorderThreshold: d.reorderThreshold ?? 0,
      reorderQty: d.reorderQty ?? 0,
      procurementLeadTimeDays: d.procurementLeadTimeDays ?? 0,
      preferredSupplier: d.preferredSupplier,
      onHand,
      allocated,
      available,
      required,
      delta,
      reorderSuggestedQty,
      status,
    });
  }

  // Sort: criticals first, then shortages, then by largest negative delta.
  rows.sort((a, b) => {
    const rank = (s: SkuStatus): number =>
      s === "critical" ? 0 : s === "shortage" ? 1 : s === "low" ? 2 : 3;
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return a.delta - b.delta;
  });

  return rows;
}

export async function getShortages(): Promise<RequirementRow[]> {
  const all = await buildRequirementsTable();
  return all.filter((r) => r.status === "shortage" || r.status === "critical");
}
