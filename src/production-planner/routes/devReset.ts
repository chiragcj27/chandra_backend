import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { GatiColumnMap } from "../models/gatiColumnMap";
import { GatiImportRun } from "../models/gatiImportRun";
import { JobCard } from "../models/jobCard";
import { StageMovement } from "../models/stageMovement";

const router = Router();

/**
 * POST /dev/reset-all
 *
 * Developer-only endpoint. Wipes all production import data:
 *   StageMovements, JobCards, GatiImportRuns, GatiColumnMaps.
 *
 * Keeps: StageDefinitions, Diamond master records.
 *
 * Use before re-importing a fresh set of Order + WIP files during development.
 */
router.post(
  "/dev/reset-all",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    try {
      const [movements, jobCards, importRuns, columnMaps] = await Promise.all([
        StageMovement.deleteMany({}),
        JobCard.deleteMany({}),
        GatiImportRun.deleteMany({}),
        GatiColumnMap.deleteMany({}),
      ]);
      res.json({
        ok: true,
        deleted: {
          stageMovements: movements.deletedCount,
          jobCards: jobCards.deletedCount,
          importRuns: importRuns.deletedCount,
          columnMaps: columnMaps.deletedCount,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
);

export default router;
