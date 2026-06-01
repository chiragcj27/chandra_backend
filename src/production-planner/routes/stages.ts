import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { StageDefinition } from "../models/stageDefinition";
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

    // Replace duration rules if provided
    if (Array.isArray(body.durationRules)) {
      stage.durationRules = (body.durationRules as Array<Record<string, unknown>>)
        .filter(
          (r) =>
            Number.isFinite(Number(r.weightMin)) &&
            Number.isFinite(Number(r.weightMax)) &&
            Number.isFinite(Number(r.hours))
        )
        .map((r) => ({
          category:    typeof r.category    === "string" ? r.category.trim()    : "",
          weightLabel: typeof r.weightLabel === "string" ? r.weightLabel.trim() : "",
          weightMin:   Number(r.weightMin),
          weightMax:   Number(r.weightMax),
          hours:       Number(r.hours),
        }));
    }

    await stage.save();
    return res.status(200).json({ stage });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PUT /stages/:code/duration-rules
 * Replace all duration rules for a stage in one call.
 * Body: [{ category, weightMin, weightMax, hours }, ...]
 */
router.put("/stages/:code/duration-rules", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const stage = await StageDefinition.findOne({ code: String(req.params.code).toUpperCase() });
    if (!stage) return res.status(404).json({ error: "Stage not found" });

    const body = req.body;
    if (!Array.isArray(body)) return res.status(400).json({ error: "Body must be an array of rules" });

    stage.durationRules = body
      .filter(
        (r) =>
          Number.isFinite(Number(r?.weightMin)) &&
          Number.isFinite(Number(r?.weightMax)) &&
          Number.isFinite(Number(r?.hours))
      )
      .map((r) => ({
        category:    typeof r.category    === "string" ? r.category.trim()    : "",
        weightLabel: typeof r.weightLabel === "string" ? r.weightLabel.trim() : "",
        weightMin:   Number(r.weightMin),
        weightMax:   Number(r.weightMax),
        hours:       Number(r.hours),
      }));

    await stage.save();
    return res.status(200).json({ stage });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /stages/:code/duration-rules
 * Clear all duration rules (revert to flat expectedDurationHours).
 */
router.delete("/stages/:code/duration-rules", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const stage = await StageDefinition.findOne({ code: String(req.params.code).toUpperCase() });
    if (!stage) return res.status(404).json({ error: "Stage not found" });
    stage.durationRules = [];
    await stage.save();
    return res.status(200).json({ ok: true, stage });
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
