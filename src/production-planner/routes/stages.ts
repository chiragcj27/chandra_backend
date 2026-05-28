import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { StageDefinition } from "../models/stageDefinition";
import { GatiColumnMap } from "../models/gatiColumnMap";
import { UNIT_OF_WORK, type UnitOfWork } from "../types";

const router = Router();

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function asUnitOfWork(x: unknown): UnitOfWork | undefined {
  if (typeof x !== "string") return undefined;
  return (UNIT_OF_WORK as readonly string[]).includes(x) ? (x as UnitOfWork) : undefined;
}

function asStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

router.get("/stages", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const stages = await StageDefinition.find().sort({ displayOrder: 1, code: 1 });
    return res.status(200).json({ stages });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/stages/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const stage = await StageDefinition.findOne({ code: String(req.params.code).toUpperCase() });
    if (!stage) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ stage });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/stages", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const code = asTrimmedString(body.code)?.toUpperCase();
  const name = asTrimmedString(body.name);
  if (!code) return res.status(400).json({ error: "code is required" });
  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const existing = await StageDefinition.findOne({ code });
    if (existing) return res.status(409).json({ error: "Stage code already exists" });

    const stage = await StageDefinition.create({
      code,
      name,
      expectedDurationHours: Number.isFinite(body.expectedDurationHours)
        ? Number(body.expectedDurationHours)
        : 24,
      expectedDurationStdDevHours: Number.isFinite(body.expectedDurationStdDevHours)
        ? Number(body.expectedDurationStdDevHours)
        : undefined,
      dependencies: asStringArray(body.dependencies) ?? [],
      parallelGroup: asTrimmedString(body.parallelGroup),
      unitOfWork: asUnitOfWork(body.unitOfWork) ?? "piece",
      isOptional: typeof body.isOptional === "boolean" ? body.isOptional : false,
      isTerminal: typeof body.isTerminal === "boolean" ? body.isTerminal : false,
      displayOrder: Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0,
      active: typeof body.active === "boolean" ? body.active : true,
      description: asTrimmedString(body.description),
    });

    return res.status(201).json({ stage });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * Infer a base stage code from a raw WIP column name.
 * Strips trailing `-N` suffix (e.g. `FIL-2` → `FIL`) and trailing digits
 * (e.g. `FPL2` → `FPL`). Falls back to the raw column uppercased.
 */
function inferStageCode(raw: string): string {
  let base = raw.trim().toUpperCase();
  base = base.replace(/-\d+$/, "");   // e.g. FIL-2 → FIL
  base = base.replace(/\d+$/, "");    // e.g. FPL2 → FPL
  return base || raw.trim().toUpperCase();
}

/** Derive a human-readable display name from a stage code. */
function codeToName(code: string): string {
  return code
    .replace(/_/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * POST /stages/seed-from-movements
 *
 * Auto-detect stage codes from the raw column names stored in the WIP column
 * map, then create StageDefinition records for any that don't exist yet.
 *
 * Response shape expected by the frontend:
 *   { created: number; skipped: number; newCodes: string[] }
 */
router.post("/stages/seed-from-movements", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const map = await GatiColumnMap.findOne({ fileType: "wip", active: true });
    if (!map || !map.wipColumns || map.wipColumns.length === 0) {
      return res.status(200).json({ created: 0, skipped: 0, newCodes: [] });
    }

    const rawColumns: string[] = (map.wipColumns as Array<{ rawColumn: string }>)
      .map((c) => c.rawColumn)
      .filter(Boolean);

    if (rawColumns.length === 0) {
      return res.status(200).json({ created: 0, skipped: 0, newCodes: [] });
    }

    // Infer unique candidate stage codes
    const candidateCodes = [...new Set(rawColumns.map(inferStageCode))];

    const existing = await StageDefinition.find({ code: { $in: candidateCodes } }).lean();
    const existingSet = new Set(existing.map((s) => s.code));

    const newCodes: string[] = [];
    for (const code of candidateCodes) {
      if (!existingSet.has(code)) {
        newCodes.push(code);
      }
    }

    if (newCodes.length === 0) {
      return res.status(200).json({ created: 0, skipped: candidateCodes.length, newCodes: [] });
    }

    const now = new Date();
    const docs = newCodes.map((code) => ({
      code,
      name: codeToName(code),
      expectedDurationHours: 24,
      dependencies: [],
      unitOfWork: "piece" as const,
      isOptional: false,
      isTerminal: false,
      displayOrder: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    }));

    await StageDefinition.insertMany(docs);

    return res.status(200).json({
      created: newCodes.length,
      skipped: candidateCodes.length - newCodes.length,
      newCodes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.put("/stages/:code", requireAuth, requireRole("admin"), async (req, res) => {
  const body = req.body as Record<string, unknown>;

  try {
    const stage = await StageDefinition.findOne({ code: String(req.params.code).toUpperCase() });
    if (!stage) return res.status(404).json({ error: "Not found" });

    const name = asTrimmedString(body.name);
    if (typeof name === "string") stage.name = name;

    if (Number.isFinite(body.expectedDurationHours)) {
      stage.expectedDurationHours = Number(body.expectedDurationHours);
    }
    if (Number.isFinite(body.expectedDurationStdDevHours)) {
      stage.expectedDurationStdDevHours = Number(body.expectedDurationStdDevHours);
    }
    const deps = asStringArray(body.dependencies);
    if (deps) stage.dependencies = deps;

    const parallelGroup = asTrimmedString(body.parallelGroup);
    if (typeof body.parallelGroup === "string") stage.parallelGroup = parallelGroup;

    const unitOfWork = asUnitOfWork(body.unitOfWork);
    if (unitOfWork) stage.unitOfWork = unitOfWork;

    if (typeof body.isOptional === "boolean") stage.isOptional = body.isOptional;
    if (typeof body.isTerminal === "boolean") stage.isTerminal = body.isTerminal;
    if (Number.isFinite(body.displayOrder)) stage.displayOrder = Number(body.displayOrder);
    if (typeof body.active === "boolean") stage.active = body.active;

    const description = asTrimmedString(body.description);
    if (typeof body.description === "string") stage.description = description;

    await stage.save();
    return res.status(200).json({ stage });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/stages/:code", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await StageDefinition.deleteOne({ code: String(req.params.code).toUpperCase() });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
