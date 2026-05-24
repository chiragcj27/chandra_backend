import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Cell } from "../models/cell";
import { Seat } from "../models/seat";

const router = Router();

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function asStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().toUpperCase());
}

router.get("/seats", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const cellCode = asTrimmedString(req.query.cellCode)?.toUpperCase();
    const filter: Record<string, unknown> = {};
    if (cellCode) filter.cellCode = cellCode;
    const seats = await Seat.find(filter).sort({ cellCode: 1, code: 1 });
    return res.status(200).json({ seats });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/seats/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const seat = await Seat.findOne({ code: String(req.params.code).toUpperCase() });
    if (!seat) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ seat });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/seats", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const code = asTrimmedString(body.code)?.toUpperCase();
  const cellCode = asTrimmedString(body.cellCode)?.toUpperCase();
  if (!code) return res.status(400).json({ error: "code is required" });
  if (!cellCode) return res.status(400).json({ error: "cellCode is required" });

  try {
    const cell = await Cell.findOne({ code: cellCode });
    if (!cell) return res.status(400).json({ error: "Parent cell not found" });

    const existing = await Seat.findOne({ code });
    if (existing) return res.status(409).json({ error: "Seat code already exists" });

    const seat = await Seat.create({
      code,
      cellId: cell._id,
      cellCode,
      stageCodes: asStringArray(body.stageCodes) ?? [],
      active: typeof body.active === "boolean" ? body.active : true,
    });

    return res.status(201).json({ seat });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/seats/:code", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  try {
    const seat = await Seat.findOne({ code: String(req.params.code).toUpperCase() });
    if (!seat) return res.status(404).json({ error: "Not found" });

    const newCellCode = asTrimmedString(body.cellCode)?.toUpperCase();
    if (newCellCode && newCellCode !== seat.cellCode) {
      const cell = await Cell.findOne({ code: newCellCode });
      if (!cell) return res.status(400).json({ error: "Parent cell not found" });
      seat.cellId = cell._id as typeof seat.cellId;
      seat.cellCode = newCellCode;
    }

    const stageCodes = asStringArray(body.stageCodes);
    if (stageCodes) seat.stageCodes = stageCodes;

    if (typeof body.active === "boolean") seat.active = body.active;

    await seat.save();
    return res.status(200).json({ seat });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/seats/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await Seat.deleteOne({ code: String(req.params.code).toUpperCase() });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
