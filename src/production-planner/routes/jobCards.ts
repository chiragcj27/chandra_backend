import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { JobCard } from "../models/jobCard";
import {
  getJobCardByPieceCode,
  listJobCards,
  setFindingsReceived,
  setPriority,
  type ListJobCardsQuery,
} from "../services/production/jobCardService";
import { JOB_CARD_STATUSES, PRIORITY_LEVELS, type PriorityLevel } from "../types";

const router = Router();

function asEnum<T extends readonly string[]>(x: unknown, enumArr: T): T[number] | undefined {
  if (typeof x !== "string") return undefined;
  return (enumArr as readonly string[]).includes(x) ? (x as T[number]) : undefined;
}

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

/**
 * NOTE on identifiers:
 *   - `gatiPieceCode` contains slashes (e.g. `CO/REG/26-27/0112/1`), which makes
 *     it unwieldy as a path parameter under Express.
 *   - Sub-action routes therefore use Mongo `_id` in the path: `/job-cards/:id/...`.
 *   - For lookup by the GatiSOFT code, use `GET /job-cards/by-code?code=<URL-encoded>`.
 */

router.get("/job-cards", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const query: ListJobCardsQuery = {
      status: asEnum(req.query.status, JOB_CARD_STATUSES),
      customerCode: asString(req.query.customerCode),
      priority: asEnum(req.query.priority, PRIORITY_LEVELS),
      orderNumber: asString(req.query.orderNumber),
      deliveryBefore: asDate(req.query.deliveryBefore),
      isLate: req.query.isLate === "true" || req.query.isLate === "1",
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      skip: req.query.skip != null ? Number(req.query.skip) : undefined,
    };

    const result = await listJobCards(query);
    return res.status(200).json({
      items: result.items,
      total: result.total,
      limit: query.limit ?? 50,
      skip: query.skip ?? 0,
    });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/job-cards/by-code", requireAuth, requireRole("admin"), async (req, res) => {
  const code = asString(req.query.code);
  if (!code) return res.status(400).json({ error: "code query param is required" });
  try {
    const jobCard = await getJobCardByPieceCode(code);
    if (!jobCard) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ jobCard });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/job-cards/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const jobCard = await JobCard.findById(id);
    if (!jobCard) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ jobCard });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/job-cards/:id/findings", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body as { received?: unknown };
  if (typeof body.received !== "boolean") {
    return res.status(400).json({ error: "received (boolean) is required" });
  }
  try {
    const doc = await JobCard.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const updated = await setFindingsReceived(doc.gatiPieceCode, body.received);
    return res.status(200).json({ jobCard: updated });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/job-cards/:id/priority", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body as { priority?: unknown };
  const priority = asEnum(body.priority, PRIORITY_LEVELS) as PriorityLevel | undefined;
  if (!priority) {
    return res
      .status(400)
      .json({ error: `priority must be one of: ${PRIORITY_LEVELS.join(", ")}` });
  }
  try {
    const doc = await JobCard.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const updated = await setPriority(doc.gatiPieceCode, priority);
    return res.status(200).json({ jobCard: updated });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
