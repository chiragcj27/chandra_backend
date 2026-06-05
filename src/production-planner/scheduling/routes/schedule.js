const { Router } = require('express');

const { requireAuth, requireRole } = require('../../../middleware/requireAuth');
const { buildSchedule } = require('../services/scheduleService');

const router = Router();

// ---------------------------------------------------------------------------
// Dev bypass: pass ?test=1 to skip auth during development.
// Remove these two helpers before production deployment.
// ---------------------------------------------------------------------------
function ifAuth(req, res, next) {
  if (req.query.test === '1') return next();
  return requireAuth(req, res, next);
}
function ifAdmin(req, res, next) {
  if (req.query.test === '1') return next();
  return requireRole('admin')(req, res, next);
}

// ---------------------------------------------------------------------------
// Helper: parse a query param as a positive integer, returning a fallback.
// ---------------------------------------------------------------------------
function asPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Helper: parse a query param as a non-empty trimmed string.
// ---------------------------------------------------------------------------
function asNonEmptyString(value) {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * GET /schedule
 * Full production schedule for the next N days.
 *
 * Query params:
 *   days  - number of days to schedule (default 14)
 *
 * Returns:
 *   { grid[], pieces[], bottlenecks[], lateOrders[], startToday[] }
 */
router.get(
  '/schedule',
  ifAuth,
  ifAdmin,
  async (req, res) => {
    try {
      const days = asPositiveInt(req.query.days, 14);
      const result = await buildSchedule({ days });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);



router.get('/Analytics', ifAuth, ifAdmin, async (req, res) => {
  try{
    const days = asPositiveInt(req.query.days, 14);
    const result = await buildSchedule({ days });
    return res.status(200).json({ bottlenecks: result.bottlenecks.length, lateOrders: result.lateOrders.length, startToday: result.startToday.length ,totalPieces: result.pieces.length });
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /schedule/today
 * Returns only the "start today" pull list — the pieces that need to begin
 * their next stage right now. This is what the floor supervisor sees.
 *
 * Returns:
 *   { startToday: [{ gatiPieceCode, priority, slackDays }] }
 */
router.get(
  '/schedule/today',
  ifAuth,
  ifAdmin,
  async (_req, res) => {
    try {
      const result = await buildSchedule();
      return res.status(200).json({ startToday: result.startToday });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /schedule/by-piece
 * Itinerary for a single piece (query param because gatiPieceCode contains slashes).
 *
 * Query params:
 *   code  - the gatiPieceCode to look up (e.g. "ORD001/1")
 *
 * Returns:
 *   { piece: { gatiPieceCode, priority, shipBy, slackDays, planned[], willShipBy, slipDays } }
 */
router.get(
  '/schedule/by-piece',
  ifAuth,
  ifAdmin,
  async (req, res) => {
    try {
      const code = asNonEmptyString(req.query.code);
      if (!code) {
        return res.status(400).json({ error: 'code query param is required' });
      }

      const result = await buildSchedule();
      const piece = result.pieces.find((p) => p.gatiPieceCode === code);

      if (!piece) {
        return res.status(404).json({ error: 'Piece not found in schedule' });
      }

      return res.status(200).json({ piece });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /schedule/by-stage/:stageCode
 * Day-by-day load breakdown for one stage.
 *
 * Route params:
 *   stageCode  - e.g. "FILING", "SETTING", "QC"
 *
 * Query params:
 *   days       - number of days (default 14)
 *
 * Returns:
 *   { stageCode, days: [{ day, stageLoad: { byCell, workerHoursUsed, workerHoursAvailable } | null }] }
 */
router.get(
  '/schedule/by-stage/:stageCode',
  ifAuth,
  ifAdmin,
  async (req, res) => {
    try {
      const stageCode = String(req.params.stageCode).toUpperCase();
      const days = asPositiveInt(req.query.days, 14);

      const result = await buildSchedule({ days });

      // Pull out the relevant stage data from each grid day.
      const stageDays = result.grid.map((day) => ({
        day: day.day,
        stageLoad: day.byStage[stageCode] || null,
      }));

      return res.status(200).json({ stageCode, days: stageDays });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /schedule/preview
 * Run the scheduler with hypothetical overrides — no DB side effects.
 *
 * Body (all optional):
 *   addWorkersByCell   - { [cellCode]: number }  — extra workers to add per cell
 *   overtimeHoursPerDay - number                  — extra hours per day
 *
 * Returns the same full result as GET /schedule.
 */
router.post(
  '/schedule/preview',
  ifAuth,
  ifAdmin,
  async (req, res) => {
    try {
      const body = req.body || {};
      const overrides = {};

      if (body.addWorkersByCell && typeof body.addWorkersByCell === 'object') {
        overrides.addWorkersByCell = body.addWorkersByCell;
      }
      if (Number.isFinite(body.overtimeHoursPerDay)) {
        overrides.overtimeHoursPerDay = Number(body.overtimeHoursPerDay);
      }

      const result = await buildSchedule({ overrides });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);

module.exports = router;
