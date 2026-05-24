import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Diamond, buildDiamondCode } from "../models/diamond";

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

router.get("/inventory/diamonds", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const q = asTrimmedString(req.query.q);
    const activeRaw = req.query.active;
    const filter: Record<string, unknown> = {};

    if (typeof activeRaw === "string") {
      if (activeRaw === "true") filter.active = true;
      else if (activeRaw === "false") filter.active = false;
    }
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ code: re }, { gSize: re }, { sieve: re }];
    }

    const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 1000);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    const [items, total] = await Promise.all([
      Diamond.find(filter).sort({ gSize: 1, sieve: 1, diaSizeMM: 1 }).skip(skip).limit(limit),
      Diamond.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, limit, skip });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get(
  "/inventory/diamonds/by-code",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const code = asTrimmedString(req.query.code);
    if (!code) return res.status(400).json({ error: "code query param is required" });
    try {
      const diamond = await Diamond.findOne({ code });
      if (!diamond) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ diamond });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

router.post("/inventory/diamonds", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const gSize = asTrimmedString(body.gSize);
  const sieve = asTrimmedString(body.sieve);
  const diaSizeMM = asNumber(body.diaSizeMM);
  if (!gSize) return res.status(400).json({ error: "gSize is required" });
  if (!sieve) return res.status(400).json({ error: "sieve is required" });
  if (diaSizeMM == null) return res.status(400).json({ error: "diaSizeMM is required" });

  try {
    const code = buildDiamondCode(gSize, sieve, diaSizeMM);
    const existing = await Diamond.findOne({ code });
    if (existing) return res.status(409).json({ error: "Diamond with this code already exists" });

    const diamond = await Diamond.create({
      code,
      gSize,
      sieve,
      diaSizeMM,
      pointer: asNumber(body.pointer),
      clarity: asTrimmedString(body.clarity),
      color: asTrimmedString(body.color),
      costPerStone: asNumber(body.costPerStone),
      reorderThreshold: asNumber(body.reorderThreshold) ?? 0,
      reorderQty: asNumber(body.reorderQty) ?? 0,
      procurementLeadTimeDays: asNumber(body.procurementLeadTimeDays) ?? 0,
      preferredSupplier: asTrimmedString(body.preferredSupplier),
      active: typeof body.active === "boolean" ? body.active : true,
    });
    return res.status(201).json({ diamond });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/inventory/diamonds/by-code", requireAuth, requireRole("admin"), async (req, res) => {
  const code = asTrimmedString(req.query.code);
  if (!code) return res.status(400).json({ error: "code query param is required" });

  const body = req.body as Record<string, unknown>;

  try {
    const diamond = await Diamond.findOne({ code });
    if (!diamond) return res.status(404).json({ error: "Not found" });

    // Mutable fields only — gSize/sieve/diaSizeMM are part of the canonical code and stay locked.
    const pointer = asNumber(body.pointer);
    if (pointer != null) diamond.pointer = pointer;
    if (typeof body.clarity === "string") diamond.clarity = asTrimmedString(body.clarity);
    if (typeof body.color === "string") diamond.color = asTrimmedString(body.color);
    const cost = asNumber(body.costPerStone);
    if (cost != null) diamond.costPerStone = cost;
    const thresh = asNumber(body.reorderThreshold);
    if (thresh != null) diamond.reorderThreshold = thresh;
    const reorderQty = asNumber(body.reorderQty);
    if (reorderQty != null) diamond.reorderQty = reorderQty;
    const lead = asNumber(body.procurementLeadTimeDays);
    if (lead != null) diamond.procurementLeadTimeDays = lead;
    if (typeof body.preferredSupplier === "string") {
      diamond.preferredSupplier = asTrimmedString(body.preferredSupplier);
    }
    if (typeof body.active === "boolean") diamond.active = body.active;

    await diamond.save();
    return res.status(200).json({ diamond });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete(
  "/inventory/diamonds/by-code",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const code = asTrimmedString(req.query.code);
    if (!code) return res.status(400).json({ error: "code query param is required" });
    try {
      // Soft-delete: flip active=false. Future phases (allocations/ledger) can refuse to delete
      // a SKU with active history; for now we don't have those collections populated.
      const diamond = await Diamond.findOne({ code });
      if (!diamond) return res.status(404).json({ error: "Not found" });
      diamond.active = false;
      await diamond.save();
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
