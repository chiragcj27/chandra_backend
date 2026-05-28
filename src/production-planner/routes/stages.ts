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
 *
 * Priority: use the stageCode already stored in the wipColumns entry (set by the
 * admin or by the default seed). Fall back to deriving from the rawColumn only
 * when stageCode is blank (pending/unmapped entry).
 *
 * Derivation strips trailing `-N` suffix (e.g. `FIL-2` → `FIL`), trailing
 * digits WITHOUT a preceding space (e.g. `FPL2` → `FPL`), and any remaining
 * whitespace — so `"FG 2"` → `"FG"` (not `"FG "`).
 */
function inferStageCode(raw: string): string {
  let base = raw.trim().toUpperCase();
  base = base.replace(/-\d+$/, "");      // FIL-2  → FIL
  base = base.replace(/\s+\d+$/, "");   // FG 2   → FG  (space + digits at end)
  base = base.replace(/\d+$/, "");      // FPL2   → FPL (bare trailing digits)
  base = base.trim();                    // remove any leftover spaces
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

    // Derive candidate stage codes:
    // 1. If a wipColumn already has a stageCode (set by seed or admin) → use it directly.
    // 2. If stageCode is blank (pending/newly-discovered column) → infer from rawColumn.
    // This ensures seeded mappings like FIL→FILING create "FILING", not "FIL".
    const candidateCodes = [
      ...new Set(
        (map.wipColumns as Array<{ rawColumn: string; stageCode: string }>)
          .map((c) => c.stageCode ? c.stageCode.trim().toUpperCase() : inferStageCode(c.rawColumn))
          .filter(Boolean)
      ),
    ];

    // Use bulkWrite with upsert so this endpoint is fully idempotent —
    // tapping "Detect stages" multiple times never causes duplicate-key errors.
    const bulkOps = candidateCodes.map((code) => ({
      updateOne: {
        filter: { code },
        update: {
          $setOnInsert: {
            code,
            name: codeToName(code),
            expectedDurationHours: 24,
            dependencies: [],
            unitOfWork: "piece" as const,
            isOptional: false,
            isTerminal: false,
            displayOrder: 0,
            active: true,
          },
        },
        upsert: true,
      },
    }));

    const result = await StageDefinition.bulkWrite(bulkOps, { ordered: false });
    const created = result.upsertedCount ?? 0;
    const skipped = candidateCodes.length - created;
    const newCodes = Object.values(result.upsertedIds ?? {}).map(
      (_, i) => candidateCodes[i]
    );

    // Back-fill stageCode + default cellCode "C1" for any pending wipColumn entries
    // so the Column Maps screen shows everything filled in without manual work.
    let mapChanged = false;
    for (const entry of map.wipColumns as Array<{ rawColumn: string; stageCode: string; cellCode: string }>) {
      if (!entry.stageCode) {
        entry.stageCode = inferStageCode(entry.rawColumn);
        entry.cellCode = entry.cellCode || "C1";
        mapChanged = true;
      } else if (!entry.cellCode) {
        entry.cellCode = "C1";
        mapChanged = true;
      }
    }
    if (mapChanged) await map.save();

    return res.status(200).json({ created, skipped, newCodes });
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
