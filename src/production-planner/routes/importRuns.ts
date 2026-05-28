import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { GatiImportRun } from "../models/gatiImportRun";
import { IMPORT_FILE_TYPES, IMPORT_RUN_STATUSES } from "../types";

const router = Router();

function asEnum<T extends readonly string[]>(x: unknown, enumArr: T): T[number] | undefined {
  if (typeof x !== "string") return undefined;
  return (enumArr as readonly string[]).includes(x) ? (x as T[number]) : undefined;
}

router.get("/imports/runs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const fileType = asEnum(req.query.fileType, IMPORT_FILE_TYPES);
    const status = asEnum(req.query.status, IMPORT_RUN_STATUSES);

    const filter: Record<string, unknown> = {};
    if (fileType) filter.fileType = fileType;
    if (status) filter.status = status;

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    const [items, total] = await Promise.all([
      GatiImportRun.find(filter)
        .select({ rowErrors: 0 }) // omit large arrays from the list view
        .sort({ uploadedAt: -1 })
        .skip(skip)
        .limit(limit),
      GatiImportRun.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, limit, skip });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/imports/runs/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid run id" });
  try {
    const run = await GatiImportRun.findById(id);
    if (!run) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ run });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
