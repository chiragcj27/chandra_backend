import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { WhatIfScenario } from "../models/whatIfScenario";
import { simulateWhatIf, type WhatIfChanges } from "../services/production/whatIfService";
import { PRIORITY_LEVELS } from "../types";

const router = Router();

function asNumber(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim()) {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asTrimmedString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t.length ? t : undefined;
}

function normalizeChanges(raw: unknown): WhatIfChanges {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const changes: WhatIfChanges = {};

  if (obj.addCellsByStage && typeof obj.addCellsByStage === "object") {
    const map: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.addCellsByStage as Record<string, unknown>)) {
      const n = asNumber(v);
      if (n != null && n > 0) map[k.toUpperCase()] = n;
    }
    if (Object.keys(map).length > 0) changes.addCellsByStage = map;
  }

  const ot = asNumber(obj.overtimeHoursPerDay);
  if (ot != null && ot > 0) changes.overtimeHoursPerDay = ot;

  if (Array.isArray(obj.newOrders)) {
    changes.newOrders = (obj.newOrders as unknown[])
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({
        totalQty: asNumber(o.totalQty) ?? 0,
        totalStones: asNumber(o.totalStones),
        totalGrams: asNumber(o.totalGrams),
        expectedDeliveryAt:
          typeof o.expectedDeliveryAt === "string" ? new Date(o.expectedDeliveryAt) : undefined,
      }))
      .filter((o) => o.totalQty > 0);
  }

  if (Array.isArray(obj.reprioritize)) {
    changes.reprioritize = (obj.reprioritize as unknown[])
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({
        gatiPieceCode: asTrimmedString(o.gatiPieceCode) ?? "",
        newPriority:
          typeof o.newPriority === "string" &&
          (PRIORITY_LEVELS as readonly string[]).includes(o.newPriority)
            ? (o.newPriority as (typeof PRIORITY_LEVELS)[number])
            : "normal",
      }))
      .filter((o) => o.gatiPieceCode.length > 0);
  }

  return changes;
}

router.post("/what-if/simulate", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as { changes?: unknown };
  const changes = normalizeChanges(body.changes ?? req.body);

  try {
    const result = await simulateWhatIf(changes);
    return res.status(200).json({ result, changes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

router.get("/what-if/scenarios", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const items = await WhatIfScenario.find().sort({ createdAt: -1 }).limit(100);
    return res.status(200).json({ items });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/what-if/scenarios", requireAuth, requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = asTrimmedString(body.name);
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const createdBy =
      req.user?.id && Types.ObjectId.isValid(req.user.id)
        ? new Types.ObjectId(req.user.id)
        : undefined;
    const scenario = await WhatIfScenario.create({
      name,
      description: asTrimmedString(body.description),
      inputs: (body.inputs as Record<string, unknown>) ?? {},
      outputs: (body.outputs as Record<string, unknown>) ?? undefined,
      createdBy,
    });
    return res.status(201).json({ scenario });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/what-if/scenarios/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await WhatIfScenario.deleteOne({ _id: id });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
