import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { JobCard } from "../models/jobCard";
import { StageMovement } from "../models/stageMovement";
import { timelineForJobCard } from "../services/production/stageMovementService";

const router = Router();

function asString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function asDate(x: unknown): Date | undefined {
  if (typeof x !== "string") return undefined;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

router.get("/movements", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};

    const stageCode = asString(req.query.stageCode);
    const cellCode = asString(req.query.cellCode);
    const gatiPieceCode = asString(req.query.gatiPieceCode);
    const from = asDate(req.query.from);
    const to = asDate(req.query.to);

    if (stageCode) filter.toStageCode = stageCode.toUpperCase();
    if (cellCode) filter.cellCode = cellCode.toUpperCase();
    if (gatiPieceCode) filter.gatiPieceCode = gatiPieceCode;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.enteredAt = range;
    }

    const onlyOpen = req.query.open === "true" || req.query.open === "1";
    if (onlyOpen) filter.exitedAt = { $exists: false };

    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 1000);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    const [items, total] = await Promise.all([
      StageMovement.find(filter).sort({ enteredAt: -1 }).skip(skip).limit(limit),
      StageMovement.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, limit, skip });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get(
  "/job-cards/:id/movements",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const jc = await JobCard.findById(id).select({ _id: 1 });
      if (!jc) return res.status(404).json({ error: "Not found" });
      const movements = await timelineForJobCard(jc._id as Types.ObjectId);
      return res.status(200).json({ movements });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
