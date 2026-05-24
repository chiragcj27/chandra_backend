# Diamond Production Intelligence Platform — Full Spec

> **Note on output location**: This is the deliverable spec. Once plan mode is exited, copy this file to `c:\Projects\chandra_backend\docs\production-planner-spec.md` (or wherever) to share with frontend Claude.

---

## 0. Context & Goals

Chandra Jewels has a working backend (`chandra_backend`: TS + Express + MongoDB/Mongoose, S3, JWT auth). Internal production today is a black box — `order_in_production` is a single status with no visibility into stages, no inventory tracking, no capacity planning.

This spec adds a **Production Intelligence module** that follows the user's stated 4-step flow:

1. **Order intake** — CSV upload logs each line item with diamond + metal + findings details
2. **Capacity planning** — given current load, when can a new order be completed, what are the bottlenecks
3. **Diamond inventory planning** — stones required vs in stock, delta, shortage alerts, auto-PO drafts
4. **Tracking & visibility** — every line item's current stage, expected vs actual time, lateness flags

Plus four cross-cutting v1 features:

- **Material-loss accounting** (gold + stone loss per JobCard/stage/cell)
- **Auto-PO drafting** when a diamond shortage fires
- **What-if simulator** ("if we accept this rush order, what slips?")
- **Anomaly detection** on stage baselines (alert when cycle time drifts)

---

## 1. Hard Constraints

1. **No edits to existing chandra models/services/routes.** All production-planner code lives under `src/production-planner/`. Production module is read-only against `Order`/`Product`/`ClientUser` if it needs them.
2. **Same Express app, same MongoDB, same auth** — production-planner exports a single router mounted in `src/server.ts`. Mounting requires **one** added line in `server.ts` (`app.use("/admin/production", productionPlannerRouter)`); that is the only existing-file change permitted.
3. **Upload format is `.xlsx` (Excel).** GatiSOFT exports are Excel files. The parser uses the `xlsx` npm package and is sheet-and-row based; CSV would be trivially supported by the same code path if ever needed, but the primary and only documented input is `.xlsx`. Sample files shared during planning are CSV renderings of these Excel sheets — the column structure is identical.
4. **Stages and cells are configurable**, not hardcoded. Stage list is curated from CSV column headers via a `GatiColumnMap`.
5. **Tracking unit = line item** (`OrderNoWithoutSrNo/OrderItemSrNo`). Line items have `totalQty` and can split across stages.
6. **No worker model, no attendance, no floor PWA, no AI in v1.** Seat scaffolded for future use.

---

## 2. CSV Format Reference (the real GatiSOFT data)

### 2.1 Order Excel — `.xlsx` (sample provided as CSV: `order data.csv`)

A line item (one piece-group) has **variable rows** of these types:

| Row type (`RawAliasName`) | Count per item | Used for |
|---|---|---|
| `LABGROWN DIAMOND` (or other diamond aliases) | **1 or more** — one per distinct diamond spec | Diamond spec(s) array |
| `GOLD` (or other metal aliases) | **Exactly 1** | Metal type + weight |
| `FINDING` / similar (clasps, posts, etc.) | **0 or more** — one per finding type | Findings list |

Rows are joined into one JobCard by **`OrderNoWithoutSrNo + "/" + OrderItemSrNo`** — that string is the JobCard's `gatiPieceCode` and is also the WIP key.

#### Columns

| Column | Meaning | Used for |
|---|---|---|
| `OrderDate` | Order placement date (MM/DD/YYYY) | JobCard.orderedAt |
| `OrderNoWithoutSrNo` | Parent order # (e.g. `CO/REG/26-27/0112`) | JobCard.orderNumber |
| `ItmPrdDelDate` | Promised delivery date | JobCard.expectedDeliveryAt |
| `OrderQty` | Qty in this line item | JobCard.totalQty |
| `OrderItemSrNo` | Line item # within order | Forms unique key with order# |
| `Customer` | Customer code | JobCard.customerCode |
| `RawAliasName` | Row type — diamond / gold / finding | Routes parsing |
| `StyleCode_Repeat` | Style per size variant (R10500, R10500/5) | JobCard.styleNo |
| `ItmItemSizeName` | Ring size (e.g. `4 US`) | JobCard.size |
| `ItemCode` | Material code (`LRD`, `G14KT`, etc.) | Diamond/metal subtype |
| `GSize` | Diamond grain range (`+2-6.5 CRD`) | Diamond SKU key |
| `Size` | Sieve range (`2-2.5 CRD`) | Diamond SKU key |
| `DiaSizeMM` | Diamond size in mm | Diamond SKU key |
| `Pointer` | Carat per stone | Stones-per-piece calc |
| `NetWeight` | Diamond row → total carats; Gold row → grams | Different per row type |

#### Pivot algorithm (Order CSV → JobCards)

```
1. Read all rows, skip header + trailing totals row (totals row has no OrderNoWithoutSrNo).
2. Group rows by (OrderNoWithoutSrNo, OrderItemSrNo).
3. For each group:
   a. diamondRows = rows where RawAliasName matches diamond aliases
   b. metalRow    = row where RawAliasName matches metal aliases (must be exactly 1)
   c. findingRows = rows where RawAliasName matches finding aliases (0+)
   d. If metalRow missing OR diamondRows empty → record error in import run, skip group
   e. Build JobCard:
      gatiPieceCode      = `${OrderNoWithoutSrNo}/${OrderItemSrNo}`
      orderNumber        = OrderNoWithoutSrNo
      orderItemSrNo      = OrderItemSrNo
      totalQty           = OrderQty
      styleNo            = StyleCode_Repeat
      size               = ItmItemSizeName
      expectedDeliveryAt = ItmPrdDelDate
      customerCode       = Customer
      diamondSpecs       = diamondRows.map(r => ({
                              gSize, sieve: r.Size, diaSizeMM, pointer,
                              totalCaratsPerPiece: r.NetWeight,
                              stonesPerPiece: round(r.NetWeight / r.Pointer)
                           }))
      totalStones        = sum(diamondSpecs.stonesPerPiece) * totalQty
      metalType          = metalRow.ItemCode
      metalWeightPerPiece= metalRow.NetWeight
      totalMetalWeight   = metalRow.NetWeight * totalQty
      findings           = findingRows.map(r => ({ code: r.ItemCode, qty: r.NetWeight }))
      priority           = "normal"
      status             = "planned"
      currentStageDistribution = []
4. Upsert by gatiPieceCode (idempotent).
5. Auto-seed Diamond master from any new (gSize, sieve, diaSizeMM) seen.
6. Errors per row group recorded in GatiImportRun.errors[].
```

`diamondAliases`, `metalAliases`, and `findingAliases` are configurable (`GatiColumnMap.aliases`) so future GatiSOFT additions don't need code changes.

### 2.2 WIP Excel — `.xlsx` (sample provided as CSV: `what is where.csv`)

| Column | Meaning |
|---|---|
| `Book Name` | `Customer Order` (currently the only type) |
| `OrderNo+SrNo` | **Unique key** — matches JobCard.gatiPieceCode |
| `Style No` | Style (informational) |
| `BalanceQty` | Total balance (= JobCard.totalQty when active) |
| `PendingQty` | Not yet started qty |
| `OnFloor` | Currently in production qty |
| **Stage columns** | Qty currently at that stage-cell |

#### Stage column → (stageCode, cellCode) decomposition

User confirmed: `FIL`, `FIL-2`, `FIL-3` are the **same stage (Filing) in three different cells**. Stored in `GatiColumnMap.wipColumns[]`:

```
{ rawColumn: "FIL",   stageCode: "FILING",       cellCode: "C1" }
{ rawColumn: "FIL-2", stageCode: "FILING",       cellCode: "C2" }
{ rawColumn: "FIL-3", stageCode: "FILING",       cellCode: "C3" }
{ rawColumn: "PPL",   stageCode: "PRE_POLISH",   cellCode: "C1" }
{ rawColumn: "PPL-2", stageCode: "PRE_POLISH",   cellCode: "C2" }
{ rawColumn: "FPL",   stageCode: "FINAL_POLISH", cellCode: "C1" }
{ rawColumn: "FPL2",  stageCode: "FINAL_POLISH", cellCode: "C2" }
{ rawColumn: "FPL-3", stageCode: "FINAL_POLISH", cellCode: "C3" }
{ rawColumn: "FG",    stageCode: "FINISHED_GOODS", cellCode: "C1" }
{ rawColumn: "FG 2",  stageCode: "FINISHED_GOODS", cellCode: "C2" }
{ rawColumn: "ASBL",  stageCode: "ASSEMBLY",     cellCode: "C1" }
{ rawColumn: "ASBL2", stageCode: "ASSEMBLY",     cellCode: "C2" }
... etc
```

Default mappings shipped with the system. Admin reviews on first WIP upload; unmapped columns surface as draft rows in `StageDefinition` for confirmation.

#### WIP diff algorithm

```
For each WIP row (skip totals row "Customer Order Total"):
  1. Parse OrderNo+SrNo → look up JobCard. If missing, error (Order CSV must run first).
  2. If BalanceQty == 0 → mark JobCard.status = "completed" if not already; skip diff.
  3. newDistribution = []
     For every stage column with qty > 0:
       (stageCode, cellCode) = GatiColumnMap.lookup(rawColumn)
       If unmapped → error this row, surface unmapped column
       newDistribution.push({ stageCode, cellCode, qty })
  4. Diff against JobCard.currentStageDistribution:
     For each (stage,cell) where new.qty > old.qty:
       Append StageMovement {
         jobCardId, toStageCode, cellCode,
         qty: new.qty - old.qty,
         enteredAt: now
       }
     For each (stage,cell) where new.qty < old.qty:
       Find open StageMovement for (stage,cell) → set exitedAt=now,
         compute durationHours, set qty closed = old.qty - new.qty
  5. Update JobCard.currentStageDistribution = newDistribution
  6. Compute JobCard.status:
     - All qty in terminal stage → "completed" + actualCompletionAt = now
     - Any qty in HOLD stage → "on_hold"
     - Else → "in_progress"
```

**Stage-time approximation:** WIP is a daily snapshot, not an event log. Stage durations are accurate to ±1 day (matching upload frequency). Sufficient for "stuck > 2× expected" alerts. Future floor PWA sharpens this.

---

## 3. Code Organization

```
chandra_backend/
└── src/
    ├── production-planner/                    # ALL new code lives here
    │   ├── index.ts                           # exports default Express Router
    │   ├── models/
    │   │   ├── stageDefinition.ts
    │   │   ├── cell.ts
    │   │   ├── seat.ts
    │   │   ├── jobCard.ts
    │   │   ├── stageMovement.ts
    │   │   ├── diamond.ts
    │   │   ├── diamondInventoryLedger.ts
    │   │   ├── diamondAllocation.ts
    │   │   ├── metalLedger.ts
    │   │   ├── alert.ts
    │   │   ├── capacityBaseline.ts
    │   │   ├── gatiImportRun.ts
    │   │   ├── gatiColumnMap.ts
    │   │   ├── productionCalendar.ts
    │   │   ├── orderProductionState.ts        # rollup of JobCards per chandra Order
    │   │   ├── productBom.ts                  # per-style expected diamonds/metal (no Product edit)
    │   │   ├── purchaseOrderDraft.ts          # auto-PO drafts
    │   │   └── whatIfScenario.ts              # saved scenarios
    │   ├── services/
    │   │   ├── production/
    │   │   │   ├── jobCardService.ts
    │   │   │   ├── stageMovementService.ts
    │   │   │   ├── capacityService.ts
    │   │   │   ├── planningService.ts
    │   │   │   ├── alertEngine.ts
    │   │   │   ├── anomalyDetector.ts
    │   │   │   └── whatIfService.ts
    │   │   ├── inventory/
    │   │   │   ├── diamondService.ts
    │   │   │   ├── inventoryLedgerService.ts
    │   │   │   ├── allocationService.ts
    │   │   │   ├── metalLedgerService.ts
    │   │   │   ├── requirementsService.ts
    │   │   │   ├── materialLossService.ts
    │   │   │   └── autoPoService.ts
    │   │   └── integrations/
    │   │       ├── csvXlsxParser.ts
    │   │       ├── columnMapper.ts
    │   │       ├── gatiOrdersAdapter.ts
    │   │       └── gatiWipAdapter.ts
    │   ├── routes/
    │   │   ├── stages.ts
    │   │   ├── cells.ts
    │   │   ├── seats.ts
    │   │   ├── calendar.ts
    │   │   ├── columnMaps.ts
    │   │   ├── jobCards.ts
    │   │   ├── movements.ts
    │   │   ├── planning.ts
    │   │   ├── whatIf.ts
    │   │   ├── dashboards.ts
    │   │   ├── alerts.ts
    │   │   ├── diamonds.ts
    │   │   ├── inventoryLedger.ts
    │   │   ├── allocations.ts
    │   │   ├── metalLedger.ts
    │   │   ├── requirements.ts
    │   │   ├── materialLoss.ts
    │   │   ├── purchaseOrders.ts
    │   │   ├── importsOrders.ts
    │   │   ├── importsWip.ts
    │   │   └── importRuns.ts
    │   ├── jobs/
    │   │   ├── recomputeBaselines.ts
    │   │   ├── runAlertRules.ts
    │   │   └── detectAnomalies.ts
    │   └── types/
    │       └── index.ts                       # shared TypeScript types
    └── server.ts                              # ONLY existing-file change: 1 line to mount router
```

`src/server.ts` change (the single allowed edit):
```ts
import productionPlannerRouter from "./production-planner";
app.use("/admin/production", productionPlannerRouter);
```

---

## 4. Data Model

All collections under `production-planner/models/`. No edits to existing chandra collections.

### 4.1 Configuration

| Collection | Key fields |
|---|---|
| `StageDefinition` | `code` (PK), `name`, `expectedDurationHours`, `expectedDurationStdDevHours`, `dependencies[]` (codes), `parallelGroup`, `unitOfWork` (`piece`\|`grams`\|`stones`), `isOptional`, `isTerminal`, `displayOrder`, `active` |
| `Cell` | `code` (PK), `name`, `stageCodes[]`, `description`, `active` |
| `Seat` | `code` (PK), `cellId`, `stageCodes[]`, `active` |
| `ProductionCalendar` | `shifts[]` (`{name, startTime, endTime}`), `holidayDates[]`, `weekendDays[]` |
| `GatiColumnMap` | `version`, `aliases` (`{diamond[], metal[], finding[]}`), `orderColumns` (`{rawColumn, fieldPath}[]`), `wipColumns` (`{rawColumn, stageCode, cellCode}[]`) |
| `ProductBom` | `styleNo` (PK), `expectedDiamonds[]`, `expectedMetalGrams`, `expectedMetalType` — for cross-checks |

### 4.2 Production data

| Collection | Key fields |
|---|---|
| `JobCard` | `gatiPieceCode` (PK, `OrderNo/SrNo`), `orderNumber`, `orderItemSrNo`, `totalQty`, `styleNo`, `size`, `customerCode`, `diamondSpecs[]` (`{gSize, sieve, diaSizeMM, pointer, totalCaratsPerPiece, stonesPerPiece}`), `totalStones`, `metalType`, `metalWeightPerPiece`, `totalMetalWeight`, `findings[]`, `findingsReceived` (bool), `priority` (`normal`\|`urgent`\|`critical`), `expectedDeliveryAt`, `status` (`planned`\|`in_progress`\|`on_hold`\|`completed`\|`cancelled`), `currentStageDistribution[]` (`{stageCode, cellCode, qty}`), `plannedCompletionAt`, `actualCompletionAt`, `orderedAt`, timestamps |
| `StageMovement` | `jobCardId`, `fromStageCode`, `toStageCode`, `cellId`, `seatId`, `qty`, `enteredAt`, `exitedAt`, `durationHours`, `qcResult` (`pass`\|`fail`\|`rework`\|null), `rejectionReason`, `weightInGrams`, `weightOutGrams`, `stonesIn`, `stonesOut`, `notes`, `attachments[]` (S3 keys) |
| `OrderProductionState` | `orderNumber` (PK), `chandraOrderId`, `aggregateStatus`, `jobCardCount`, `completedCount`, `delayedCount`, `lastUpdatedAt` |

### 4.3 Inventory

| Collection | Key fields |
|---|---|
| `Diamond` | `code` (auto: `${gSize}\|${sieve}\|${mm}`, PK), `gSize`, `sieve`, `diaSizeMM`, `pointer`, `clarity`, `color`, `costPerStone`, `reorderThreshold`, `reorderQty`, `procurementLeadTimeDays`, `preferredSupplier` |
| `DiamondInventoryLedger` | `diamondCode`, `movementType` (`receipt`\|`allocation`\|`consumption`\|`return`\|`adjustment`\|`loss`), `quantity` (signed), `jobCardId`, `referenceDoc`, `at`, `notes` |
| `DiamondAllocation` | `jobCardId`, `diamondCode`, `quantityAllocated`, `quantityConsumed`, `status` (`active`\|`released`\|`completed`) |
| `MetalLedger` | `metalType`, `movementType` (`issue`\|`return`\|`loss`\|`adjustment`), `weightGrams` (signed), `jobCardId`, `stageCode`, `cellId`, `at`, `notes` |
| `PurchaseOrderDraft` | `poNumber`, `supplier`, `lines[]` (`{diamondCode, qty, costEstimate}`), `totalCost`, `status` (`draft`\|`approved`\|`sent`\|`received`\|`cancelled`), `triggeredByAlertId`, `createdAt`, `approvedBy`, `approvedAt` |

### 4.4 Operations

| Collection | Key fields |
|---|---|
| `Alert` | `type`, `severity` (`info`\|`warning`\|`critical`), `subjectType`, `subjectId`, `message`, `payload`, `raisedAt`, `acknowledgedBy`, `acknowledgedAt`, `resolvedAt`, `resolvedBy` |
| `CapacityBaseline` | `stageCode`, `windowDays`, `unitsPerHour`, `unitsPerDay`, `stdDev`, `sampleSize`, `lastComputedAt` |
| `GatiImportRun` | `fileType` (`orders`\|`wip`), `fileName`, `uploadedBy`, `uploadedAt`, `rowCount`, `inserted`, `updated`, `skipped`, `errored`, `rowErrors[]`, `unmappedColumns[]`, `status` |
| `WhatIfScenario` | `name`, `inputs` (extra hires, overtime hours, new orders, etc.), `outputs` (delivery date impacts, etc.), `createdBy`, `createdAt` |

---

## 5. The 4 Flows — Inputs & Outputs

### Flow 1: Order Intake

**Endpoint:** `POST /admin/production/imports/gati-orders` (multipart, `file=<.xlsx>`)

**Inputs:** Order Excel file (`.xlsx`). Parser config from `GatiColumnMap`.

**Outputs:**
- `GatiImportRun` record with insert/update/error counts
- N JobCards upserted (idempotent)
- New Diamond SKUs auto-seeded
- Per-row errors visible at `GET /admin/production/imports/runs/:id`

### Flow 2: Capacity Planning

**Endpoint (calculator):** `POST /admin/production/planning/check`
```json
Request body: { orderSpec: { totalQty, stoneCount, metalWeight, requiresStages[], expectedDeliveryAt, priority } }
Response: {
  estimatedCompletionAt, leadTimeDays,
  bottleneckStage, capacityStatus,
  overtimeHoursNeeded, requiredCellsByStage[],
  onTimeProbability, criticalPath[],
  warnings[]
}
```

**Endpoint (live dashboard):** `GET /admin/production/dashboards/capacity`
Response: `{ stages: [{ stageCode, queueUnits, capacityPerDay, queueDays, isBottleneck, activeCells }], monthLoadPct, openOrders }`

**Math:**
- `capacityPerDay = baseline.unitsPerDay × activeCells(stage)`
- `queueDays = openJobUnits(stage) / capacityPerDay`
- Bottleneck = top 1–3 stages by `queueDays`
- Lead time = critical-path sum across stage dependency graph

### Flow 3: Diamond Inventory Planning

**Endpoint:** `GET /admin/production/inventory/requirements`
Response: `[{ diamondCode, gSize, sieve, mm, onHand, allocated, available, required, delta, reorderSuggestedQty, status: "ok"|"low"|"shortage"|"critical" }]`

**Computation:**
- `onHand = sum(DiamondInventoryLedger.quantity where diamondCode=X)`
- `allocated = sum(DiamondAllocation.quantityAllocated - quantityConsumed where active)`
- `available = onHand - allocated`
- `required = sum across open JobCards of stoneCount of matching SKU × totalQty`
- `delta = available - required`

**Auto-PO trigger** (see Section 6.2).

### Flow 4: Tracking & Alerts

**Endpoint:** `POST /admin/production/imports/gati-wip` (multipart, `file=<.xlsx>`)

**Tracking UI grouping:** the primary tracking view is **order-grouped** — list of orders (`OrderNoWithoutSrNo`), each row shows the order's aggregate state. Drilling into one order reveals all its line items (JobCards). The flat per-JobCard view is kept as an advanced filter, not the default.

- `GET /admin/production/dashboards/orders?status=&customerCode=&priority=&deliveryBefore=&isLate=`
  Returns **order-level rollups**: `[{ orderNumber, customerCode, expectedDeliveryAt (earliest among pieces), totalQty, totalPieces (= JobCard count), inProgressCount, completedCount, delayedCount, stageDistribution[] (rolled-up qty by stage), worstLatenessDays, priority, status }]`.
- `GET /admin/production/dashboards/orders/:orderNumber` — drill-in: order header + array of all JobCards in the order with their `currentStageDistribution`, time-in-stage, lateness flags.
- `GET /admin/production/job-cards/:id` — single line item detail by Mongo `_id` (called when a user clicks into a specific piece from the per-order view). Use `GET /job-cards/by-code?code=` to look up by `gatiPieceCode`, which contains slashes.
- `GET /admin/production/job-cards?...` — flat JobCard search (advanced filter, e.g. "show all pieces stuck at SETTING across all orders").

**Alert rules** (see Section 6.4).

---

## 6. Cross-Cutting v1 Features

### 6.1 Material-Loss Accounting

**Data sources:**
- `StageMovement.weightInGrams`, `weightOutGrams` — gold loss per movement
- `StageMovement.stonesIn`, `stonesOut` — stone loss per movement
- `MetalLedger` — issued vs returned per JobCard
- `DiamondAllocation` — allocated vs consumed per JobCard

**Per-JobCard loss:** `goldLoss = totalIssued - totalReturned - finalPieceWeight`. Negative finals (where outWeight < inWeight) flagged.

**Reports:**
- Per-JobCard loss summary
- Loss by stage (which stage bleeds the most gold?)
- Loss by cell (e.g. is Filing C1 worse than Filing C2?)
- Loss trend over time
- Loss vs industry benchmark (config: target loss %)

**Endpoints:**
- `GET /admin/production/material-loss/summary?from=&to=`
- `GET /admin/production/material-loss/by-stage`
- `GET /admin/production/material-loss/by-cell`
- `GET /admin/production/material-loss/by-job-card/:id`

### 6.2 Auto-PO Drafting

**Trigger:** Diamond shortage alert fires (`available < required` OR `delta < 0` within procurement lead-time window).

**Behavior:**
- System creates a `PurchaseOrderDraft` row with the shortfall qty + suggested supplier (from `Diamond.preferredSupplier`)
- Multiple shortages bundled per supplier into one draft
- Admin reviews at `/admin/inventory/purchase-orders`
- Admin can edit qty, supplier, terms; click `approve` to mark `status="approved"` (or send via email later)
- Sent POs become `received` when GRN is logged against them

**Endpoints:**
- `GET /admin/production/purchase-orders?status=draft`
- `POST /admin/production/purchase-orders/:id/approve`
- `PUT /admin/production/purchase-orders/:id` (edit lines)
- `POST /admin/production/purchase-orders/:id/cancel`

### 6.3 What-If Simulator

**Inputs:**
- Hypothetical changes: extra hires per stage, additional shift, accept new urgent order, change priority of existing orders
- Optionally: a saved scenario name

**Outputs:**
- Predicted impact on each open JobCard's completion date
- Capacity utilization changes per stage
- Cost delta (overtime, new hires)
- List of orders that would slip / be saved

**Endpoint:**
- `POST /admin/production/what-if/simulate`
  ```json
  Request: { changes: { addCellsByStage: {SETTING: 1}, overtimeHoursPerDay: 2, newOrders: [{...orderSpec}], reprioritize: [{jobCardId, newPriority}] } }
  Response: { jobCardImpacts: [{gatiPieceCode, oldCompletionAt, newCompletionAt, deltaDays}], stageLoadImpacts: [...], costDelta: {...}, ordersSlipping: [...], ordersSaved: [...] }
  ```
- `POST /admin/production/what-if/scenarios` — save a scenario
- `GET /admin/production/what-if/scenarios` — list saved

### 6.4 Anomaly Detection on Baselines

**Job:** runs nightly after `recomputeBaselines.ts`.

**Logic:**
- For each stage, compare today's `unitsPerDay` against the previous 30-day avg.
- If today's avg is `> 1.20×` (slowdown) or `< 0.80×` (speedup) of prior avg → emit `Alert` with `type=BASELINE_DRIFT`
- Speedup is flagged because it usually means data quality issue (e.g. WIP not updated)

**Also detects:**
- Stage that hasn't seen any movement in N days (`type=STAGE_STALE`)
- JobCard older than `expectedDeliveryAt + 7 days` and not completed (`type=ZOMBIE_ORDER`)
- Mass re-routing (>10 pieces re-entering the same earlier stage in a day → process problem)

---

## 7. Alert Rules (full list)

| Alert type | Severity | Trigger |
|---|---|---|
| `PIECE_STUCK` | warning | `now - StageMovement.enteredAt > stage.expectedDurationHours × 2` |
| `PIECE_SEVERELY_STUCK` | critical | × 3 |
| `DELIVERY_AT_RISK` | warning | projected completion > expectedDeliveryAt |
| `DELIVERY_OVERDUE` | critical | now > expectedDeliveryAt and status ≠ completed |
| `QC_REWORK` | info | qty re-entered an earlier stage |
| `BLOCKER_FORMED` | warning | stage `queueDays > buffer_days_threshold` for ≥ 4 hrs |
| `DIAMOND_LOW_STOCK` | warning | `available < reorderThreshold` |
| `DIAMOND_SHORTAGE` | critical | `delta < 0` |
| `DIAMOND_IMMINENT_SHORTAGE` | critical | `delta < 0 && procurementLeadTimeDays > daysUntilNeeded` |
| `MATERIAL_LOSS_SPIKE` | warning | per-cell gold loss % > 2× rolling avg |
| `BASELINE_DRIFT_SLOW` | warning | stage avg duration drifted > 20% slower wk-over-wk |
| `BASELINE_DRIFT_FAST` | info | > 20% faster (data-quality concern) |
| `STAGE_STALE` | info | no movement in stage for N days |
| `ZOMBIE_ORDER` | warning | overdue by 7+ days, not completed |
| `MASS_REWORK` | critical | >10 pieces re-entered same earlier stage in 1 day |
| `MONTH_LOAD_HIGH` | info | month load > 90% capacity |

All persisted in `Alert` collection with ack/resolve workflow.

---

## 8. Complete Backend API Surface (as implemented)

**Base path:** every route below is prefixed by `/admin/production` (mounted from `src/routes/admin/index.ts`).
**Auth:** existing chandra `requireAuth + requireRole("admin")` middleware on every route. Bearer JWT in `Authorization` header.
**Multipart uploads:** `file` field, in-memory parse, accepts `.xlsx` / `.xls` / `.csv`, 25 MB cap.

### Identifier conventions

| Identifier | Where it lives | Why it matters |
|---|---|---|
| `gatiPieceCode` | JobCard primary key — e.g. `CO/REG/26-27/0112/1` | Contains `/` — **never safe to put in a URL path**. Use Mongo `_id` for path-based sub-actions, or `?code=` query param for lookup. |
| Diamond `code` | Diamond primary key — e.g. `+2-6.5 CRD\|2-2.5 CRD\|1.25` | Contains `|`/spaces — same constraint. Use `?code=` query param. |
| Stage/Cell `code` | StageDefinition / Cell primary keys | Single segment, URL-safe. |
| Mongo `_id` | All collections | ObjectId, URL-safe; preferred for path params. |

### Configuration
- `GET/POST /stages`, `GET/PUT/DELETE /stages/:code` — StageDefinition CRUD (`code` upper-cased)
- `GET/POST /cells`, `GET/PUT/DELETE /cells/:code` — Cell CRUD
- `GET /seats?cellCode=`, `POST /seats`, `GET/PUT/DELETE /seats/:code` — Seat CRUD
- `GET/PUT /calendar` — ProductionCalendar (singleton, auto-created on first GET)
- `GET/PUT /column-maps/:fileType` — GatiColumnMap (`fileType` = `orders` \| `wip`)

### Imports
- `POST /imports/gati-orders` (multipart `file`) — runs the Order Excel pivot importer synchronously, returns the persisted `GatiImportRun`
- `POST /imports/gati-wip` (multipart `file`) — runs the WIP diff importer, then fires baseline recompute + alert engine in the background
- `GET /imports/runs?fileType=&status=&limit=&skip=` — list runs (omits `rowErrors[]` for size)
- `GET /imports/runs/:id` — full detail with `rowErrors[]` and `unmappedColumns[]`

> The earlier draft mentioned a `POST /imports/runs/:id/retry-row` endpoint — that's **not implemented yet**. Fix the underlying data and re-upload the file; the importer is idempotent on `gatiPieceCode`.

### Job cards & movements
- `GET /job-cards?status=&customerCode=&priority=&orderNumber=&deliveryBefore=&isLate=&limit=&skip=` — list
- `GET /job-cards/by-code?code=<gatiPieceCode>` — lookup by GatiSOFT code (use this for the slash-containing key)
- `GET /job-cards/:id` — lookup by Mongo `_id`
- `PUT /job-cards/:id/findings` `{ received: boolean }` — toggle findingsReceived (uses Mongo `_id`)
- `PUT /job-cards/:id/priority` `{ priority: "normal" \| "urgent" \| "critical" }` — change priority
- `GET /job-cards/:id/movements` — full StageMovement timeline (newest first)
- `GET /movements?gatiPieceCode=&stageCode=&cellCode=&from=&to=&open=true&limit=&skip=` — raw movement list

> No `POST /movements` for manual overrides in v1 — movement creation is owned by the WIP import path. Add later if floor app comes online.

### Planning
- `GET /dashboards/capacity` — per-stage queue + capacity + current bottlenecks + month-load gauge
- `POST /planning/baselines/recompute` — manually refresh capacity baselines (also runs automatically every 6h via the scheduler and after every WIP import)
- `POST /planning/check` `{ orderSpec: { totalQty, totalStones?, totalGrams?, requiresStages?[], excludeStages?[], expectedDeliveryAt?, priority? } }` — full calculator: leadTimeDays, estimatedCompletionAt, bottleneckStage, capacityStatus, overtimeHoursNeeded, onTimeProbability, criticalPath[], perStage[], warnings[]
- `GET /planning/lead-time?totalQty=&totalStones=&totalGrams=&priority=` — quick estimate (wraps `/planning/check`)

### What-If
- `POST /what-if/simulate` `{ changes: { addCellsByStage?, overtimeHoursPerDay?, newOrders?[], reprioritize?[] } }` — returns jobCardImpacts, stageLoadImpacts, costDelta, summary (ordersSaved/slipping)
- `GET /what-if/scenarios`, `POST /what-if/scenarios`, `DELETE /what-if/scenarios/:id` — save / list / delete named scenarios

### Tracking dashboards (read-only aggregates)
- `GET /dashboards/orders?status=&customerCode=&priority=&deliveryBefore=&isLate=` — **primary tracking view** — one row per `OrderNoWithoutSrNo` with rolled-up `stageDistribution[]`, progress counts, `worstLatenessDays`
- `GET /dashboards/orders/:orderNumber` — drill-in (URL-encode the order number once; it does NOT contain `/`)
- `GET /dashboards/capacity` — see Planning above
- `GET /dashboards/analytics?from=&to=` — on-time %, cycle time per stage, daily movement trend, anomaly counts by type, material-loss summary

### Inventory — Diamonds
- `GET /inventory/diamonds?active=&q=&limit=&skip=` — list (q matches code/gSize/sieve)
- `GET /inventory/diamonds/by-code?code=` — single (the `|`-containing code stays in a query param)
- `POST /inventory/diamonds` — manual create (auto-seed handles most)
- `PUT /inventory/diamonds/by-code?code=` — edit cost, threshold, leadTime, supplier, clarity, color
- `DELETE /inventory/diamonds/by-code?code=` — soft-delete (`active=false`)

### Inventory — Ledger & Allocations
- `POST /inventory/ledger` `{ diamondCode, movementType, quantity, jobCardId?, gatiPieceCode?, referenceDoc?, notes? }` — GRN / adjustment / return / etc. (signed `quantity`)
- `GET /inventory/diamonds/:code/ledger?limit=` — single-segment codes only
- `GET /inventory/diamonds-ledger/by-code?code=&limit=` — for `|`-containing codes
- `POST /inventory/allocations` `{ jobCardId, diamondCode, qty, notes? }` — soft-reserve; writes both `DiamondAllocation` and a balancing negative ledger entry
- `POST /inventory/allocations/:id/consume` `{ qty? }` — convert reservation to consumption (`qty` omitted = consume the full remaining)
- `POST /inventory/allocations/:id/release` — release unused reservation; writes a positive `return` ledger entry
- `GET /inventory/allocations/by-job-card/:id`

### Inventory — Requirements
- `GET /inventory/requirements?status=` — full table (`status` filter: `ok` \| `low` \| `shortage` \| `critical`)
- `GET /inventory/shortages` — only rows with `delta < 0`

### Inventory — Metal
- `POST /inventory/metal-ledger` `{ metalType, movementType, weightGrams, jobCardId?, stageCode?, cellCode?, notes? }` — signed grams
- `GET /inventory/metal-ledger/by-job-card/:id` — returns entries + `netGrams`

### Material Loss
- `GET /material-loss/summary?from=&to=` — gold/stone loss roll-up + percentages
- `GET /material-loss/by-stage?from=&to=`
- `GET /material-loss/by-cell?from=&to=`
- `GET /material-loss/by-job-card/:id` (Mongo `_id`)

### Purchase Orders (auto-PO)
- `GET /purchase-orders?status=&limit=&skip=` — list (`status` = `draft` \| `approved` \| `sent` \| `received` \| `cancelled`)
- `GET /purchase-orders/:id`
- `POST /purchase-orders` `{ poNumber?, supplier?, lines[{diamondCode, qty, costEstimate?, notes?}], notes? }` — manual create
- `PUT /purchase-orders/:id` — edit (only allowed while status=`draft`)
- `POST /purchase-orders/:id/approve` — flip to `approved`
- `POST /purchase-orders/:id/cancel` — flip to `cancelled` (forbidden after `received`)
- `POST /purchase-orders/generate-from-shortages` — scan requirements, group by `preferredSupplier`, refresh open drafts or create new ones. Idempotent per supplier.

### Alerts
- `GET /alerts?severity=&type=&subjectType=&status=open|acknowledged|resolved&limit=&skip=` — list, sorted critical-first then by recency
- `POST /alerts/:id/acknowledge`
- `POST /alerts/:id/resolve`
- `POST /alerts/run` — manually trigger the full scan (stuck pieces, delivery overdue, QC rework, zombie orders, diamond shortages, anomaly detection — baseline drift / stale stages / loss spikes)

### Anomaly preview
- `POST /anomalies/detect` — preview the anomaly detector's candidates without persisting them. (The regular `/alerts/run` already persists them on every scan.)

### Schedulers (background, no endpoints)
- `recomputeBaselines` runs every **6 hours** by default
- `runAlertRules` runs every **15 minutes** by default
- Tune via env: `PRODUCTION_PLANNER_BASELINE_INTERVAL_MIN`, `PRODUCTION_PLANNER_ALERT_INTERVAL_MIN`
- Disable entirely: `PRODUCTION_PLANNER_DISABLE_SCHEDULERS=true`

---

## 9. Frontend Application — What to Build

> Audience: a frontend Claude generating prototypes. Stack assumed: React + TypeScript + Tanstack Query + Tanstack Table + Recharts (or equivalent). Reuse the existing chandra admin auth flow (Bearer JWT in `Authorization` header).

### 9.1 Information Architecture

```
/admin (existing chandra admin)
└── /production (new)
    ├── Dashboard (home)
    ├── Imports
    │   ├── Upload Orders
    │   ├── Upload WIP
    │   └── Import History
    ├── Tracking
    │   ├── Orders (primary view — list grouped by OrderNoWithoutSrNo)
    │   ├── Order Detail (drill-in — all pieces in one order)
    │   ├── JobCard Detail (drill into a single piece)
    │   └── All Pieces (advanced flat view — filterable across orders)
    ├── Planning
    │   ├── Capacity Dashboard
    │   ├── New Order Calculator
    │   └── What-If Simulator
    ├── Inventory
    │   ├── Diamond Master
    │   ├── Requirements vs Stock
    │   ├── Diamond Ledger
    │   ├── Metal Ledger
    │   └── Purchase Orders
    ├── Material Loss
    ├── Alerts
    ├── Analytics
    └── Settings
        ├── Stages
        ├── Cells & Seats
        ├── Calendar
        ├── Column Maps
        └── Product BOM
```

### 9.2 Pages (detailed)

#### Page: Production Home Dashboard
**Purpose:** at-a-glance state of production
**Components:**
- KPI cards: open JobCards, late JobCards, today's import status, open critical alerts
- Capacity gauge (current month load %)
- Top 3 bottleneck stages
- Recent alerts list (last 10)
- Quick actions: upload orders, upload WIP, run capacity check
**APIs:** `/dashboards/capacity`, `/dashboards/analytics`, `/alerts?severity=critical&status=open`

#### Page: Upload Orders
**Purpose:** upload Order Excel (`.xlsx`)
**Components:**
- File drop zone — **accept `.xlsx` only**
- Pre-upload preview: parse first 10 rows in browser (using `xlsx` package), show expected pivot result count, warnings
- Submit → progress → result modal (inserted / updated / errored)
- Link to import run detail
**APIs:** `POST /imports/gati-orders` (multipart), `GET /imports/runs/:id`

#### Page: Upload WIP
**Same shape as Upload Orders** (accepts `.xlsx` only). Adds: surface unmapped stage columns, link to Column Maps page to fix.
**APIs:** `POST /imports/gati-wip`, `GET /imports/runs/:id`

#### Page: Import History
**Purpose:** audit trail of all uploads
**Components:**
- Filterable table (date, file type, status, uploader)
- Click row → expand error rows with inline-edit for retry
**APIs:** `GET /imports/runs`, `POST /imports/runs/:id/retry-row`

#### Page: Orders (primary tracking view)
**Purpose:** the operations hub — **list view grouped by `OrderNoWithoutSrNo`**, not by individual piece. This is the default landing page for Tracking.
**Components:**
- Filter bar: status (in-progress / completed / on-hold / late), customer, priority, delivery date, "show only late"
- Sortable list/table — **one row per order**, each row shows:
  - `orderNumber`, `customerCode`, `expectedDeliveryAt` (earliest among pieces)
  - `totalPieces` (count of JobCards), `totalQty` (sum), `completedCount`, `inProgressCount`, `delayedCount`
  - **Progress bar** — completed / total
  - **Stage distribution chips** — rolled-up qty by stage across all pieces (e.g. `[CASTING: 9, FILING: 12, SETTING: 15]`)
  - `worstLatenessDays` (max lateness across pieces in this order)
  - Status pill, priority badge, row color (red = late, yellow = at risk, green = on track)
- Click a row → Order Detail
- Bulk actions: change priority for whole order
**APIs:** `GET /dashboards/orders?...`

#### Page: Order Detail
**Purpose:** drill into one order — see all its line items (JobCards)
**Components:**
- Order header card: order#, customer, delivery date, total pieces, total qty, completed qty, status, priority
- Aggregate progress bar
- **Stage distribution chart** — bar chart of qty currently at each stage across all pieces in the order
- Table of all JobCards in this order:
  - `gatiPieceCode` (e.g. `/0112/1`), `styleNo`, `size`, `totalQty`
  - Current `stageDistribution` chips
  - Days-in-current-stage, lateness flag
  - QC events count
  - Status pill
- Click a JobCard row → JobCard Detail
- Filter within order: by stage, by lateness
**APIs:** `GET /dashboards/orders/:orderNumber`

#### Page: All Pieces (advanced flat view)
**Purpose:** cross-order filtering — e.g. "show me every piece stuck at SETTING regardless of order"
**Components:**
- Filter bar: stage, cell, customer, priority, delivery date, lateness, order#
- Flat sortable table — one row per JobCard (gatiPieceCode, order#, styleNo, customer, stageDistribution, days-in-stage, delivery, status)
- Click row → JobCard Detail
**APIs:** `GET /job-cards?...`

#### Page: JobCard Detail
**Purpose:** drill into one line item
**Components:**
- Header card: gatiPieceCode, status pill, priority badge, expected delivery, customer
- Diamond specs accordion (multiple specs supported)
- Metal info card
- Findings card (received toggle)
- Current stage distribution (chips)
- **Timeline of StageMovements** (vertical, with durations, QC results, weight in/out, attachments)
- Material loss summary (gold + stones)
- Action buttons: change priority, manual movement override
**APIs:** `GET /job-cards/:id` (or `/job-cards/by-code?code=` for slash-containing codes), `GET /job-cards/:id/movements`, `PUT /job-cards/:id/findings`, `PUT /job-cards/:id/priority`

#### Page: Capacity Dashboard
**Purpose:** Flow 2 visualization
**Components:**
- Gauge: month load %
- Per-stage table: stageCode, queueUnits, capacityPerDay, queueDays, isBottleneck, activeCells
- Bottleneck banner: list current bottlenecks
- Sparkline per stage: queueDays trend over last 30 days
**APIs:** `GET /dashboards/capacity`

#### Page: New Order Calculator
**Purpose:** "can we accept this order?"
**Components:**
- Form: totalQty, stoneCount, metalWeight grams, requires-rhodium, requires-linking, expectedDeliveryAt, priority
- Submit → result panel: estimatedCompletionAt, leadTimeDays, bottleneckStage, capacityStatus pill, overtime hours, on-time probability bar, critical path visualization, warnings
**APIs:** `POST /planning/check`

#### Page: What-If Simulator
**Purpose:** scenario planning
**Components:**
- Left: scenario builder with sliders/inputs
  - Add cells per stage (numeric)
  - Overtime hours/day
  - Add hypothetical new order (sub-form)
  - Re-prioritize existing JobCards (multi-select)
- Right: impact panel
  - Bar chart of order completion-date deltas
  - List of orders saved / slipping
  - Cost delta
- Save scenario / load saved scenario
**APIs:** `POST /what-if/simulate`, `POST /what-if/scenarios`, `GET /what-if/scenarios`

#### Page: Diamond Master
**Purpose:** manage Diamond SKUs
**Components:**
- Table with all SKUs (auto-seeded)
- Inline-edit: cost, reorderThreshold, reorderQty, leadTime, supplier
- Filter by gSize / sieve / mm
**APIs:** `GET/POST/PUT/DELETE /inventory/diamonds`

#### Page: Requirements vs Stock
**Purpose:** Flow 3 main view
**Components:**
- Table: code, gSize/sieve/mm, onHand, allocated, available, required, delta (color: red if negative), reorderSuggested, status pill
- Filter: only show shortage / low / all
- Action button: "Generate POs" — creates auto-PO drafts for all shortages
**APIs:** `GET /inventory/requirements`, `POST /purchase-orders` (bulk create)

#### Page: Diamond Ledger (per SKU)
**Purpose:** audit trail
**Components:**
- Selector: pick a diamond SKU
- Table of ledger entries: date, type, qty (signed), reference doc, jobCard link, notes
- Running balance column
- Add Entry form (modal): GRN, adjustment, return
**APIs:** `GET /inventory/diamonds-ledger/by-code?code=` (codes contain `|`), `POST /inventory/ledger`

#### Page: Metal Ledger
**Components:**
- Filter: by JobCard, metal type, stage
- Table: date, metalType, movement, weight (signed), jobCard, stage, notes
- Add entry form
**APIs:** `GET /inventory/metal-ledger/by-job-card/:id`, `POST /inventory/metal-ledger`

#### Page: Purchase Orders
**Purpose:** auto-PO inbox
**Components:**
- Tabs: Drafts, Approved, Sent, Received, Cancelled
- Table: PO#, supplier, lineCount, totalCost, triggeredBy alert link, createdAt
- Detail modal: edit lines, qty, supplier; approve/cancel buttons
**APIs:** `GET /purchase-orders`, `PUT /purchase-orders/:id`, `POST .../approve`, `POST .../cancel`

#### Page: Material Loss
**Purpose:** loss accounting
**Components:**
- Tabs: Summary, By Stage, By Cell, By JobCard
- Date range picker
- Charts:
  - Total gold issued vs returned vs final-piece-weight (bar)
  - Loss % trend over time (line)
  - Loss by stage (horizontal bar)
  - Loss by cell (horizontal bar, helps spot bad cells)
  - Top 10 lossiest JobCards (table)
**APIs:** `GET /material-loss/summary`, `/by-stage`, `/by-cell`, `/by-job-card/:id`

#### Page: Alerts
**Components:**
- Filter: severity, type, status (open / acknowledged / resolved)
- Table with action buttons (acknowledge, resolve)
- Click row → linked subject (JobCard / Stage / Diamond)
**APIs:** `GET /alerts`, `POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve`

#### Page: Analytics
**Components:**
- KPIs: on-time delivery %, avg cycle time, total losses last 30d
- Charts: cycle-time trend per stage, predicted-vs-actual accuracy, bottleneck frequency, anomaly highlights
- Date range
**APIs:** `GET /dashboards/analytics?period=`

#### Settings: Stages
**Components:**
- Table: code, name, expectedHours, dependencies, parallelGroup, unitOfWork, isOptional, isTerminal, displayOrder, active
- Reorder via drag (sets displayOrder)
- Dependency graph view (visual)
- Add/edit/delete (with safety: can't delete a stage in use)
**APIs:** `GET/POST/PUT/DELETE /stages`

#### Settings: Cells & Seats
**Components:**
- Cells table with stageCodes (multi-select)
- Each cell row expandable to seats list
- Visual cell map (optional)
**APIs:** `GET/POST/PUT/DELETE /cells`, `/seats`

#### Settings: Calendar
**Components:**
- Shifts CRUD (name, start/end times)
- Holiday date picker
- Weekend selector
**APIs:** `GET/PUT /calendar`

#### Settings: Column Maps
**Purpose:** the most important config screen — admin maps GatiSOFT's columns to the system's stage codes
**Components:**
- Two tabs: Orders Columns, WIP Columns
- WIP table: rawColumn → stageCode (autocomplete from StageDefinitions) → cellCode (autocomplete from Cells)
- Aliases section: editable lists for diamond/metal/finding `RawAliasName` aliases
- "Detect new columns" button — re-parses last upload to find unmapped columns
**APIs:** `GET/PUT /column-maps/orders`, `GET/PUT /column-maps/wip`

#### Settings: Product BOM
**Components:**
- Table: styleNo, expected diamond specs, expected metal grams + type
- Used for cross-checking imported orders (warn if order has 2× expected stones)
**APIs:** `GET/POST/PUT/DELETE /product-bom`

### 9.3 Cross-cutting UI elements

- **Top nav:** chandra existing nav + new "Production" entry with sub-nav
- **Right-side alerts drawer:** persistent, shows latest unresolved critical alerts
- **Global toast** for alert pushes (poll `/alerts?status=open` every 60s, or use SSE if added later)
- **Pieces unit picker** in capacity views — toggle between `pieces`, `grams`, `stones`
- **Date helpers:** all dates formatted via dayjs; relative-time hints ("3 days late")
- **Confirmation modals** for destructive actions (delete stage, cancel PO)

### 9.4 Permissions

All routes admin-only in v1. Future: introduce `floor` and `ops_manager` roles.

### 9.5 Empty / loading / error states

Every list page: empty state with explanatory copy + CTA to upload first Excel file. Loading skeletons matching the table shape. Error boundary with retry button.

---

## 10. Implementation Roadmap

| Phase | Weeks | Backend deliverables | Frontend deliverables |
|---|---|---|---|
| **0 — Foundation** | 1 | All models under `production-planner/models/`, admin CRUD routes for stages/cells/seats/calendar/column-maps; mount router in server.ts | Settings pages: Stages, Cells, Calendar, Column Maps |
| **1 — Order Intake** | 2 | Order CSV importer with multi-row pivot (1+ diamonds, 1 metal, 0+ findings); idempotent upsert; Diamond auto-seed | Upload Orders page; Import History; Diamond Master page |
| **2 — Tracking & Alerts** | 3–4 | WIP importer with diff logic; alert engine (stuck/delivery/rework/zombie); order-rollup + JobCard + dashboard endpoints | Upload WIP page; **Orders (order-grouped tracking)**, Order Detail, JobCard Detail; All Pieces flat view; Alerts inbox |
| **3 — Capacity Planning + What-If** | 5–7 | Baselines job; bottleneck detection; planning calculator; what-if simulator | Capacity Dashboard; New Order Calculator; What-If Simulator |
| **4 — Inventory + Material Loss + Auto-PO** | 6–8 | Diamond ledger, allocation, requirements; metal ledger; material-loss aggregations; auto-PO trigger | Requirements vs Stock; Ledger pages; Material Loss; Purchase Orders inbox |
| **5 — Anomaly Detection + Analytics** | 9 | Anomaly detector job; baseline-drift alerts; analytics aggregations | Analytics page; analytics widgets on home dashboard |
| **6 — Polish** | 10 | Export-to-Excel for all reports; alert tuning; integration tests on real GatiSOFT files | Empty/error states; mobile-responsive table views; print stylesheets for floor printouts |

Phases 3 and 4 can run in parallel with 2 devs.

---

## 11. Open Items (need user confirmation)

1. **Stage dependency graph** — what must precede what? Likely: CAD → CAM → WAX → CST → GRN → CEN → FIL → PPL → SET → REF → FPL → QC → IGI → FG. Critical-path math depends on this.
2. **Ambiguous WIP columns** — `MDL`, `WFD`, `SAM`, `SPOL`, `SFIL`, `JW`, `Otec`, `ASBL`, `ASBL2` — admin to label during first column-map review.
3. **Diamond clarity/color** — not in current Order CSV. Should diamond SKU key include them? Per-customer default? Per-style default? Currently SKU = `(gSize, sieve, mm)` only.
4. **Late multiplier default** — 2.0 globally, or stage-specific?
5. **Order CSV has no `priority`** — default to "normal" with manual override?
6. **Style code suffixes** — `R10500`, `R10500/5`, `R10500-8` — fuzzy-match to chandra `Product.styleNo` or require exact match? (Read-only against Product.)
7. **Metal alloy nuance** — `G14KT` covers 14kt gold; need separate `metalAlloyDetails` (yellow vs white) for material-loss reports? (May be inferable from style or another field.)
8. **Diamond aliases list** — current sample has only `LABGROWN DIAMOND`. Are there others (e.g. `NATURAL DIAMOND`, `CZ`)? Aliases are configurable but defaults need a list.
9. **Findings row sample** — current sample has none. Need a sample to lock the column-map for findings rows.
10. **Dependency graph cycles** — what's the rework path? When QC fails, does the piece re-enter at a fixed earlier stage, or admin-chosen?

---

## 12. Verification (using the actual sample CSVs)

1. **Order import idempotency**: upload `order data.csv` → assert 36 JobCards created (one per `OrderNo/SrNo`); re-upload → 0 inserts/updates.
2. **Multi-diamond support**: synthesize a test row group with 2 diamond rows + 1 metal → assert JobCard.diamondSpecs has 2 entries.
3. **Findings rows**: synthesize a row group with 1 diamond + 1 metal + 2 finding rows → assert JobCard.findings has 2 entries.
4. **Stones-per-piece math**: assert `/0112/1`'s `stonesPerPiece = round(0.513 / 0.009) = 57`.
5. **Diamond auto-seed**: assert distinct (gSize, sieve, mm) rows from the order are seeded as Diamond SKUs.
6. **WIP import day 1**: upload `what is where.csv` → assert all 36 JobCards have correct `currentStageDistribution`. (E.g. `/0112/1` → `[{ CASTING, C1, qty: 3 }]`.)
7. **WIP import day 2 (simulated)**: change `/0112/1` from CST=3 to CST=0, FIL=3 → assert one StageMovement closed (CST exitedAt set, durationHours computed) and one new (FILING entered, qty=3).
8. **Stuck alert**: backdate `/0112/1`'s CST entry to be older than `expected × 2` → run alert engine → assert `PIECE_STUCK` alert created.
9. **Capacity baselines**: run nightly job → assert `CapacityBaseline` rows for each stage with non-zero data.
10. **Bottleneck discovery**: assert `GET /dashboards/capacity` flags the stage with the largest queue/capacity ratio (data-driven, no flag).
11. **Diamond shortage**: zero out one Diamond's ledger → POST `/inventory/requirements` → assert `delta < 0` for that SKU and `DIAMOND_SHORTAGE` alert fires.
12. **Auto-PO**: assert a `PurchaseOrderDraft` was created with the shortfall qty.
13. **What-if**: simulate adding 1 cell to bottleneck stage → assert at least one JobCard's projected completion advances.
14. **Material loss**: post weights to a StageMovement with weightIn=5g, weightOut=4.9g → assert per-cell loss report shows 0.1g delta.
15. **Anomaly detection**: artificially halve a stage's throughput for 1 day → run detector → assert `BASELINE_DRIFT_SLOW` alert fires.

UAT gate: steps 1, 6, and 7 must round-trip the actual GatiSOFT CSVs with zero data loss before Phases 3+ ship.

---

## 13. Phase 1 Implementation Breakdown — Order Excel Intake (BACKEND)

> **Phase 0 (done):** 18 models, 5 admin CRUD routes (stages/cells/seats/calendar/column-maps), router wired at `/admin/production`, TypeScript compiles clean.
> **Phase 1 (this section):** the Order Excel `.xlsx` upload pipeline + JobCard read APIs + Diamond auto-seed and admin CRUD.

### 13.1 Goals

1. Accept `.xlsx` upload at `POST /admin/production/imports/gati-orders`.
2. Parse → group rows by `(OrderNoWithoutSrNo, OrderItemSrNo)` → pivot the variable row types (1+ diamonds, exactly 1 metal, 0+ findings).
3. Build/upsert one `JobCard` per group, keyed on `gatiPieceCode`. Idempotent on re-upload.
4. Auto-seed the `Diamond` master from every new `(gSize, sieve, diaSizeMM)` encountered.
5. Persist a full audit (`GatiImportRun` with per-row errors and unmapped columns).
6. Expose admin read APIs for JobCards and Diamond master so the frontend can render Phase 1 pages.

**Out of scope for Phase 1:** WIP import (Phase 2), capacity math (Phase 3), inventory ledger / allocations / metal ledger / material loss (Phase 4), alerts engine (Phase 2), what-if (Phase 3), auto-PO (Phase 4).

### 13.2 Behavioral decisions (recommended defaults, push back if wrong)

| Decision | Choice | Reasoning |
|---|---|---|
| Processing model | **Synchronous** — block until done, return run summary | Order files are small (≤ hundreds of rows). Sync keeps the API simple. Easy to swap to a background queue later behind the same endpoint. |
| File archival | **None** — parse in memory, then discard the buffer. `GatiImportRun` keeps the `fileName`, counts, `rowErrors[]`, and timestamps, which is sufficient audit. | We don't need to retain uploaded artifacts. Removes the S3 dependency from the import path entirely. |
| Default column map | **Seeded at startup** — first boot creates a default `GatiColumnMap(fileType="orders")` with the aliases and column mappings derived from the sample CSV | System works out-of-box. Admin can edit via existing `PUT /column-maps/orders`. |
| Order linkage | **Best-effort lookup** — find chandra `Order` by `orderNumber`; if present set `JobCard.chandraOrderId`, else leave null. **Never create a chandra Order.** | Read-only against chandra side. Keeps modules decoupled. |
| Diamond SKU key | `(gSize, sieve, diaSizeMM)` only — `pointer`, `clarity`, `color` stored on the master but not part of the key | Matches §1.5 spec. Clarity/color absent in current sample. |
| Idempotency | Upsert by `gatiPieceCode`; on existing JobCard only mutate **non-key** fields (qty, specs, expectedDeliveryAt) — never overwrite `currentStageDistribution` or `status` (those are owned by Phase 2 WIP import) | Order Excel is the source of intent; WIP is the source of progress. They must not stomp on each other. |
| Re-upload | Same file → 0 inserts, 0 updates (deep equality check on mutable fields) | Idempotency requirement from §12 verification step 1. |
| Date parsing | GatiSOFT format `MM/DD/YYYY` locked in column map config (`dateFormat: "MM/DD/YYYY"`); helper rejects unparseable rows with explicit error | Sample shows `04/14/2026` — US-style. |
| Multer storage | **In-memory** (Buffer) — parsed and discarded; never written to disk or S3 | Stateless, container-safe. |
| Auth | `requireAuth + requireRole("admin")` on every Phase 1 route | Matches Phase 0 pattern. |

### 13.3 Files to create

All paths under [src/production-planner/](src/production-planner/).

#### Services

**`services/integrations/excelParser.ts`** — thin wrapper over `xlsx` package:
```ts
parseWorkbookFromBuffer(buf: Buffer, sheetName?: string): { headers: string[]; rows: Record<string, unknown>[] }
```
Reads from Buffer (works for both `.xlsx` and CSV input — `xlsx` autodetects). Returns first sheet by default. Coerces empty cells to `undefined`.

**`services/integrations/columnMapper.ts`** — pure helpers driven by `GatiColumnMap`:
```ts
classifyRow(rawAliasName: string, aliases: GatiAliasMap): "diamond" | "metal" | "finding" | "unknown"
mapOrderRow(raw: Record<string,unknown>, mapping: GatiOrderColumnEntry[]): Record<string, unknown>
parseGatiDate(s: string): Date | null   // MM/DD/YYYY
toNumber(v: unknown): number | null
```

**`services/integrations/gatiOrdersAdapter.ts`** — the orchestrator. Public:
```ts
ingestOrdersFile(input: {
  buffer: Buffer;
  fileName: string;
  uploadedBy?: Types.ObjectId;
}): Promise<GatiImportRunDocument>
```
Logic mirrors §2.1 pivot algorithm exactly. Steps:
1. Create `GatiImportRun(status="processing")`.
2. Parse workbook. Skip trailing totals row (no `OrderNoWithoutSrNo`).
3. Group rows by `${OrderNoWithoutSrNo}/${OrderItemSrNo}`.
4. For each group: classify, validate (≥1 diamond, exactly 1 metal), build JobCard payload.
5. For each new `(gSize, sieve, diaSizeMM)` → call `diamondSeedService.findOrCreate`.
6. Call `jobCardService.upsertFromOrderImport` → returns `{ action: "inserted" | "updated" | "noop" }`.
7. Accumulate counts, errors, unmappedColumns.
8. Finalize run as `complete` (or `failed` if a fatal exception).

**`services/production/jobCardService.ts`** — Phase 1 scope only:
```ts
upsertFromOrderImport(payload: JobCardImportPayload): Promise<{ doc: JobCardDocument; action: "inserted"|"updated"|"noop" }>
listJobCards(query): Promise<{ items: JobCardDocument[]; total: number }>
getJobCardByPieceCode(code: string): Promise<JobCardDocument | null>
setFindingsReceived(code: string, received: boolean): Promise<JobCardDocument | null>
setPriority(code: string, priority: PriorityLevel): Promise<JobCardDocument | null>
```
`upsertFromOrderImport` does deep-equality on the mutable subset to return `"noop"` when nothing changed — that's how re-uploads stay 0/0.

**`services/inventory/diamondSeedService.ts`**:
```ts
findOrCreateDiamond(spec: { gSize; sieve; diaSizeMM; pointer? }): Promise<DiamondDocument>
```
Builds code via existing `buildDiamondCode()` helper in [models/diamond.ts](src/production-planner/models/diamond.ts), upserts.

**`services/bootstrap/seedDefaultColumnMaps.ts`** — called once at server start:
- If no active `GatiColumnMap(fileType="orders")` exists, create one with:
  - `aliases.diamond = ["LABGROWN DIAMOND", "NATURAL DIAMOND"]`
  - `aliases.metal = ["GOLD", "PLATINUM", "SILVER"]`
  - `aliases.finding = ["FINDING", "FINDINGS"]`
  - `orderColumns` = 15 mappings from sample CSV (OrderDate, OrderNoWithoutSrNo, OrderItemSrNo, OrderQty, ItmPrdDelDate, Customer, RawAliasName, StyleCode_Repeat, ItmItemSizeName, ItemCode, GSize, Size, DiaSizeMM, Pointer, NetWeight)
- Idempotent (skips if one exists, even inactive).

#### Routes

**`routes/importsOrders.ts`** — POST upload, multipart with `multer.memoryStorage()`:
- `POST /imports/gati-orders` — `file` field, runs adapter, returns `{ run: GatiImportRunDocument }`
- `400` if no file, non-`.xlsx`/`.csv`, or > 25 MB

**`routes/importRuns.ts`** — read-only audit:
- `GET /imports/runs?fileType=&status=` — list, newest first, paginated (limit/skip)
- `GET /imports/runs/:id` — full detail with `rowErrors[]` and `unmappedColumns[]`

**`routes/jobCards.ts`** — `gatiPieceCode` contains slashes, so sub-actions key on Mongo `_id` and lookup-by-code uses `?code=`:
- `GET /job-cards?status=&customerCode=&priority=&orderNumber=&deliveryBefore=&isLate=&limit=&skip=`
- `GET /job-cards/by-code?code=<gatiPieceCode>` — lookup by GatiSOFT code
- `GET /job-cards/:id` — lookup by Mongo `_id`
- `PUT /job-cards/:id/findings` — body `{ received: boolean }`
- `PUT /job-cards/:id/priority` — body `{ priority: "normal" | "urgent" | "critical" }`

**`routes/diamonds.ts`** — diamond codes contain `|`, so sub-actions use `?code=`:
- `GET /inventory/diamonds?active=&q=&limit=&skip=` — list (q = substring on code/gSize/sieve)
- `GET /inventory/diamonds/by-code?code=` — single
- `POST /inventory/diamonds` — manual create (rare; auto-seed handles most)
- `PUT /inventory/diamonds/by-code?code=` — fill in cost, threshold, leadTime, supplier, clarity, color
- `DELETE /inventory/diamonds/by-code?code=` — soft delete (`active=false`)

#### Router updates

[production-planner/index.ts](src/production-planner/index.ts) — register the new sub-routers:
```ts
router.use(importsOrdersRouter);
router.use(importRunsRouter);
router.use(jobCardsRouter);
router.use(diamondsRouter);
```

#### Server bootstrap

[src/server.ts](src/server.ts) — add bootstrap + scheduler calls in the start sequence after `ensureAdminUser()`:
```ts
await seedDefaultColumnMaps();
startSchedulers();   // (added in Phase 5)
```
And call `stopSchedulers()` in the shutdown handler.
Plus one mount line in [routes/admin/index.ts](src/routes/admin/index.ts):
```ts
router.use("/production", productionPlannerRouter);
```
Those are the only existing-file edits the whole module needs.

### 13.4 Endpoints summary (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/production/imports/gati-orders` | Upload Order `.xlsx`, sync ingest, return run |
| GET  | `/admin/production/imports/runs` | List import runs |
| GET  | `/admin/production/imports/runs/:id` | Run detail |
| GET  | `/admin/production/job-cards` | Filterable list |
| GET  | `/admin/production/job-cards/by-code?code=` | Lookup by GatiSOFT code (slashes) |
| GET  | `/admin/production/job-cards/:id` | Lookup by Mongo `_id` |
| PUT  | `/admin/production/job-cards/:id/findings` | Toggle findingsReceived |
| PUT  | `/admin/production/job-cards/:id/priority` | Override priority |
| GET  | `/admin/production/inventory/diamonds` | List Diamond SKUs |
| GET  | `/admin/production/inventory/diamonds/by-code?code=` | Single Diamond |
| POST | `/admin/production/inventory/diamonds` | Manual create |
| PUT  | `/admin/production/inventory/diamonds/by-code?code=` | Fill in cost/threshold/etc. |
| DELETE | `/admin/production/inventory/diamonds/by-code?code=` | Soft delete |

### 13.5 Verification (Phase 1 only — re-runs the relevant pieces of §12)

1. Server boots → `seedDefaultColumnMaps` creates a default `orders` map. Assert one exists.
2. Upload sample `order data.xlsx` (convert sample CSV to xlsx for the test) → assert `inserted=36, errored=0, skipped=0`.
3. Assert 36 `JobCard` docs exist with correct `gatiPieceCode` (`CO/REG/26-27/0112/1` … `/36`).
4. Stones math: `/0112/1` → `stoneCountPerPiece = round(0.513 / 0.009) = 57`, `totalStones = 57 × 3 = 171`.
5. Multi-diamond: synthesize a row group with 2 diamond + 1 metal → `JobCard.diamondSpecs.length === 2`, `stoneCountPerPiece` sums.
6. Findings: synthesize a group with 1 diamond + 1 metal + 2 finding rows → `JobCard.findings.length === 2`.
7. Diamond auto-seed: distinct `(gSize, sieve, mm)` in the sample → assert `Diamond` collection has the same set with codes like `+2-6.5 CRD|2-2.5 CRD|1.25`.
8. Idempotent re-upload of the same file → assert `inserted=0, updated=0, skipped=36`.
9. Mutate a JobCard payload (e.g. change `expectedDeliveryAt`) re-upload → assert `inserted=0, updated=1`.
10. Bad row (missing metal): synthesize a group with diamonds only → assert that group lands in `GatiImportRun.rowErrors[]` with a clear reason, but the rest of the file imports.
11. JobCard endpoints: `GET /job-cards?status=planned` returns the 36; `PUT .../findings { received: true }` flips the flag; `PUT .../priority { priority: "urgent" }` updates priority.
12. Diamond endpoints: `GET /inventory/diamonds` returns all seeded SKUs; `PUT` lets admin fill cost/threshold.
13. TypeScript: `npx tsc -p tsconfig.json --noEmit` is clean.

### 13.6 What's deliberately NOT done in Phase 1 (so we don't sprawl)

- No WIP importer, no StageMovements written (Phase 2)
- No alerts (Phase 2)
- No capacity math, no baselines, no planning calculator (Phase 3)
- No DiamondInventoryLedger / DiamondAllocation usage (Phase 4) — model exists from Phase 0 but no service writes to it yet
- No MetalLedger usage (Phase 4)
- No PurchaseOrderDraft / auto-PO (Phase 4)
- No what-if simulator (Phase 3)
- No frontend code (handled by frontend Claude using §9 of this spec)

