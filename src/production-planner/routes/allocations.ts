import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  allocate,
  consume,
  getAllocationsByJobCard,
  release,
} from "../services/inventory/allocationService";

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

router.post("/inventory/allocations", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const jobCardIdRaw = asTrimmedString(body.jobCardId);
  const diamondCode = asTrimmedString(body.diamondCode);
  const qty = asNumber(body.qty);

  if (!jobCardIdRaw || !Types.ObjectId.isValid(jobCardIdRaw)) {
    return res.status(400).json({ error: "valid jobCardId is required" });
  }
  if (!diamondCode) return res.status(400).json({ error: "diamondCode is required" });
  if (qty == null || qty <= 0) {
    return res.status(400).json({ error: "qty (positive number) is required" });
  }

  try {
    const allocation = await allocate({
      jobCardId: new Types.ObjectId(jobCardIdRaw),
      diamondCode,
      qty,
      notes: asTrimmedString(body.notes),
    });
    return res.status(201).json({ allocation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(400).json({ error: message });
  }
});

router.post(
  "/inventory/allocations/:id/consume",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const qty = asNumber(body.qty);

    try {
      const allocation = await consume(id, qty);
      return res.status(200).json({ allocation });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(400).json({ error: message });
    }
  }
);

router.post(
  "/inventory/allocations/:id/release",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const allocation = await release(id);
      return res.status(200).json({ allocation });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      return res.status(400).json({ error: message });
    }
  }
);

router.get(
  "/inventory/allocations/by-job-card/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const allocations = await getAllocationsByJobCard(id);
      return res.status(200).json({ allocations });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
