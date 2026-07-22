import { Types } from "mongoose";

import {
  PurchaseOrderDraft,
  type PurchaseOrderDraftDocument,
  type PurchaseOrderLine,
} from "../../models/purchaseOrderDraft";
import { buildRequirementsTable, type RequirementRow } from "./requirementsService";

const UNKNOWN_SUPPLIER = "UNKNOWN";

export interface GenerateAutoPosResult {
  draftedCount: number;
  totalLines: number;
  drafts: PurchaseOrderDraftDocument[];
  skippedReason?: string;
}

/**
 * Scan the live requirements table for shortages and draft Purchase Orders
 * grouped by `preferredSupplier`. SKUs without a preferred supplier are
 * bundled under "UNKNOWN" so the admin still sees them and can assign one
 * before approving.
 *
 * - Idempotent: a draft for the same (supplier, set of lines) is replaced
 *   on every run. Approved / sent / received POs are NEVER touched.
 * - Only `shortage` and `critical` rows generate lines.
 * - `triggeredByAlertId` is currently null — the alert engine will populate
 *   this when a shortage alert fires that calls this service.
 */
export async function generateAutoPosFromShortages(): Promise<GenerateAutoPosResult> {
  const requirements = await buildRequirementsTable();
  const shortages = requirements.filter((r) => r.status === "shortage" || r.status === "critical");
  if (shortages.length === 0) {
    return { draftedCount: 0, totalLines: 0, drafts: [], skippedReason: "No shortages" };
  }

  // Group by supplier.
  const bySupplier = new Map<string, RequirementRow[]>();
  for (const row of shortages) {
    const key = row.preferredSupplier ?? UNKNOWN_SUPPLIER;
    const list = bySupplier.get(key) ?? [];
    list.push(row);
    bySupplier.set(key, list);
  }

  const now = new Date();
  const drafts: PurchaseOrderDraftDocument[] = [];

  for (const [supplier, rows] of bySupplier) {
    const lines: PurchaseOrderLine[] = rows.map((r) => ({
      diamondCode: r.diamondCode,
      qty: r.reorderSuggestedQty,
      costEstimate: r.costPerStone != null ? r.costPerStone * r.reorderSuggestedQty : undefined,
      notes: `Auto: delta ${r.delta}, lead ${r.procurementLeadTimeDays}d`,
    }));

    const totalCost = lines.reduce((acc, l) => acc + (l.costEstimate ?? 0), 0);

    // Find any existing DRAFT for this supplier — overwrite its lines instead
    // of creating duplicates. Approved/sent/received drafts are left alone.
    const existingDraft = await PurchaseOrderDraft.findOne({
      supplier: supplier === UNKNOWN_SUPPLIER ? null : supplier,
      status: "draft",
    });

    if (existingDraft) {
      existingDraft.lines = lines;
      existingDraft.totalCost = totalCost;
      existingDraft.notes = `Refreshed ${now.toISOString()}`;
      await existingDraft.save();
      drafts.push(existingDraft);
    } else {
      const poNumber = `AUTO-${now.getTime()}-${supplier.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "X"}`;
      const draft = await PurchaseOrderDraft.create({
        poNumber,
        supplier: supplier === UNKNOWN_SUPPLIER ? undefined : supplier,
        lines,
        totalCost,
        status: "draft",
        notes: `Auto-generated ${now.toISOString()} from ${rows.length} shortage(s)`,
      });
      drafts.push(draft);
    }
  }

  return {
    draftedCount: drafts.length,
    totalLines: drafts.reduce((acc, d) => acc + d.lines.length, 0),
    drafts,
  };
}

export async function approvePurchaseOrder(
  id: Types.ObjectId | string,
  approvedBy?: Types.ObjectId
): Promise<PurchaseOrderDraftDocument | null> {
  const po = await PurchaseOrderDraft.findById(id);
  if (!po) return null;
  if (po.status !== "draft") return po; // idempotent
  po.status = "approved";
  po.approvedBy = approvedBy;
  po.approvedAt = new Date();
  await po.save();
  return po;
}

export async function cancelPurchaseOrder(
  id: Types.ObjectId | string
): Promise<PurchaseOrderDraftDocument | null> {
  const po = await PurchaseOrderDraft.findById(id);
  if (!po) return null;
  if (po.status === "received") return po; // can't cancel a received PO
  po.status = "cancelled";
  po.cancelledAt = new Date();
  await po.save();
  return po;
}
