/**
 * Production Scheduler — core algorithm
 * ======================================
 *
 * Three-pass scheduler that produces a concrete day-by-day schedule given:
 *   - Open JobCards (status: pending / in_progress / on_hold)
 *   - Per-stage unitsPerWorkerHour (admin-configurable on StageDefinition)
 *   - Per-cell workersCount (admin-configurable on Cell)
 *   - Daily working hours from ProductionCalendar
 *
 * Pass 1 — Build remaining-work per piece
 * Pass 2 — Backward schedule to find latest-start dates (no contention)
 * Pass 3 — Forward fill under finite per-cell worker-hour budgets (greedy EDD)
 *
 * Output is read-only — no DB writes.
 */

const { JobCard } = require('../../models/jobCard');
const { StageDefinition } = require('../../models/stageDefinition');
const { Cell } = require('../../models/cell');
const { ProductionCalendar } = require('../../models/productionCalendar');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of days to schedule if not specified. */
const DEFAULT_WINDOW_DAYS = 14;

/** Default daily working hours when no calendar is configured. */
const DEFAULT_DAILY_HOURS = 9;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the work units a piece contributes at a given stage.
 *
 * @param {Object} piece - JobCard document
 * @param {Object} stage - StageDefinition document
 * @returns {number} units of work (grams / stones / pieces)
 */
function workUnitsFor(piece, stage) {
  switch (stage.unitOfWork) {
    case 'grams':
      return piece.totalMetalWeight || 0;
    case 'stones':
      return piece.totalStones || 0;
    case 'piece':
    default:
      return piece.totalQty || 1;
  }
}

/**
 * Worker-hours needed for this piece at this stage.
 *
 * @param {number} units - work units from workUnitsFor()
 * @param {Object} stage - StageDefinition document
 * @returns {number} worker-hours required
 */
function workerHoursNeeded(units, stage) {
  if (!stage.unitsPerWorkerHour || stage.unitsPerWorkerHour <= 0) {
    // Rate not configured — return 0 so the scheduler flags this.
    return 0;
  }
  return units / stage.unitsPerWorkerHour;
}

/**
 * Return today's date as YYYY-MM-DD (local time).
 * @returns {string}
 */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Validate and normalise a YYYY-MM-DD string.
 * Returns the string as-is if valid, otherwise returns todayISO().
 * @param {string|undefined} dateStr
 * @returns {string}
 */
function resolveStartDate(dateStr) {
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  return todayISO();
}

/**
 * Add N days to a YYYY-MM-DD string and return a new YYYY-MM-DD string.
 * @param {string} dateISO
 * @param {number} offsetDays
 * @returns {string}
 */
function addDays(dateISO, offsetDays) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Pass 1 — Build remaining work for every open piece
// ---------------------------------------------------------------------------

/**
 * For each open JobCard, determine the remaining stages from its current
 * position onward, and compute the worker-hours needed at each stage.
 *
 * @param {Array<Object>} pieces - JobCard documents
 * @param {Array<Object>} stages - StageDefinition documents (sorted by displayOrder)
 * @returns {Array<Object>} enriched pieces with .remainingWork[]
 */
function buildRemainingWork(pieces, stages) {
  // Build a code → stage lookup for quick access.
  const stageMap = {};
  for (const s of stages) stageMap[s.code] = s;

  // Build an ordered list of mandatory stage codes (skip optional ones).
  const orderedStageCodes = stages
    .filter((s) => !s.isOptional)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => s.code);

  for (const piece of pieces) {
    // Determine which stages the piece is already past.
    // currentStageDistribution tells us where the piece currently sits.
    const currentStages = new Set(
      (piece.currentStageDistribution || []).map((d) => d.stageCode)
    );

    // Find the earliest remaining stage (first mandatory stage not yet done).
    const startIdx = orderedStageCodes.findIndex(
      (code) => !currentStages.has(code)
    );
    const remainingCodes =
      startIdx >= 0 ? orderedStageCodes.slice(startIdx) : [];

    piece.remainingWork = [];
    for (const code of remainingCodes) {
      const stage = stageMap[code];
      if (!stage) continue; // skip if stage definition missing

      const units = workUnitsFor(piece, stage);
      const wh = workerHoursNeeded(units, stage);

      piece.remainingWork.push({
        stageCode: code,
        stage,
        units,
        workerHoursNeeded: wh,
      });
    }
  }

  return pieces;
}




// ---------------------------------------------------------------------------
// Pass 2 — Backward schedule (latest-start per piece, no contention)
// ---------------------------------------------------------------------------

/**
 * Walk backward from each piece's expectedDeliveryAt to find:
 *   - latestStart per stage (assuming best-case capacity)
 *   - slackDays = latestStart(firstRemainingStage) - today
 *
 * Pieces with slackDays < 0 are flagged as structurally late.
 *
 * @param {Array<Object>} pieces - enriched with .remainingWork[]
 * @param {Object} cellsByStage - { [stageCode]: [{ code, workersCount }] }
 * @param {number} dailyHours - working hours per day
 * @returns {Array<Object>} pieces with .latestStart, .latestEnd, .slackDays
 */
function backwardSchedule(pieces, cellsByStage, dailyHours, windowStart) {
  const today = windowStart || todayISO();

  for (const piece of pieces) {
    const remaining = piece.remainingWork;
    if (remaining.length === 0) {
      piece.slackDays = Infinity;
      continue;
    }

    // Start from the ship-by date.
    let cursor = piece.expectedDeliveryAt
      ? new Date(piece.expectedDeliveryAt)
      : new Date();

    // Walk backward through remaining stages.
    for (let i = remaining.length - 1; i >= 0; i--) {
      const rw = remaining[i];
      const stageCode = rw.stageCode;

      // Sum worker-hours across all cells that run this stage.
      const cells = cellsByStage[stageCode] || [];
      const totalWorkerHoursPerDay = cells.reduce(
        (sum, cell) => sum + (cell.workersCount || 1) * dailyHours,
        0
      );

      const daysNeeded =
        totalWorkerHoursPerDay > 0
          ? Math.ceil(rw.workerHoursNeeded / totalWorkerHoursPerDay)
          : 1;

      // latestEnd is the cursor (ship-by for terminal stage, or next stage's
      // latestStart for earlier stages).
      rw.latestEnd = cursor;

      // Move cursor backward by the days this stage occupies.
      const d = new Date(cursor);
      d.setDate(d.getDate() - daysNeeded);
      rw.latestStart = d;
      cursor = d;
    }

    // slackDays = how many days of buffer exist before the first stage must start.
    const firstStart = remaining[0].latestStart;
    piece.slackDays = firstStart
      ? Math.floor((firstStart.getTime() - new Date(today).getTime()) / 86_400_000)
      : 0;
  }

  return pieces;
}

// ---------------------------------------------------------------------------
// Pass 3 — Forward fill under finite capacity (greedy EDD)
// ---------------------------------------------------------------------------

/**
 * Sort pieces by (priority, slackDays, shipBy) and greedily fit them into
 * per-cell worker-hour budgets day-by-day.
 *
 * @param {Array<Object>} pieces - enriched with .remainingWork, .slackDays
 * @param {number} windowDays - scheduling horizon
 * @param {Object} cellsByStage - { [stageCode]: [{ code, workersCount }] }
 * @param {number} dailyHours - working hours per day
 * @returns {Object} { grid, plan }
 */
function forwardFill(pieces, windowDays, cellsByStage, dailyHours, windowStart) {
  const today = windowStart || todayISO();

  // Priority sort key: map priority to number (critical=0, urgent=1, normal=2).
  const priorityWeight = { critical: 0, urgent: 1, normal: 2 };

  // Sort pieces by (priority, slackDays ASC, shipBy ASC).
  const sorted = [...pieces].sort((a, b) => {
    const pa = priorityWeight[a.priority] ?? 2;
    const pb = priorityWeight[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    if (a.slackDays !== b.slackDays) return a.slackDays - b.slackDays;
    const sa = a.expectedDeliveryAt ? new Date(a.expectedDeliveryAt).getTime() : 0;
    const sb = b.expectedDeliveryAt ? new Date(b.expectedDeliveryAt).getTime() : 0;
    return sa - sb;
  });

  // Initialise remaining worker-hour budget per cell per day.
  // remainingWH[dateISO][cellCode] = workersCount × dailyHours
  const remainingWH = {};
  for (let d = 0; d < windowDays; d++) {
    const dateKey = addDays(today, d);
    remainingWH[dateKey] = {};
    for (const stageCode of Object.keys(cellsByStage)) {
      for (const cell of cellsByStage[stageCode]) {
        remainingWH[dateKey][cell.code] =
          (cell.workersCount || 1) * dailyHours;
      }
    }
  }

  // plan[pieceCode] = [{ day, stage, cell, workerHours }, ...]
  const plan = {};
  const grid = [];

  for (const piece of sorted) {
    const code = piece.gatiPieceCode;
    plan[code] = [];
    let earliestDay = 0;

    for (const rw of piece.remainingWork) {
      const stageCode = rw.stageCode;
      const cells = cellsByStage[stageCode] || [];
      if (cells.length === 0) continue; // no cells for this stage — skip

      let need = rw.workerHoursNeeded;
      if (need <= 0) continue; // rate not configured — skip

      let placed = false;

      // Try to fit this stage starting from earliestDay, checking each cell.
      for (let startDay = earliestDay; startDay < windowDays && !placed; startDay++) {
        for (const cell of cells) {
          const span = []; // { day, workerHours } entries for this piece+stage+cell
          let remainingNeed = need;

          for (let d = startDay; d < windowDays && remainingNeed > 0; d++) {
            const dateKey = addDays(today, d);
            const budget = remainingWH[dateKey];
            if (!budget) break;

            const avail = budget[cell.code] || 0;
            if (avail > 0) {
              const take = Math.min(avail, remainingNeed);
              span.push({ day: dateKey, workerHours: take });
              remainingNeed -= take;
            }
          }

            if (remainingNeed <= 0) {
            // Successfully placed — consume budgets and record plan entries.
            for (const entry of span) {
              plan[code].push({
                day: entry.day,
                stage: stageCode,
                cell: cell.code,
                workerHours: entry.workerHours,
              });
              const budget = remainingWH[entry.day];
              if (budget) {
                budget[cell.code] = (budget[cell.code] || 0) - entry.workerHours;
              }
            }
            // Next stage can't start before the day after this stage's last allocated day
            if (span.length > 0) {
              const lastDayIdx = Math.floor(
                (new Date(span[span.length - 1].day + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000
              );
              earliestDay = lastDayIdx + 1;
            } else {
              earliestDay = startDay + 1;
            }
            placed = true;
            break;
          }
        }
      }

      // If not placed, flag it — the piece won't fit in the window.
      if (!placed) {
        plan[code].push({
          day: addDays(today, windowDays - 1),
          stage: stageCode,
          cell: 'UNSCHEDULED',
          workerHours: need,
        });
      }
    }
  }

  // Build per-day grid from plan + remainingWH.
  for (let d = 0; d < windowDays; d++) {
    const dateKey = addDays(today, d);
    const byStage = {};

    for (const pieceCode of Object.keys(plan)) {
      for (const entry of plan[pieceCode]) {
        if (entry.day !== dateKey) continue;
        const stageCode = entry.stage;
        if (!byStage[stageCode]) {
          byStage[stageCode] = { byCell: {}, workerHoursUsed: 0, workerHoursAvailable: 0 };
        }
        if (!byStage[stageCode].byCell[entry.cell]) {
          byStage[stageCode].byCell[entry.cell] = [];
        }
        byStage[stageCode].byCell[entry.cell].push({
          pieceCode,
          workerHours: entry.workerHours,
        });
        byStage[stageCode].workerHoursUsed += entry.workerHours;
      }
    }

    // Compute available hours per stage for this day.
    for (const stageCode of Object.keys(cellsByStage)) {
      if (!byStage[stageCode]) {
        byStage[stageCode] = { byCell: {}, workerHoursUsed: 0, workerHoursAvailable: 0 };
      }
      let totalAvail = 0;
      for (const cell of cellsByStage[stageCode]) {
        const budget = remainingWH[dateKey];
        const used = byStage[stageCode].byCell[cell.code]
          ? byStage[stageCode].byCell[cell.code].reduce((s, e) => s + e.workerHours, 0)
          : 0;
        const cellAvail = budget ? (budget[cell.code] || 0) + used : 0;
        totalAvail += cellAvail;
      }
      byStage[stageCode].workerHoursAvailable = totalAvail;
    }

    grid.push({
      day: dateKey,
      byStage,
      workerHoursUsed: Object.values(byStage).reduce((s, st) => s + st.workerHoursUsed, 0),
      workerHoursAvailable: Object.values(byStage).reduce((s, st) => s + st.workerHoursAvailable, 0),
    });
  }

  return { grid, plan };
}

// ---------------------------------------------------------------------------
// Pass 4 — Roll up outputs
// ---------------------------------------------------------------------------

/**
 * From the plan and grid, build the final output structure.
 *
 * @param {Array<Object>} pieces
 * @param {Object} plan - { [pieceCode]: [{ day, stage, cell, workerHours }] }
 * @param {Array<Object>} grid
 * @param {number} windowDays
 * @returns {Object} { grid, pieces, bottlenecks, lateOrders, startToday }
 */
function rollupOutputs(pieces, plan, grid, windowDays, windowStart, targetDate) {
  const today = windowStart || todayISO();
  const filterDate = targetDate || today;

  // Per-piece itineraries.
  const pieceResults = pieces.map((piece) => {
    const planned = plan[piece.gatiPieceCode] || [];
    const lastEntry = planned.length > 0 ? planned[planned.length - 1] : null;
    const willShipBy = lastEntry ? new Date(lastEntry.day + 'T00:00:00') : undefined;
    const shipBy = piece.expectedDeliveryAt ? new Date(piece.expectedDeliveryAt) : undefined;
    const slipDays =
      shipBy && willShipBy
        ? Math.max(0, Math.floor((willShipBy.getTime() - shipBy.getTime()) / 86_400_000))
        : 0;

    return {
      gatiPieceCode: piece.gatiPieceCode,
      orderNumber: piece.orderNumber,
      totalQty: piece.totalQty,
      itemCategory: piece.itemCategory,
      status: piece.status,
      currentStageDistribution: piece.currentStageDistribution || [],
      priority: piece.priority,
      shipBy: piece.expectedDeliveryAt,
      slackDays: piece.slackDays,
      planned,
      willShipBy,
      slipDays,
    };
  });

  // Bottlenecks: stages where utilisation >= 95% on at least 3 days.
  const stageUtilisation = {};
  for (const day of grid) {
    for (const [stageCode, stageData] of Object.entries(day.byStage)) {
      if (!stageUtilisation[stageCode]) stageUtilisation[stageCode] = [];
      const pct =
        stageData.workerHoursAvailable > 0
          ? stageData.workerHoursUsed / stageData.workerHoursAvailable
          : 0;
      stageUtilisation[stageCode].push(pct);
    }
  }

  const bottlenecks = [];
  for (const [stageCode, utilPcts] of Object.entries(stageUtilisation)) {
    const saturatedDays = utilPcts.filter((p) => p >= 0.95).length;
    if (saturatedDays >= 3) {
      bottlenecks.push({ stage: stageCode, saturatedDays });
    }
  }

  // Late orders: pieces whose final stage ends after ship-by.
  const lateOrders = pieceResults
    .filter((p) => p.slipDays > 0)
    .map((p) => ({
      gatiPieceCode: p.gatiPieceCode,
      shipBy: p.shipBy,
      willShipBy: p.willShipBy,
      slipDays: p.slipDays,
    }));

  // Pieces with work scheduled on filterDate — grouped by order + category.
  // Includes all statuses (pending, in_progress, on_hold) so the floor supervisor
  // sees every item that needs attention on the selected date.
  const startToday = Object.values(
    pieceResults
      .filter((p) => p.planned.some((e) => e.day === filterDate))
      .reduce((acc, p) => {
        const key = `${p.orderNumber}|${p.itemCategory || 'Unknown'}`;
        if (!acc[key]) {
          acc[key] = {
            orderNumber: p.orderNumber,
            itemCategory: p.itemCategory || null,
            qty: 0,
            priority: p.priority,
          };
        }
        acc[key].qty += p.totalQty || 0;
        return acc;
      }, {})
  ).sort((a, b) => {
    const pw = { critical: 0, urgent: 1, normal: 2 };
    return (pw[a.priority] ?? 2) - (pw[b.priority] ?? 2);
  });

  const stageLoad = Object.entries(grid.find((d) => d.day === filterDate)?.byStage || {}).map(([stage, data]) => ({
    stage,
    workerHoursUsed: data.workerHoursUsed,
    workerHoursAvailable: data.workerHoursAvailable,
    utilisation: data.workerHoursAvailable > 0
      ? Math.round((data.workerHoursUsed / data.workerHoursAvailable) * 10000) / 100
      : 0,
  }));

  return { grid, pieces: pieceResults, bottlenecks, lateOrders, startToday, stageLoad };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the production schedule.
 *
 * @param {Object} [options]
 * @param {number} [options.days]        - Scheduling horizon (default 14)
 * @param {string} [options.startDate]   - YYYY-MM-DD to start the window from (default today)
 * @param {string} [options.targetDate]  - YYYY-MM-DD to filter startToday / stageLoad for (default windowStart)
 * @param {Object} [options.overrides]
 * @param {Object<string,number>} [options.overrides.addWorkersByCell] - Extra workers per cell for what-if
 * @param {number} [options.overrides.overtimeHoursPerDay] - Extra hours per day for what-if
 * @returns {Promise<{ grid: Object[], pieces: Object[], bottlenecks: Object[], lateOrders: Object[], startToday: Object[] }>}
 */
async function buildSchedule(options = {}) {
  const windowDays  = options.days || DEFAULT_WINDOW_DAYS;
  const windowStart = resolveStartDate(options.startDate); // YYYY-MM-DD, defaults to today
  const overrides   = options.overrides || {};

  // -----------------------------------------------------------------------
  // 1. Load all reference data (fresh every run — all admin-editable).
  // -----------------------------------------------------------------------

  const [pieces, stages, calendar] = await Promise.all([
    // Open JobCards: pending, in_progress, or on_hold.
    JobCard.find({
      status: { $in: ['pending', 'in_progress', 'on_hold'] },
    }).lean(),

    // Active stage definitions with the new unitsPerWorkerHour field.
    StageDefinition.find({ active: true }).sort({ displayOrder: 1 }).lean(),

    // Production calendar for daily working hours.
    ProductionCalendar.findOne({ key: 'default' }).lean(),
  ]);

  const dailyHours =
    (calendar && calendar.defaultDailyHours) || DEFAULT_DAILY_HOURS;

  // Effective daily hours with overtime override.
  const effectiveDailyHours = dailyHours + (overrides.overtimeHoursPerDay || 0);

  // -----------------------------------------------------------------------
  // 2. Load cells per stage.
  //    Reuses the concept from capacityService.activeCellsForStage but
  //    returns the full cell documents (not just a count).
  // -----------------------------------------------------------------------

  const allCells = await Cell.find({ active: true }).lean();

  // Group cells by the stages they can run.
  const cellsByStage = {};
  for (const cell of allCells) {
    for (const stageCode of cell.stageCodes || []) {
      if (!cellsByStage[stageCode]) cellsByStage[stageCode] = [];
      // Apply workersCount override if provided.
      const workersOverride =
        overrides.addWorkersByCell && overrides.addWorkersByCell[cell.code];
      cellsByStage[stageCode].push({
        code: cell.code,
        workersCount:
          (cell.workersCount || 1) + (workersOverride || 0),
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3. Run the three passes.
  // -----------------------------------------------------------------------

  // Pass 1 — Build remaining work for each piece.
  buildRemainingWork(pieces, stages);

  // Pass 2 — Backward schedule to compute latest-start and slack.
  backwardSchedule(pieces, cellsByStage, effectiveDailyHours, windowStart);

  // Pass 3 — Forward fill under finite per-cell worker-hour budgets.
  const { grid, plan } = forwardFill(
    pieces,
    windowDays,
    cellsByStage,
    effectiveDailyHours,
    windowStart
  );

  // -----------------------------------------------------------------------
  // 4. Roll up into the final output format.
  // -----------------------------------------------------------------------

  return rollupOutputs(pieces, plan, grid, windowDays, windowStart, options.targetDate);
}

module.exports = { buildSchedule };
