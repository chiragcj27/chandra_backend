import { Router } from "express";

import devResetRouter from "./routes/devReset";
import alertsRouter from "./routes/alerts";
import allocationsRouter from "./routes/allocations";
import anomaliesRouter from "./routes/anomalies";
import calendarRouter from "./routes/calendar";
import columnMapsRouter from "./routes/columnMaps";
import dashboardsRouter from "./routes/dashboards";
import diamondsRouter from "./routes/diamonds";
import importRunsRouter from "./routes/importRuns";
import importsOrdersRouter from "./routes/importsOrders";
import importsWipRouter from "./routes/importsWip";
import inventoryLedgerRouter from "./routes/inventoryLedger";
import jobCardsRouter from "./routes/jobCards";
import materialLossRouter from "./routes/materialLoss";
import metalLedgerRouter from "./routes/metalLedger";
import movementsRouter from "./routes/movements";
import planningRouter from "./routes/planning";
import purchaseOrdersRouter from "./routes/purchaseOrders";
import requirementsRouter from "./routes/requirements";
import stagesRouter from "./routes/stages";
import schedulingRouter from "./scheduling";
import whatIfRouter from "./routes/whatIf";
import { seedDefaultStages } from "./services/bootstrap/seedDefaultData";
import { seedDefaultColumnMaps } from "./services/bootstrap/seedDefaultColumnMaps";
import { refreshAllETAs } from "./services/production/etaService";

/**
 * Production Planner module router.
 *
 * Mounted at `/admin/production` from `routes/admin/index.ts`.
 * All routes are admin-only (each sub-router applies requireAuth + requireRole("admin")).
 *
 * Phase 0: configuration CRUD (stages, calendar, column-maps).
 * Phase 1: Order Excel import, JobCard read APIs, Diamond admin CRUD.
 * Phase 2: WIP Excel import, StageMovements, order-grouped tracking dashboards, alert engine.
 * Phase 3: capacity baselines, planning calculator, bottleneck detection, what-if simulator.
 * Phase 4: diamond inventory (ledger, allocations, requirements vs stock),
 *          metal ledger, material-loss accounting, auto-PO drafting.
 * Phase 5: anomaly detection (baseline drift, stale stages, loss spikes) +
 *          analytics dashboard (on-time %, cycle-time trends, KPIs).
 */
const router = Router();

// Seed stages + column maps on startup (idempotent — safe to run every restart).
// Column map seed adds any new rawColumn variants (e.g. Wax, Cam) to the existing DB map.
seedDefaultStages()
  .then(() => seedDefaultColumnMaps())
  .then(() =>
    refreshAllETAs().catch((e) =>
      console.error("[ProductionPlanner] startup ETA refresh error:", (e as Error).message)
    )
  )
  .catch((err) =>
    console.error("[ProductionPlanner] Startup seed error:", (err as Error).message)
  );

// Phase 0
router.use(stagesRouter);
router.use(calendarRouter);
router.use(columnMapsRouter);

// Phase 1
router.use(importsOrdersRouter);
router.use(importRunsRouter);
router.use(jobCardsRouter);
router.use(diamondsRouter);

// Phase 2
router.use(importsWipRouter);
router.use(movementsRouter);
router.use(dashboardsRouter);
router.use(alertsRouter);

// Phase 3
router.use(planningRouter);
router.use(whatIfRouter);

// Phase 4
router.use(inventoryLedgerRouter);
router.use(allocationsRouter);
router.use(requirementsRouter);
router.use(metalLedgerRouter);
router.use(materialLossRouter);
router.use(purchaseOrdersRouter);

// Phase 5
router.use(anomaliesRouter);

// Phase 6 — Production scheduler
router.use(schedulingRouter);

// Dev utilities (reset all imported data — keep stages & diamond masters)
router.use(devResetRouter);

export default router;
