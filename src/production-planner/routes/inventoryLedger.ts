import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import {
  addLedgerEntry,
  getLedgerStats,
  listLedgerForCode,
} from "../services/inventory/inventoryLedgerService";
import { DIAMOND_LEDGER_TYPES, type DiamondLedgerType } from "../types";

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

router.post("/inventory/ledger", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const diamondCode = asTrimmedString(body.diamondCode);
  const movementTypeRaw = asTrimmedString(body.movementType);
  const quantity = asNumber(body.quantity);

  if (!diamondCode) return res.status(400).json({ error: "diamondCode is required" });
  if (!movementTypeRaw || !(DIAMOND_LEDGER_TYPES as readonly string[]).includes(movementTypeRaw)) {
    return res.status(400).json({
      error: `movementType must be one of: ${DIAMOND_LEDGER_TYPES.join(", ")}`,
    });
  }
  if (quantity == null || quantity === 0) {
    return res.status(400).json({ error: "quantity (non-zero number) is required" });
  }

  try {
    const jobCardIdRaw = asTrimmedString(body.jobCardId);
    const jobCardId =
      jobCardIdRaw && Types.ObjectId.isValid(jobCardIdRaw)
        ? new Types.ObjectId(jobCardIdRaw)
        : undefined;

    const entry = await addLedgerEntry({
      diamondCode,
      movementType: movementTypeRaw as DiamondLedgerType,
      quantity,
      jobCardId,
      gatiPieceCode: asTrimmedString(body.gatiPieceCode),
      referenceDoc: asTrimmedString(body.referenceDoc),
      notes: asTrimmedString(body.notes),
    });
    return res.status(201).json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get(
  "/inventory/diamonds/:code/ledger",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const code = String(req.params.code);
    if (!code) return res.status(400).json({ error: "code is required" });
    try {
      const limit = asNumber(req.query.limit) ?? 200;
      const [entries, stats] = await Promise.all([
        listLedgerForCode(code, limit),
        getLedgerStats(code),
      ]);
      return res.status(200).json({ entries, stats });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/** Same as above but uses `?code=` for diamond codes that contain `/` etc. */
router.get(
  "/inventory/diamonds-ledger/by-code",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const code = asTrimmedString(req.query.code);
    if (!code) return res.status(400).json({ error: "code query param is required" });
    try {
      const limit = asNumber(req.query.limit) ?? 200;
      const [entries, stats] = await Promise.all([
        listLedgerForCode(code, limit),
        getLedgerStats(code),
      ]);
      return res.status(200).json({ entries, stats });
    } catch {
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
