import { Router } from "express";

import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { detectAnomalies } from "../services/production/anomalyDetector";

const router = Router();

/**
 * POST /anomalies/detect — manually run the anomaly detector and return its
 * candidates WITHOUT persisting them. Useful for previewing what the engine
 * would raise on the next scan.
 *
 * Note: the regular alert engine (`POST /alerts/run`) already calls the
 * anomaly detector and persists results. This endpoint is a no-side-effect
 * preview.
 */
router.post("/anomalies/detect", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const summary = await detectAnomalies();
    return res.status(200).json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return res.status(500).json({ error: message });
  }
});

export default router;
