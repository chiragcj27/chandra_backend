import { adminSecured, jsonResp, ref, standardErrors } from "../base";

const idParam = (name = "id") => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" as const },
});
const qString = (name: string, description?: string) => ({
  name,
  in: "query",
  required: false,
  schema: { type: "string" as const },
  ...(description ? { description } : {}),
});

/**
 * Production-planner: planning + what-if + diamonds + inventory ledger + allocations
 * + requirements + metal ledger + material-loss + purchase orders + alerts + anomalies.
 */
export const productionOpsPaths: Record<string, Record<string, unknown>> = {
  // ───── Planning ─────
  "/admin/production/planning/baselines/recompute": {
    post: {
      tags: ["Production: Planning"],
      summary: "Manually recompute capacity baselines (also runs every 6h + after WIP imports)",
      security: adminSecured,
      responses: { "200": jsonResp("Baseline summaries", { type: "object", properties: { baselines: { type: "array", items: { type: "object", additionalProperties: true } } } }) },
    },
  },
  "/admin/production/planning/check": {
    post: {
      tags: ["Production: Planning"],
      summary: "Capacity check for a hypothetical new order",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["orderSpec"],
              properties: { orderSpec: ref("OrderSpec") },
            },
          },
        },
      },
      responses: { "200": jsonResp("Planning result", { type: "object", properties: { plan: ref("PlanningResult") } }), ...standardErrors },
    },
  },
  "/admin/production/planning/lead-time": {
    get: {
      tags: ["Production: Planning"],
      summary: "Quick lead-time estimate (no delivery comparison)",
      security: adminSecured,
      parameters: [qString("totalQty"), qString("totalStones"), qString("totalGrams"), qString("priority")],
      responses: { "200": jsonResp("Quick estimate") },
    },
  },

  // ───── What-If ─────
  "/admin/production/what-if/simulate": {
    post: {
      tags: ["Production: What-If"],
      summary: "Simulate hypothetical capacity changes / new orders",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                changes: {
                  type: "object",
                  properties: {
                    addCellsByStage: { type: "object", additionalProperties: { type: "integer" } },
                    overtimeHoursPerDay: { type: "number" },
                    newOrders: { type: "array", items: ref("OrderSpec") },
                    reprioritize: { type: "array", items: { type: "object", properties: { gatiPieceCode: { type: "string" }, newPriority: ref("Priority") } } },
                  },
                },
              },
            },
          },
        },
      },
      responses: { "200": jsonResp("Scenario impact") },
    },
  },
  "/admin/production/what-if/scenarios": {
    get: { tags: ["Production: What-If"], summary: "List saved scenarios", security: adminSecured, responses: { "200": jsonResp("Saved scenarios") } },
    post: {
      tags: ["Production: What-If"],
      summary: "Save a scenario",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" }, inputs: { type: "object", additionalProperties: true }, outputs: { type: "object", additionalProperties: true } } } } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/production/what-if/scenarios/{id}": {
    delete: { tags: ["Production: What-If"], summary: "Delete scenario", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors } },
  },

  // ───── Diamonds ─────
  "/admin/production/inventory/diamonds": {
    get: {
      tags: ["Production: Diamonds"],
      summary: "List Diamond SKUs",
      security: adminSecured,
      parameters: [qString("active"), qString("q"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("Paginated SKUs") },
    },
    post: {
      tags: ["Production: Diamonds"],
      summary: "Manual create (auto-seed handles most via Order imports)",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("Diamond") } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/production/inventory/diamonds/by-code": {
    get: { tags: ["Production: Diamonds"], summary: "Lookup by code (`|`-separated)", security: adminSecured, parameters: [qString("code")], responses: { "200": jsonResp("Diamond"), "404": standardErrors["404"] } },
    put: {
      tags: ["Production: Diamonds"],
      summary: "Update mutable fields (cost / threshold / supplier / clarity / color)",
      security: adminSecured,
      parameters: [qString("code")],
      requestBody: { required: true, content: { "application/json": { schema: ref("Diamond") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: { tags: ["Production: Diamonds"], summary: "Soft-delete (active=false)", security: adminSecured, parameters: [qString("code")], responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors } },
  },

  // ───── Inventory ledger ─────
  "/admin/production/inventory/ledger": {
    post: {
      tags: ["Production: Inventory Ledger"],
      summary: "Append a signed ledger entry (GRN / adjustment / return / etc.)",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["diamondCode", "movementType", "quantity"],
              properties: {
                diamondCode: { type: "string" },
                movementType: ref("DiamondLedgerType"),
                quantity: { type: "integer", description: "Signed quantity" },
                jobCardId: ref("ObjectId"),
                gatiPieceCode: { type: "string" },
                referenceDoc: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "201": jsonResp("Created", { type: "object", properties: { entry: ref("DiamondInventoryLedgerEntry") } }), ...standardErrors },
    },
  },
  "/admin/production/inventory/diamonds/{code}/ledger": {
    get: {
      tags: ["Production: Inventory Ledger"],
      summary: "Per-SKU ledger (single-segment codes only)",
      security: adminSecured,
      parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }, qString("limit")],
      responses: { "200": jsonResp("Ledger entries") },
    },
  },
  "/admin/production/inventory/diamonds-ledger/by-code": {
    get: {
      tags: ["Production: Inventory Ledger"],
      summary: "Per-SKU ledger (works with `|`-containing codes via query param)",
      security: adminSecured,
      parameters: [qString("code"), qString("limit")],
      responses: { "200": jsonResp("Ledger entries") },
    },
  },

  // ───── Allocations ─────
  "/admin/production/inventory/allocations": {
    post: {
      tags: ["Production: Allocations"],
      summary: "Soft-reserve stones for a JobCard (writes balancing ledger entry)",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["jobCardId", "diamondCode", "qty"],
              properties: {
                jobCardId: ref("ObjectId"),
                diamondCode: { type: "string" },
                qty: { type: "integer", minimum: 1 },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "201": jsonResp("Created", { type: "object", properties: { allocation: ref("DiamondAllocation") } }), ...standardErrors },
    },
  },
  "/admin/production/inventory/allocations/{id}/consume": {
    post: {
      tags: ["Production: Allocations"],
      summary: "Convert reservation to consumption",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { qty: { type: "integer" } } } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },
  "/admin/production/inventory/allocations/{id}/release": {
    post: { tags: ["Production: Allocations"], summary: "Release unused reservation", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Released"), ...standardErrors } },
  },
  "/admin/production/inventory/allocations/by-job-card/{id}": {
    get: { tags: ["Production: Allocations"], summary: "All allocations for a JobCard", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Allocations") } },
  },

  // ───── Requirements ─────
  "/admin/production/inventory/requirements": {
    get: {
      tags: ["Production: Requirements"],
      summary: "Requirements vs stock table",
      security: adminSecured,
      parameters: [qString("status", "ok | low | shortage | critical")],
      responses: { "200": jsonResp("Rows", { type: "object", properties: { items: { type: "array", items: ref("RequirementRow") }, total: { type: "integer" } } }) },
    },
  },
  "/admin/production/inventory/shortages": {
    get: { tags: ["Production: Requirements"], summary: "Only shortage / critical rows", security: adminSecured, responses: { "200": jsonResp("Rows") } },
  },

  // ───── Metal ledger ─────
  "/admin/production/inventory/metal-ledger": {
    post: {
      tags: ["Production: Metal Ledger"],
      summary: "Append metal ledger entry (issue / return / loss / adjustment)",
      security: adminSecured,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["metalType", "movementType", "weightGrams"],
              properties: {
                metalType: { type: "string" },
                movementType: ref("MetalLedgerType"),
                weightGrams: { type: "number" },
                jobCardId: ref("ObjectId"),
                gatiPieceCode: { type: "string" },
                stageCode: { type: "string" },
                cellCode: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: { "201": jsonResp("Created", { type: "object", properties: { entry: ref("MetalLedgerEntry") } }), ...standardErrors },
    },
  },
  "/admin/production/inventory/metal-ledger/by-job-card/{id}": {
    get: { tags: ["Production: Metal Ledger"], summary: "Entries + netGrams for a JobCard", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Entries + netGrams") } },
  },

  // ───── Material loss ─────
  "/admin/production/material-loss/summary": {
    get: { tags: ["Production: Material Loss"], summary: "Aggregate loss summary in date range", security: adminSecured, parameters: [qString("from"), qString("to")], responses: { "200": jsonResp("Loss summary") } },
  },
  "/admin/production/material-loss/by-stage": {
    get: { tags: ["Production: Material Loss"], summary: "Loss aggregated per stage", security: adminSecured, parameters: [qString("from"), qString("to")], responses: { "200": jsonResp("Rows") } },
  },
  "/admin/production/material-loss/by-cell": {
    get: { tags: ["Production: Material Loss"], summary: "Loss aggregated per cell", security: adminSecured, parameters: [qString("from"), qString("to")], responses: { "200": jsonResp("Rows") } },
  },
  "/admin/production/material-loss/by-job-card/{id}": {
    get: { tags: ["Production: Material Loss"], summary: "Loss per JobCard", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Loss"), "404": standardErrors["404"] } },
  },

  // ───── Purchase Orders ─────
  "/admin/production/purchase-orders": {
    get: {
      tags: ["Production: Purchase Orders"],
      summary: "List Purchase Orders",
      security: adminSecured,
      parameters: [qString("status"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("Paginated POs") },
    },
    post: {
      tags: ["Production: Purchase Orders"],
      summary: "Manual create",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("PurchaseOrderDraft") } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/production/purchase-orders/{id}": {
    get: { tags: ["Production: Purchase Orders"], summary: "PO detail", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("PO", { type: "object", properties: { purchaseOrder: ref("PurchaseOrderDraft") } }), "404": standardErrors["404"] } },
    put: {
      tags: ["Production: Purchase Orders"],
      summary: "Edit a draft PO",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: ref("PurchaseOrderDraft") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },
  "/admin/production/purchase-orders/{id}/approve": {
    post: { tags: ["Production: Purchase Orders"], summary: "Approve a draft PO", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Approved"), ...standardErrors } },
  },
  "/admin/production/purchase-orders/{id}/cancel": {
    post: { tags: ["Production: Purchase Orders"], summary: "Cancel a PO (not allowed after `received`)", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Cancelled"), ...standardErrors } },
  },
  "/admin/production/purchase-orders/generate-from-shortages": {
    post: { tags: ["Production: Purchase Orders"], summary: "Scan shortages and refresh / create draft POs per supplier (idempotent)", security: adminSecured, responses: { "200": jsonResp("Generation result") } },
  },

  // ───── Alerts ─────
  "/admin/production/alerts": {
    get: {
      tags: ["Production: Alerts"],
      summary: "Alerts inbox",
      security: adminSecured,
      parameters: [qString("severity"), qString("type"), qString("subjectType"), qString("status", "open | acknowledged | resolved"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("Paginated alerts", { type: "object", properties: { items: { type: "array", items: ref("Alert") } } }) },
    },
  },
  "/admin/production/alerts/{id}/acknowledge": {
    post: { tags: ["Production: Alerts"], summary: "Acknowledge an alert", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Acknowledged"), ...standardErrors } },
  },
  "/admin/production/alerts/{id}/resolve": {
    post: { tags: ["Production: Alerts"], summary: "Resolve an alert", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Resolved"), ...standardErrors } },
  },
  "/admin/production/alerts/run": {
    post: { tags: ["Production: Alerts"], summary: "Manually trigger the full alert engine scan", security: adminSecured, responses: { "200": jsonResp("Scan summary") } },
  },

  // ───── Anomalies ─────
  "/admin/production/anomalies/detect": {
    post: { tags: ["Production: Anomalies"], summary: "Preview the anomaly detector's candidates without persisting", security: adminSecured, responses: { "200": jsonResp("Detector summary") } },
  },
};
