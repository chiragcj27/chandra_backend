import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { Alert } from "../models/alert";
import {
  acknowledgeAlert,
  resolveAlert,
  runAlertRules,
} from "../services/production/alertEngine";
import {
  ALERT_SEVERITIES,
  ALERT_SUBJECT_TYPES,
  ALERT_TYPES,
} from "../types";

const router = Router();

function asEnum<T extends readonly string[]>(x: unknown, enumArr: T): T[number] | undefined {
  if (typeof x !== "string") return undefined;
  return (enumArr as readonly string[]).includes(x) ? (x as T[number]) : undefined;
}

router.get("/alerts", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};

    const severity = asEnum(req.query.severity, ALERT_SEVERITIES);
    const type = asEnum(req.query.type, ALERT_TYPES);
    const subjectType = asEnum(req.query.subjectType, ALERT_SUBJECT_TYPES);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    if (severity) filter.severity = severity;
    if (type) filter.type = type;
    if (subjectType) filter.subjectType = subjectType;
    if (status === "open") filter.resolvedAt = { $exists: false };
    else if (status === "resolved") filter.resolvedAt = { $exists: true };
    else if (status === "acknowledged") {
      filter.acknowledgedAt = { $exists: true };
      filter.resolvedAt = { $exists: false };
    }

    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 1000);
    const skip = Math.max(Number(req.query.skip ?? 0), 0);

    const [items, total] = await Promise.all([
      Alert.find(filter)
        .sort({ severity: 1, raisedAt: -1 }) // critical first then by recency
        .skip(skip)
        .limit(limit),
      Alert.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, limit, skip });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/alerts/:id/acknowledge", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const ok = await acknowledgeAlert(id, req.user?.id);
    if (!ok) return res.status(404).json({ error: "Alert not found or already acknowledged" });
    const alert = await Alert.findById(id);
    return res.status(200).json({ alert });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/alerts/:id/resolve", requireAuth, requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const ok = await resolveAlert(id, req.user?.id);
    if (!ok) return res.status(404).json({ error: "Alert not found or already resolved" });
    const alert = await Alert.findById(id);
    return res.status(200).json({ alert });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * Manually trigger the alert engine. Useful for ops / debugging and as the
 * "Run scan" button on the Alerts page. Returns the scan summary.
 */
router.post("/alerts/run", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const summary = await runAlertRules();
    return res.status(200).json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

export default router;
