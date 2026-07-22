const { Router } = require('express');

const { requireAuth, requireRole } = require('../../../middleware/requireAuth');
const { buildSchedule } = require('../services/scheduleService');
const { JobCard }       = require('../../models/jobCard');
const { StageDefinition } = require('../../models/stageDefinition');

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
      const days      = asPositiveInt(req.query.days, 14);
      const startDate = asNonEmptyString(req.query.startDate); // YYYY-MM-DD, optional
      const result    = await buildSchedule({ days, startDate });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);



router.get('/schedule/Analytics', ifAuth, ifAdmin, async (req, res) => {
  try{
    const days = asPositiveInt(req.query.days, 14);
    const result = await buildSchedule({ days });
    return res.status(200).json({ bottlenecks: result.bottlenecks.length, lateOrders: result.lateOrders.length, startToday: result.startToday.length, totalPieces: result.pieces.length });
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /schedule/live-stages
 * Returns ACTUAL current stage distribution from live JobCard data.
 * This matches exactly what the tracking screen shows.
 *
 * Returns:
 *   {
 *     stages: [
 *       {
 *         stageCode: "FILING",
 *         stageName: "Filing",
 *         pieceCount: 12,
 *         pieces: [{ gatiPieceCode, priority, cellCode, qty }]
 *       }, ...
 *     ],
 *     totalPieces: 34,
 *     asOf: "2026-06-06"
 *   }
 */
router.get(
  '/schedule/live-stages',
  ifAuth,
  ifAdmin,
  async (_req, res) => {
    try {
      // Load all open JobCards with their current stage distribution
      const [jobCards, stageDefs] = await Promise.all([
        JobCard.find({
          status: { $in: ['pending', 'in_progress', 'on_hold'] },
          'currentStageDistribution.0': { $exists: true }, // has at least one stage entry
        }).lean(),
        StageDefinition.find({ active: true }).lean(),
      ]);

      // Build stageCode → name map
      const stageNames = {};
      for (const s of stageDefs) stageNames[s.code] = s.name;

      // Group pieces by their current stage
      const stageMap = {};

      for (const card of jobCards) {
        for (const dist of (card.currentStageDistribution || [])) {
          const code = dist.stageCode;
          if (!stageMap[code]) {
            stageMap[code] = {
              stageCode: code,
              stageName: stageNames[code] || code,
              pieceCount: 0,
              pieces: [],
            };
          }
          stageMap[code].pieceCount += 1;
          stageMap[code].pieces.push({
            gatiPieceCode: card.gatiPieceCode,
            priority:      card.priority || 'normal',
            cellCode:      dist.cellCode || null,
            qty:           dist.qty      || 1,
          });
        }
      }

      // Sort stages by displayOrder
      const stageOrder = {};
      stageDefs.forEach((s, i) => { stageOrder[s.code] = s.displayOrder ?? i; });

      const stages = Object.values(stageMap).sort(
        (a, b) => (stageOrder[a.stageCode] ?? 999) - (stageOrder[b.stageCode] ?? 999)
      );

      const today = new Date();
      const asOf  = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      return res.status(200).json({
        stages,
        totalPieces: jobCards.length,
        asOf,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error';
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /schedule/today
 * Returns pending orders that should start on the given date, grouped by order.
 *
 * Query:
 *   date - YYYY-MM-DD (default: today)
 *
 * Returns:
 *   { startToday: [{ orderNumber, qty, itemCategory, priority }], stageLoad: [...] }
 */
router.get(
  '/schedule/today',
  ifAuth,
  ifAdmin,
  async (req, res) => {
    try {
      const todayStr  = new Date().toISOString().split('T')[0];
      const date      = asNonEmptyString(req.query.date) || todayStr;

      // Ensure the schedule window reaches the requested date.
      // e.g. if today=Jun 8 and date=Jun 25, we need at least 18 days.
      const msOffset   = new Date(date + 'T00:00:00') - new Date(todayStr + 'T00:00:00');
      const daysOffset = Math.max(0, Math.ceil(msOffset / 86_400_000));
      const days       = Math.max(14, daysOffset + 1);

      const result = await buildSchedule({ days, targetDate: date });
      return res.status(200).json({ startToday: result.startToday, stageLoad: result.stageLoad });
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
