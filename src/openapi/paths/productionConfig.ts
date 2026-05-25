import { adminSecured, jsonResp, ref, standardErrors } from "../base";

const codeParam = {
  name: "code",
  in: "path",
  required: true,
  schema: { type: "string" as const },
};
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
 * Production-planner configuration + imports + job-cards + movements + dashboards.
 * (Planning + inventory + alerts are in productionOps.ts.)
 */
export const productionConfigPaths: Record<string, Record<string, unknown>> = {
  // ───── Stages ─────
  "/admin/production/stages": {
    get: {
      tags: ["Production: Stages"],
      summary: "List stage definitions",
      security: adminSecured,
      responses: {
        "200": jsonResp("Stages list", {
          type: "object",
          properties: { stages: { type: "array", items: ref("StageDefinition") } },
        }),
      },
    },
    post: {
      tags: ["Production: Stages"],
      summary: "Create stage",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("StageDefinition") } } },
      responses: { "201": jsonResp("Created", { type: "object", properties: { stage: ref("StageDefinition") } }), ...standardErrors },
    },
  },
  "/admin/production/stages/{code}": {
    get: {
      tags: ["Production: Stages"],
      summary: "Get stage by code",
      security: adminSecured,
      parameters: [codeParam],
      responses: { "200": jsonResp("Stage", { type: "object", properties: { stage: ref("StageDefinition") } }), "404": standardErrors["404"] },
    },
    put: {
      tags: ["Production: Stages"],
      summary: "Update stage",
      security: adminSecured,
      parameters: [codeParam],
      requestBody: { required: true, content: { "application/json": { schema: ref("StageDefinition") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: {
      tags: ["Production: Stages"],
      summary: "Delete stage",
      security: adminSecured,
      parameters: [codeParam],
      responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors },
    },
  },

  // ───── Cells ─────
  "/admin/production/cells": {
    get: {
      tags: ["Production: Cells & Seats"],
      summary: "List cells",
      security: adminSecured,
      responses: { "200": jsonResp("Cells list", { type: "object", properties: { cells: { type: "array", items: ref("Cell") } } }) },
    },
    post: {
      tags: ["Production: Cells & Seats"],
      summary: "Create cell",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("Cell") } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/production/cells/{code}": {
    get: { tags: ["Production: Cells & Seats"], summary: "Get cell", security: adminSecured, parameters: [codeParam], responses: { "200": jsonResp("Cell"), "404": standardErrors["404"] } },
    put: {
      tags: ["Production: Cells & Seats"],
      summary: "Update cell",
      security: adminSecured,
      parameters: [codeParam],
      requestBody: { required: true, content: { "application/json": { schema: ref("Cell") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: { tags: ["Production: Cells & Seats"], summary: "Delete cell", security: adminSecured, parameters: [codeParam], responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors } },
  },

  // ───── Seats ─────
  "/admin/production/seats": {
    get: {
      tags: ["Production: Cells & Seats"],
      summary: "List seats (optionally filter by cellCode)",
      security: adminSecured,
      parameters: [qString("cellCode")],
      responses: { "200": jsonResp("Seats list", { type: "object", properties: { seats: { type: "array", items: ref("Seat") } } }) },
    },
    post: {
      tags: ["Production: Cells & Seats"],
      summary: "Create seat",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("Seat") } } },
      responses: { "201": jsonResp("Created"), ...standardErrors },
    },
  },
  "/admin/production/seats/{code}": {
    get: { tags: ["Production: Cells & Seats"], summary: "Get seat", security: adminSecured, parameters: [codeParam], responses: { "200": jsonResp("Seat"), "404": standardErrors["404"] } },
    put: {
      tags: ["Production: Cells & Seats"],
      summary: "Update seat",
      security: adminSecured,
      parameters: [codeParam],
      requestBody: { required: true, content: { "application/json": { schema: ref("Seat") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
    delete: { tags: ["Production: Cells & Seats"], summary: "Delete seat", security: adminSecured, parameters: [codeParam], responses: { "200": jsonResp("Deleted", ref("OkResponse")), ...standardErrors } },
  },

  // ───── Calendar ─────
  "/admin/production/calendar": {
    get: { tags: ["Production: Calendar"], summary: "Get production calendar (singleton)", security: adminSecured, responses: { "200": jsonResp("Calendar", { type: "object", properties: { calendar: ref("ProductionCalendar") } }) } },
    put: {
      tags: ["Production: Calendar"],
      summary: "Update production calendar",
      security: adminSecured,
      requestBody: { required: true, content: { "application/json": { schema: ref("ProductionCalendar") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },

  // ───── Column Maps ─────
  "/admin/production/column-maps/{fileType}": {
    get: {
      tags: ["Production: Column Maps"],
      summary: "Get column map for `orders` or `wip`",
      security: adminSecured,
      parameters: [{ name: "fileType", in: "path", required: true, schema: { type: "string", enum: ["orders", "wip"] } }],
      responses: { "200": jsonResp("Column map", { type: "object", properties: { columnMap: ref("GatiColumnMap") } }) },
    },
    put: {
      tags: ["Production: Column Maps"],
      summary: "Update column map",
      security: adminSecured,
      parameters: [{ name: "fileType", in: "path", required: true, schema: { type: "string", enum: ["orders", "wip"] } }],
      requestBody: { required: true, content: { "application/json": { schema: ref("GatiColumnMap") } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },

  // ───── Imports ─────
  "/admin/production/imports/gati-orders": {
    post: {
      tags: ["Production: Imports"],
      summary: "Upload Order Excel — pivots into JobCards (idempotent)",
      security: adminSecured,
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } } },
      responses: { "200": jsonResp("Import run", { type: "object", properties: { run: ref("GatiImportRun") } }), ...standardErrors },
    },
  },
  "/admin/production/imports/gati-wip": {
    post: {
      tags: ["Production: Imports"],
      summary: "Upload WIP Excel — diffs stage state and writes StageMovements",
      security: adminSecured,
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } } },
      responses: { "200": jsonResp("Import run", { type: "object", properties: { run: ref("GatiImportRun") } }), ...standardErrors },
    },
  },
  "/admin/production/imports/runs": {
    get: {
      tags: ["Production: Import Runs"],
      summary: "List import runs",
      security: adminSecured,
      parameters: [qString("fileType"), qString("status"), qString("limit"), qString("skip")],
      responses: { "200": jsonResp("Paginated runs") },
    },
  },
  "/admin/production/imports/runs/{id}": {
    get: { tags: ["Production: Import Runs"], summary: "Run detail (with rowErrors[])", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Run", { type: "object", properties: { run: ref("GatiImportRun") } }), "404": standardErrors["404"] } },
  },

  // ───── Job Cards ─────
  "/admin/production/job-cards": {
    get: {
      tags: ["Production: Job Cards"],
      summary: "Filterable JobCard list",
      security: adminSecured,
      parameters: [
        qString("status"),
        qString("customerCode"),
        qString("priority"),
        qString("orderNumber"),
        qString("deliveryBefore"),
        qString("isLate"),
        qString("limit"),
        qString("skip"),
      ],
      responses: { "200": jsonResp("Paginated JobCards") },
    },
  },
  "/admin/production/job-cards/by-code": {
    get: {
      tags: ["Production: Job Cards"],
      summary: "Lookup JobCard by GatiSOFT code (slash-containing key)",
      security: adminSecured,
      parameters: [qString("code", "gatiPieceCode (URL-encoded)")],
      responses: { "200": jsonResp("JobCard", { type: "object", properties: { jobCard: ref("JobCard") } }), "404": standardErrors["404"] },
    },
  },
  "/admin/production/job-cards/{id}": {
    get: { tags: ["Production: Job Cards"], summary: "Lookup by Mongo _id", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("JobCard"), "404": standardErrors["404"] } },
  },
  "/admin/production/job-cards/{id}/findings": {
    put: {
      tags: ["Production: Job Cards"],
      summary: "Toggle findingsReceived",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["received"], properties: { received: { type: "boolean" } } } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },
  "/admin/production/job-cards/{id}/priority": {
    put: {
      tags: ["Production: Job Cards"],
      summary: "Update priority",
      security: adminSecured,
      parameters: [idParam("id")],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["priority"], properties: { priority: ref("Priority") } } } } },
      responses: { "200": jsonResp("Updated"), ...standardErrors },
    },
  },
  "/admin/production/job-cards/{id}/movements": {
    get: { tags: ["Production: Movements"], summary: "Full StageMovement timeline for a JobCard", security: adminSecured, parameters: [idParam("id")], responses: { "200": jsonResp("Movements", { type: "object", properties: { movements: { type: "array", items: ref("StageMovement") } } }) } },
  },
  "/admin/production/movements": {
    get: {
      tags: ["Production: Movements"],
      summary: "Filterable movement list",
      security: adminSecured,
      parameters: [
        qString("stageCode"),
        qString("cellCode"),
        qString("gatiPieceCode"),
        qString("from"),
        qString("to"),
        qString("open", "Only open movements when true"),
        qString("limit"),
        qString("skip"),
      ],
      responses: { "200": jsonResp("Paginated movements") },
    },
  },

  // ───── Dashboards ─────
  "/admin/production/dashboards/orders": {
    get: {
      tags: ["Production: Dashboards"],
      summary: "Primary tracking view — orders rolled up from JobCards",
      security: adminSecured,
      parameters: [qString("status"), qString("customerCode"), qString("priority"), qString("deliveryBefore"), qString("isLate")],
      responses: { "200": jsonResp("Order rollups", { type: "object", properties: { items: { type: "array", items: ref("OrderRollup") }, total: { type: "integer" } } }) },
    },
  },
  "/admin/production/dashboards/orders/{orderNumber}": {
    get: {
      tags: ["Production: Dashboards"],
      summary: "Order drill-in (header + all JobCards in the order)",
      security: adminSecured,
      parameters: [{ name: "orderNumber", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": jsonResp("Drill-in"), "404": standardErrors["404"] },
    },
  },
  "/admin/production/dashboards/capacity": {
    get: {
      tags: ["Production: Dashboards"],
      summary: "Capacity dashboard (per-stage queue + bottlenecks + month-load)",
      security: adminSecured,
      responses: { "200": jsonResp("Capacity snapshot", { type: "object", properties: { stages: { type: "array", items: ref("StageQueueInfo") }, bottlenecks: { type: "array", items: ref("StageQueueInfo") }, monthLoad: { type: "object", additionalProperties: true } } }) },
    },
  },
  "/admin/production/dashboards/analytics": {
    get: {
      tags: ["Production: Dashboards"],
      summary: "Analytics snapshot (KPIs + trends)",
      security: adminSecured,
      parameters: [qString("from"), qString("to")],
      responses: { "200": jsonResp("Analytics snapshot") },
    },
  },
};
