import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  getLossByCell,
  getLossByJobCard,
  getLossByStage,
  getLossSummary,
} from "../services/inventory/materialLossService";

const router = Router();

function asDate(x: unknown): Date | undefined {
  if (typeof x !== "string") return undefined;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

router.get("/material-loss/summary", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const summary = await getLossSummary({
      from: asDate(req.query.from),
      to: asDate(req.query.to),
    });
    return res.status(200).json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get("/material-loss/by-stage", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const items = await getLossByStage({
      from: asDate(req.query.from),
      to: asDate(req.query.to),
    });
    return res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get("/material-loss/by-cell", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const items = await getLossByCell({
      from: asDate(req.query.from),
      to: asDate(req.query.to),
    });
    return res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get(
  "/material-loss/by-job-card/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const loss = await getLossByJobCard(id);
      if (!loss) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ loss });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(500).json({ error: message });
    }
  }
);

export default router;
