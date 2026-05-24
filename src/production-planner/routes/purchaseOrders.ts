import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  PurchaseOrderDraft,
  type PurchaseOrderLine,
} from "../models/purchaseOrderDraft";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  generateAutoPosFromShortages,
} from "../services/inventory/autoPoService";
import { PO_STATUSES } from "../types";

const router = Router();

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function asNumber(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim()) {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asPoLines(x: unknown): PurchaseOrderLine[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: PurchaseOrderLine[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const diamondCode = asTrimmedString(obj.diamondCode);
    const qty = asNumber(obj.qty);
    if (!diamondCode || qty == null || qty <= 0) continue;
    out.push({
      diamondCode,
      qty,
      costEstimate: asNumber(obj.costEstimate),
      notes: asTrimmedString(obj.notes),
    });
  }
  return out;
}

router.get("/purchase-orders", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const status = asTrimmedString(req.query.status);
    const filter: Record<string, unknown> = {};
    if (status && (PO_STATUSES as readonly string[]).includes(status)) {
      filter.status = status;
    }
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    const [items, total] = await Promise.all([
      PurchaseOrderDraft.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PurchaseOrderDraft.countDocuments(filter),
    ]);
    return res.status(200).json({ items, total, limit, skip });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/purchase-orders/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const po = await PurchaseOrderDraft.findById(id);
    if (!po) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ purchaseOrder: po });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/purchase-orders", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const poNumber = asTrimmedString(body.poNumber) ?? `PO-${Date.now()}`;
  const lines = asPoLines(body.lines) ?? [];
  if (lines.length === 0) {
    return res.status(400).json({ error: "lines (non-empty array) is required" });
  }
  try {
    const createdBy =
      req.user?.id && Types.ObjectId.isValid(req.user.id)
        ? new Types.ObjectId(req.user.id)
        : undefined;
    const totalCost = lines.reduce((acc, l) => acc + (l.costEstimate ?? 0), 0);
    const po = await PurchaseOrderDraft.create({
      poNumber,
      supplier: asTrimmedString(body.supplier),
      lines,
      totalCost,
      status: "draft",
      createdBy,
      notes: asTrimmedString(body.notes),
    });
    return res.status(201).json({ purchaseOrder: po });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.put("/purchase-orders/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const po = await PurchaseOrderDraft.findById(id);
    if (!po) return res.status(404).json({ error: "Not found" });
    if (po.status !== "draft") {
      return res.status(400).json({ error: "Only draft POs can be edited" });
    }

    const supplier = asTrimmedString(body.supplier);
    if (typeof body.supplier === "string") po.supplier = supplier;
    const lines = asPoLines(body.lines);
    if (lines) {
      po.lines = lines;
      po.totalCost = lines.reduce((acc, l) => acc + (l.costEstimate ?? 0), 0);
    }
    if (typeof body.notes === "string") po.notes = asTrimmedString(body.notes);

    await po.save();
    return res.status(200).json({ purchaseOrder: po });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.post(
  "/purchase-orders/:id/approve",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const approvedBy =
        req.user?.id && Types.ObjectId.isValid(req.user.id)
          ? new Types.ObjectId(req.user.id)
          : undefined;
      const po = await approvePurchaseOrder(id, approvedBy);
      if (!po) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ purchaseOrder: po });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

router.post(
  "/purchase-orders/:id/cancel",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const po = await cancelPurchaseOrder(id);
      if (!po) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ purchaseOrder: po });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

/** Scan current shortages and refresh/create auto-PO drafts grouped by supplier. */
router.post(
  "/purchase-orders/generate-from-shortages",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    try {
      const result = await generateAutoPosFromShortages();
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

export default router;
