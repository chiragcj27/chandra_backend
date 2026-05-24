import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { JobCard } from "../models/jobCard";
import {
  addMetalLedger,
  getMetalNetForJobCard,
  listMetalLedgerByJobCard,
} from "../services/inventory/metalLedgerService";
import { METAL_LEDGER_TYPES, type MetalLedgerType } from "../types";

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

router.post("/inventory/metal-ledger", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const metalType = asTrimmedString(body.metalType);
  const movementTypeRaw = asTrimmedString(body.movementType);
  const weightGrams = asNumber(body.weightGrams);

  if (!metalType) return res.status(400).json({ error: "metalType is required" });
  if (!movementTypeRaw || !(METAL_LEDGER_TYPES as readonly string[]).includes(movementTypeRaw)) {
    return res.status(400).json({
      error: `movementType must be one of: ${METAL_LEDGER_TYPES.join(", ")}`,
    });
  }
  if (weightGrams == null || weightGrams === 0) {
    return res.status(400).json({ error: "weightGrams (non-zero number) is required" });
  }

  try {
    const jobCardIdRaw = asTrimmedString(body.jobCardId);
    const jobCardId =
      jobCardIdRaw && Types.ObjectId.isValid(jobCardIdRaw)
        ? new Types.ObjectId(jobCardIdRaw)
        : undefined;

    let gatiPieceCode = asTrimmedString(body.gatiPieceCode);
    if (!gatiPieceCode && jobCardId) {
      const jc = await JobCard.findById(jobCardId).select({ gatiPieceCode: 1 });
      gatiPieceCode = jc?.gatiPieceCode;
    }

    const entry = await addMetalLedger({
      metalType,
      movementType: movementTypeRaw as MetalLedgerType,
      weightGrams,
      jobCardId,
      gatiPieceCode,
      stageCode: asTrimmedString(body.stageCode),
      cellCode: asTrimmedString(body.cellCode),
      notes: asTrimmedString(body.notes),
    });
    return res.status(201).json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get(
  "/inventory/metal-ledger/by-job-card/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [entries, net] = await Promise.all([
        listMetalLedgerByJobCard(id),
        getMetalNetForJobCard(id),
      ]);
      return res.status(200).json({ entries, netGrams: net });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
