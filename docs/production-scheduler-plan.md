# Plan — Production Scheduler (lives alongside the existing capacity planner)

## Context

Two distinct features that coexist:

- **Capacity planner (existing):** "Can we accept this hypothetical order? What's the lead time? Where's the bottleneck?" — purely a feasibility / forecast tool. Stays exactly as-is and keeps shipping its current endpoints (`/dashboards/capacity`, `/planning/check`, `/what-if/*`).
- **Production scheduler (new — this plan):** Given the actual open JobCards, their ship-by dates, and the finite per-cell capacity, produce a **concrete day-by-day schedule** for the next N days that answers:
  1. Which pieces to start TODAY (the pull list for the first stage)
  2. Day-by-day 2-week plan — which pieces should be at which stage / which cell, every day
  3. Where bottlenecks will form
  4. Which pieces can't make their ship date even under optimal scheduling

Both features are useful and complementary. The scheduler is its own subdirectory inside `production-planner/` for clean code separation, but it freely reuses capacity helpers (`getBaselineForStage`, `activeCellsForStage`) so we don't duplicate the cell-count / baseline lookup logic.

## Module layout (new subdirectory, both modules coexist)

```
src/production-planner/
  services/
    production/
      capacityService.ts         ← existing — UNCHANGED, exports reused
      planningService.ts         ← existing — UNCHANGED
      whatIfService.ts           ← existing — UNCHANGED
      ...
  routes/
    planning.ts                  ← existing — UNCHANGED
    whatIf.ts                    ← existing — UNCHANGED
    dashboards.ts                ← existing — UNCHANGED

  scheduling/                    ← NEW subdirectory
    services/
      scheduleService.ts         ← the algorithm (pure function, no DB writes)
    routes/
      schedule.ts                ← HTTP endpoints
    index.ts                     ← exports the router
```

**Existing-file changes:**
- `src/production-planner/index.ts` — two lines: `import schedulingRouter from "./scheduling"` + `router.use(schedulingRouter)`. Same pattern used for every other sub-router in this file.

No capacity-planner file is modified; the scheduler just imports the read-only helpers it needs.

## Algorithm

Three passes.

### The input model (admin-configurable, all three numbers editable)

Capacity is built from three editable numbers, exactly as you described:

| Where | Field | Meaning | Example |
|---|---|---|---|
| `StageDefinition` (new field) | `unitsPerWorkerHour` | How much work one person does per hour at this stage. Unit follows `stage.unitOfWork` (the existing field — `grams`, `stones`, or `piece`). | Filing: 50 g/hour. Setting: 12 stones/hour. QC: 9 pieces/hour. |
| `Cell` (new field) | `workersCount` | How many people staff this cell. | C1: 2 workers. C2: 1 worker. C3: 1 worker. |
| `ProductionCalendar` (existing) | `defaultDailyHours` | Working hours per day (already exists, default 9, fully variable). | 8 |

All three are admin-editable through their respective Settings screens. Capacity is recomputed from them on every scheduler run — no caching.

### Derived numbers used by the scheduler

For one cell:

```
cellDailyWorkerHours(cell)            = cell.workersCount × dailyHours
cellDailyCapacityInUnits(cell, stage) = cellDailyWorkerHours(cell) × stage.unitsPerWorkerHour
```

With C1 (2 workers) at Filing (50 g/hr) on an 8h day:

```
cellDailyWorkerHours(C1)               = 2 × 8 = 16 worker-hours/day
cellDailyCapacityInUnits(C1, Filing)   = 16 × 50 = 800 g/day
```

For one piece at a stage:

```
workUnits(piece, stage) =
  piece.totalMetalWeight  if stage.unitOfWork == "grams"
  piece.totalStones        if stage.unitOfWork == "stones"
  piece.totalQty           if stage.unitOfWork == "piece"

workerHoursNeeded(piece, stage) = workUnits(piece, stage) / stage.unitsPerWorkerHour
```

A 300 g piece at Filing (50 g/hr) needs `300 / 50 = 6 worker-hours`. On C1 (16 worker-hours/day) that's just under half the day; the cell can take another ~10 worker-hours of work that same day.

### The time model used in the algorithm

Worker-hours per `(day, cell)` is the scheduler's currency.

- Each cell-day has a finite worker-hour budget — `cell.workersCount × dailyHours`.
- Each piece at each stage consumes `workerHoursNeeded(piece, stage)` of that budget.
- Pieces with long stages can span consecutive days at the same cell (e.g. a 200 g piece at Casting where Casting = 5 g/hr means 40 worker-hours; on a 2-worker × 8h = 16 worker-hour-per-day cell, it takes 2.5 days).

### Pass 1 — Build remaining-work per piece

For every open JobCard (`status ∈ {pending, in_progress, on_hold}`):

- Determine the piece's current position in the stage flow (from `currentStageDistribution` and `StageDefinition.displayOrder`).
- `remainingStages(piece)` = ordered list of non-optional stages from current onward (terminal stage included).
- For each remaining stage, compute `workerHoursNeeded(piece, stage)` using the input model above.

### Pass 2 — Backward schedule (latest-start per piece)

For each piece, walking backward from `expectedDeliveryAt`. The number of days each remaining stage occupies depends on **best-case capacity** (assuming all of that stage's cells could devote all their worker-hours to this one piece) — i.e. how fast it could finish if there was no contention:

```
totalWorkerHoursAtStage(stage) = sum over cells running stage of cell.workersCount × dailyHours
daysIfAlone(piece, stage)      = ceil(workerHoursNeeded(piece, stage) / totalWorkerHoursAtStage(stage))

latestEnd(terminalStage)       = shipBy
latestEnd(previousStage)       = latestEnd(nextStage) − daysIfAlone(piece, nextStage)
latestStart(stage)             = latestEnd(stage) − daysIfAlone(piece, stage)
slackDays(piece)               = latestStart(firstRemainingStage) − today
```

`slackDays < 0` → piece is structurally late before capacity is even considered. Flag.

### Pass 3 — Forward fill under finite capacity (greedy EDD, worker-hour budgeted)

**Inputs read fresh on every scheduler run** (everything's variable, all admin-editable):
- `stage.unitsPerWorkerHour` per stage (`StageDefinition`)
- `stage.unitOfWork` (existing) — picks which weight field on the JobCard counts as work
- `cell.workersCount` per cell (`Cell`)
- `dailyHours` from `ProductionCalendar.defaultDailyHours`
- `cellsForStage(stage)` — reuses `activeCellsForStage` from `capacityService.ts`

**Greedy schedule (worker-hour budgeted):**

```
Sort open pieces by:
  1. priority    (critical → urgent → normal)
  2. slackDays   (least slack first)
  3. shipBy      (earliest first)

remainingWH = Map<dateISO, Map<cellCode, number>>   // initialised per cell-day to (cell.workersCount × dailyHours)
plan        = Map<pieceCode, Array<{ day, stage, cell, workerHours }>>

for piece in sortedPieces:
  earliestPossibleDay = today
  for stage in remainingStages(piece):
    let workUnits   = workUnitsFor(piece, stage)             // grams / stones / pieces
    let whNeeded    = workUnits / stage.unitsPerWorkerHour    // worker-hours
    placed = false

    for startDay from earliestPossibleDay to today + windowDays:
      for cell in cellsForStage(stage):
        // Try to fit whNeeded at this cell starting at startDay,
        // spanning consecutive days if necessary.
        let need = whNeeded
        let dayCursor = startDay
        let span = []
        while need > 0 and dayCursor ≤ today + windowDays:
          avail = remainingWH[dayCursor][cell]
          if avail > 0:
            take = min(avail, need)
            span.push({ day: dayCursor, workerHours: take })
            need -= take
          dayCursor += 1
        if need == 0:
          for entry in span:
            plan[piece].push({ day: entry.day, stage, cell, workerHours: entry.workerHours })
            remainingWH[entry.day][cell] -= entry.workerHours
          earliestPossibleDay = lastDayOf(span) + 1
          placed = true
          break
      if placed: break
    if not placed:
      // window exhausted — flag slip from latest searched day,
      // continue scheduling remaining stages from there
```

**Worked through your example:**

- Filing config: `unitsPerWorkerHour = 50 g/hr`, `unitOfWork = grams`
- Cells: C1 (2 workers), C2 (1 worker), C3 (1 worker); all run Filing
- Calendar: `dailyHours = 8`
- Cell worker-hour budgets per day: C1 = 16, C2 = 8, C3 = 8 → 32 worker-hours/day across Filing
- Filing daily throughput in grams = 32 × 50 = **1600 g/day**
- A 300 g piece needs 6 worker-hours of Filing. On C1 alone it consumes 6 of 16 worker-hours and finishes that day.
- A 2000 g batch (40 worker-hours) overflows one day's Filing capacity; the scheduler spans it across days at the same cell, or distributes to other cells, whichever fits priority order first.

### Pass 4 — Roll up outputs

- **Per-day grid** — `[{ day, byStage: { [stageCode]: { byCell: { [cellCode]: [{ pieceCode, workerHours }, …] } } }, workerHoursUsed, workerHoursAvailable }, …]`
- **Per-piece itineraries** — `[{ gatiPieceCode, priority, shipBy, slackDays, planned: [{ day, stage, cell, workerHours }, …], willShipBy, slipDays }, …]`
- **Bottlenecks** — for each stage, count days where (worker-hours scheduled at that stage) ≥ 95 % of (`Σ cell.workersCount × dailyHours`). Stages saturated ≥ 3 days in the window are flagged.
- **Late orders** — pieces whose final-stage end-day > shipBy.
- **Start-today list** — pieces with at least one `{ day: today, … }` entry. Sorted by priority then slack.

## API surface (all NEW, all under `/admin/production/schedule`)

- `GET /admin/production/schedule?days=14` → full result `{ grid[], pieces[], bottlenecks[], lateOrders[], startToday[] }`
- `GET /admin/production/schedule/today` → just `startToday[]` (the floor's pull list)
- `GET /admin/production/schedule/by-piece?code=<gatiPieceCode>` → one piece's itinerary (query-param because the code contains slashes)
- `GET /admin/production/schedule/by-stage/:stageCode?days=14` → that stage's day-by-day load + cell breakdown
- `POST /admin/production/schedule/preview` → run the algorithm with hypothetical `{ addCellsByStage?, overtimeHoursPerDay? }` overrides (no DB side effects)

## Files

### New (3 files, all under `src/production-planner/scheduling/`)
- `services/scheduleService.ts` — exports `buildSchedule(opts: { days?: number; overrides?: { addWorkersByCell?: Record<string, number>; overtimeHoursPerDay?: number } })` returning `ScheduleResult`. Pure function — no DB writes.
- `routes/schedule.ts` — the 5 endpoints above, admin-only.
- `index.ts` — `export { default } from "./routes/schedule"`.

### Modified models (2 optional fields)
- `src/production-planner/models/stageDefinition.ts` — add **`unitsPerWorkerHour?: number`** (e.g. 50 for Filing at 50 g/hr). Optional with no default: pieces at a stage without a configured rate are flagged as "rate not set — please configure" in the schedule output. Capacity planner doesn't read this field so it stays unaffected.
- `src/production-planner/models/cell.ts` — add **`workersCount?: number`** with default `1`. Capacity planner currently treats every cell as one work-unit (via `activeCellsForStage` returning a count); this field doesn't change that behaviour. The scheduler uses the new field when present.

Both additions are also surfaced in the admin CRUD routes (`PUT /stages/:code`, `PUT /cells/:code`) so the FE Settings screens can edit them without separate endpoints. These are the only places existing files are touched outside of mounting the new router.

### Modified plumbing (2 lines)
- `src/production-planner/index.ts` — import + mount the scheduling router. Same pattern as every other sub-router currently in this file.

### Untouched
- All capacity-planner service files under `src/production-planner/services/production/` — read via their exported functions, never modified.
- `src/production-planner/routes/planning.ts`, `whatIf.ts`, `dashboards.ts` — capacity-planner endpoints keep working exactly as today.

## Reuse
- **Capacity helpers (imported):** `activeCellsForStage` from `services/production/capacityService.ts`.
- **Models (read):** `JobCard`, `StageDefinition`, `Cell`, `GatiColumnMap`, `ProductionCalendar`.

## Verification

1. `npx tsc -p tsconfig.json --noEmit` → clean.
2. Existing capacity endpoints still respond identically: `GET /dashboards/capacity`, `POST /planning/check`, `POST /what-if/simulate` — same behavior, no regression.
3. Smoke scenario for the new scheduler: seed ~30 JobCards spread across stages with mixed ship-by dates; constrain FILING to 2 cells × 1.5 pieces/day = 3/day but queue 18 pieces needing FILING in the next 5 days. Expect:
   - `bottlenecks` includes FILING on days 1–5
   - Pieces with very tight ship-by land in `lateOrders`
   - `startToday` contains the highest-priority pieces ready to enter their next stage
   - Sum over `grid[day].byStage[stage]` never exceeds `cellsForStage × dailyCapacityPerCell` per day
4. Determinism: two consecutive calls with no DB changes return identical output.
5. Cancelled / completed JobCards never appear in the schedule.

---

