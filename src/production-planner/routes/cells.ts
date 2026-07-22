import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Cell } from "../models/cell";

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

router.get("/cells", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const cells = await Cell.find().sort({ code: 1 });
    return res.status(200).json({ cells });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/cells/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const cell = await Cell.findOne({ code: String(req.params.code).toUpperCase() });
    if (!cell) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ cell });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/cells", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const code = asTrimmedString(body.code)?.toUpperCase();
  const name = asTrimmedString(body.name);
  if (!code) return res.status(400).json({ error: "code is required" });
  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const existing = await Cell.findOne({ code });
    if (existing) return res.status(409).json({ error: "Cell code already exists" });

    const cell = await Cell.create({
      code,
      name,
      stageCodes: asStringArray(body.stageCodes) ?? [],
      workersCount: Number.isFinite(body.workersCount) ? Number(body.workersCount) : 1,
      description: asTrimmedString(body.description),
      active: typeof body.active === "boolean" ? body.active : true,
    });

    return res.status(201).json({ cell });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/cells/:code", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  try {
    const cell = await Cell.findOne({ code: String(req.params.code).toUpperCase() });
    if (!cell) return res.status(404).json({ error: "Not found" });

    const name = asTrimmedString(body.name);
    if (typeof name === "string") cell.name = name;

    const stageCodes = asStringArray(body.stageCodes);
    if (stageCodes) cell.stageCodes = stageCodes;

    if (typeof body.description === "string") {
      cell.description = asTrimmedString(body.description);
    }
    if (typeof body.active === "boolean") cell.active = body.active;
    if (Number.isFinite(body.workersCount)) {
      cell.workersCount = Number(body.workersCount);
    }

    await cell.save();
    return res.status(200).json({ cell });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/cells/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await Cell.deleteOne({ code: String(req.params.code).toUpperCase() });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
