/**
 * Base OpenAPI document: info, servers, tags, security schemes, and reusable
 * component schemas. Path operations are split into siblings under `./paths/`
 * and assembled in `./openapi.ts`.
 */

export const info = {
  title: "Chandra Backend API",
  version: "1.0.0",
  description: [
    "Complete API surface for `chandra_backend`.",
    "",
    "Two functional areas:",
    "1. **Chandra core** — auth, catalog (categories, subcategories, products), banners, client orders, admin order workflow, bulk-order parser, S3 uploads, featured collections, search.",
    "2. **Production Planner** — under `/admin/production`. Order Excel intake, WIP tracking, capacity planning, what-if simulator, diamond inventory + auto-PO, material-loss accounting, alerts + anomaly detection.",
    "",
    "All admin routes require a JWT issued by `POST /admin/auth/login`. Client routes require a JWT issued by `POST /auth/login`.",
  ].join("\n"),
} as const;

export const servers = [
  { url: "/", description: "Current host" },
  { url: "http://localhost:3000", description: "Local dev" },
];

export const tags = [
  // Public / client
  { name: "Health", description: "Liveness probe" },
  { name: "Auth (Client)", description: "Client account login + session" },
  { name: "Auth (Admin)", description: "Admin login" },
  { name: "Catalog (Public)", description: "Public catalog — categories, subcategories, products, stone shapes" },
  { name: "Banners (Public)", description: "Active banners for storefront" },
  { name: "Featured Collections (Public)", description: "Featured collections for storefront" },
  { name: "Search", description: "Cross-catalog search" },
  { name: "Clients (Public)", description: "Client profile lookups" },
  { name: "Orders (Client)", description: "Client-facing order placement + history" },
  { name: "Bulk Orders", description: "Audio / text / Excel parsing to structured orders" },

  // Admin core
  { name: "Admin: Clients", description: "Admin management of client accounts" },
  { name: "Admin: Catalog", description: "Categories, subcategories, profiles, products, stone shapes" },
  { name: "Admin: Banners", description: "Banner CRUD" },
  { name: "Admin: Featured Collections", description: "Featured collections + items" },
  { name: "Admin: Orders", description: "Admin order workflow + invoices" },
  { name: "Admin: Uploads", description: "S3 presign + library management" },

  // Production planner — config
  { name: "Production: Stages", description: "Stage definitions" },
  { name: "Production: Cells & Seats", description: "Cells (many-to-many with stages) and Seats" },
  { name: "Production: Calendar", description: "Working hours, shifts, holidays" },
  { name: "Production: Column Maps", description: "GatiSOFT Excel column mappings" },

  // Production planner — pipeline
  { name: "Production: Imports", description: "Order + WIP Excel uploads" },
  { name: "Production: Import Runs", description: "Audit trail of every upload" },
  { name: "Production: Job Cards", description: "Per-piece production records" },
  { name: "Production: Movements", description: "Stage transition log" },
  { name: "Production: Dashboards", description: "Order-grouped tracking + analytics" },
  { name: "Production: Planning", description: "Capacity baselines + lead-time calculator" },
  { name: "Production: What-If", description: "Scenario simulator" },

  // Production planner — inventory
  { name: "Production: Diamonds", description: "Diamond SKU master" },
  { name: "Production: Inventory Ledger", description: "Append-only diamond stock ledger" },
  { name: "Production: Allocations", description: "Soft reservations + consumption" },
  { name: "Production: Requirements", description: "Stock vs demand vs delta" },
  { name: "Production: Metal Ledger", description: "Gold issue / return per JobCard" },
  { name: "Production: Material Loss", description: "Gold + stone loss aggregations" },
  { name: "Production: Purchase Orders", description: "Auto-PO drafts and approval workflow" },

  // Production planner — alerts
  { name: "Production: Alerts", description: "Alert inbox + manual sweep trigger" },
  { name: "Production: Anomalies", description: "Anomaly detector preview" },
];

export const securitySchemes = {
  bearerAuth: {
    type: "http" as const,
    scheme: "bearer" as const,
    bearerFormat: "JWT",
    description: "Bearer JWT from /auth/login (client role) or /admin/auth/login (admin role).",
  },
};

// ───────────────────────────────────────────────────────────────────
// Reusable component schemas
// ───────────────────────────────────────────────────────────────────

const ObjectId = { type: "string", pattern: "^[0-9a-fA-F]{24}$", example: "660f1b2c3d4e5f6a7b8c9d0e" };
const DateTime = { type: "string", format: "date-time" };
const Email = { type: "string", format: "email" };

export const schemas = {
  // Envelopes
  ErrorResponse: {
    type: "object",
    properties: { error: { type: "string", example: "Server error" } },
    required: ["error"],
  },
  OkResponse: {
    type: "object",
    properties: { ok: { type: "boolean", example: true } },
    required: ["ok"],
  },
  PaginationInfo: {
    type: "object",
    properties: {
      total: { type: "integer" },
      limit: { type: "integer" },
      skip: { type: "integer" },
    },
  },

  // Primitives
  ObjectId,
  DateTime,
  Email,

  // Enums
  Priority: { type: "string", enum: ["normal", "urgent", "critical"] },
  JobCardStatus: {
    type: "string",
    enum: ["planned", "in_progress", "on_hold", "completed", "cancelled"],
  },
  QcResult: { type: "string", enum: ["pass", "fail", "rework"] },
  UnitOfWork: { type: "string", enum: ["piece", "grams", "stones"] },
  AlertSeverity: { type: "string", enum: ["info", "warning", "critical"] },
  AlertSubjectType: {
    type: "string",
    enum: ["jobCard", "stage", "cell", "diamond", "order"],
  },
  PoStatus: {
    type: "string",
    enum: ["draft", "approved", "sent", "received", "cancelled"],
  },
  ImportFileType: { type: "string", enum: ["orders", "wip"] },
  ImportRunStatus: {
    type: "string",
    enum: ["pending", "processing", "complete", "failed"],
  },
  DiamondLedgerType: {
    type: "string",
    enum: ["receipt", "allocation", "consumption", "return", "adjustment", "loss"],
  },
  MetalLedgerType: { type: "string", enum: ["issue", "return", "loss", "adjustment"] },
  AllocationStatus: { type: "string", enum: ["active", "released", "completed"] },

  // Auth
  LoginRequest: {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string" },
      password: { type: "string", format: "password" },
    },
  },
  AdminLoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { ...Email },
      password: { type: "string", format: "password" },
    },
  },
  LoginResponse: {
    type: "object",
    properties: {
      token: { type: "string" },
      user: { type: "object", additionalProperties: true },
    },
  },

  // Production: core entities
  DiamondSpec: {
    type: "object",
    properties: {
      gSize: { type: "string", example: "+2-6.5 CRD" },
      sieve: { type: "string", example: "2-2.5 CRD" },
      diaSizeMM: { type: "number", example: 1.25 },
      pointer: { type: "number", example: 0.009 },
      totalCaratsPerPiece: { type: "number", example: 0.513 },
      stonesPerPiece: { type: "integer", example: 57 },
    },
  },
  FindingEntry: {
    type: "object",
    properties: {
      code: { type: "string" },
      qty: { type: "number" },
    },
  },
  StageDistributionEntry: {
    type: "object",
    properties: {
      stageCode: { type: "string", example: "FILING" },
      cellCode: { type: "string", example: "C1" },
      qty: { type: "integer", example: 3 },
    },
  },
  JobCard: {
    type: "object",
    properties: {
      _id: ObjectId,
      gatiPieceCode: { type: "string", example: "CO/REG/26-27/0112/1" },
      orderNumber: { type: "string" },
      orderItemSrNo: { type: "integer" },
      totalQty: { type: "integer" },
      styleNo: { type: "string" },
      size: { type: "string" },
      customerCode: { type: "string" },
      diamondSpecs: { type: "array", items: { $ref: "#/components/schemas/DiamondSpec" } },
      totalStones: { type: "integer" },
      metalType: { type: "string" },
      metalWeightPerPiece: { type: "number" },
      totalMetalWeight: { type: "number" },
      findings: { type: "array", items: { $ref: "#/components/schemas/FindingEntry" } },
      findingsReceived: { type: "boolean" },
      findingsReceivedAt: { ...DateTime },
      priority: { $ref: "#/components/schemas/Priority" },
      expectedDeliveryAt: { ...DateTime },
      status: { $ref: "#/components/schemas/JobCardStatus" },
      currentStageDistribution: {
        type: "array",
        items: { $ref: "#/components/schemas/StageDistributionEntry" },
      },
      plannedCompletionAt: { ...DateTime },
      actualCompletionAt: { ...DateTime },
      orderedAt: { ...DateTime },
      chandraOrderId: ObjectId,
      notes: { type: "string" },
      createdAt: { ...DateTime },
      updatedAt: { ...DateTime },
    },
  },
  StageMovement: {
    type: "object",
    properties: {
      _id: ObjectId,
      jobCardId: ObjectId,
      gatiPieceCode: { type: "string" },
      fromStageCode: { type: "string" },
      toStageCode: { type: "string" },
      cellCode: { type: "string" },
      cellId: ObjectId,
      seatId: ObjectId,
      qty: { type: "integer" },
      enteredAt: { ...DateTime },
      exitedAt: { ...DateTime },
      durationHours: { type: "number" },
      qcResult: { $ref: "#/components/schemas/QcResult" },
      rejectionReason: { type: "string" },
      weightInGrams: { type: "number" },
      weightOutGrams: { type: "number" },
      stonesIn: { type: "integer" },
      stonesOut: { type: "integer" },
      notes: { type: "string" },
    },
  },
  StageDefinition: {
    type: "object",
    properties: {
      code: { type: "string", example: "FILING" },
      name: { type: "string", example: "Filing" },
      expectedDurationHours: { type: "number" },
      expectedDurationStdDevHours: { type: "number" },
      dependencies: { type: "array", items: { type: "string" } },
      parallelGroup: { type: "string" },
      unitOfWork: { $ref: "#/components/schemas/UnitOfWork" },
      isOptional: { type: "boolean" },
      isTerminal: { type: "boolean" },
      displayOrder: { type: "integer" },
      active: { type: "boolean" },
      description: { type: "string" },
    },
  },
  Cell: {
    type: "object",
    properties: {
      code: { type: "string", example: "C1" },
      name: { type: "string" },
      stageCodes: { type: "array", items: { type: "string" } },
      description: { type: "string" },
      active: { type: "boolean" },
    },
  },
  Seat: {
    type: "object",
    properties: {
      code: { type: "string" },
      cellId: ObjectId,
      cellCode: { type: "string" },
      stageCodes: { type: "array", items: { type: "string" } },
      active: { type: "boolean" },
    },
  },
  ProductionCalendar: {
    type: "object",
    properties: {
      shifts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            startTime: { type: "string" },
            endTime: { type: "string" },
          },
        },
      },
      weekendDays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } },
      holidayDates: { type: "array", items: { type: "string", format: "date" } },
      defaultDailyHours: { type: "number" },
      active: { type: "boolean" },
    },
  },
  GatiColumnMap: {
    type: "object",
    properties: {
      fileType: { $ref: "#/components/schemas/ImportFileType" },
      version: { type: "integer" },
      aliases: {
        type: "object",
        properties: {
          diamond: { type: "array", items: { type: "string" } },
          metal: { type: "array", items: { type: "string" } },
          finding: { type: "array", items: { type: "string" } },
        },
      },
      orderColumns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rawColumn: { type: "string" },
            fieldPath: { type: "string" },
            required: { type: "boolean" },
          },
        },
      },
      wipColumns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rawColumn: { type: "string" },
            stageCode: { type: "string" },
            cellCode: { type: "string" },
          },
        },
      },
      active: { type: "boolean" },
    },
  },
  GatiImportRun: {
    type: "object",
    properties: {
      _id: ObjectId,
      fileType: { $ref: "#/components/schemas/ImportFileType" },
      fileName: { type: "string" },
      uploadedAt: { ...DateTime },
      uploadedBy: ObjectId,
      rowCount: { type: "integer" },
      inserted: { type: "integer" },
      updated: { type: "integer" },
      skipped: { type: "integer" },
      errored: { type: "integer" },
      rowErrors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            row: { type: "integer" },
            reason: { type: "string" },
            raw: { type: "object", additionalProperties: true },
          },
        },
      },
      unmappedColumns: { type: "array", items: { type: "string" } },
      status: { $ref: "#/components/schemas/ImportRunStatus" },
      startedAt: { ...DateTime },
      finishedAt: { ...DateTime },
      errorMessage: { type: "string" },
    },
  },
  Diamond: {
    type: "object",
    properties: {
      code: { type: "string", example: "+2-6.5 CRD|2-2.5 CRD|1.25" },
      gSize: { type: "string" },
      sieve: { type: "string" },
      diaSizeMM: { type: "number" },
      pointer: { type: "number" },
      clarity: { type: "string" },
      color: { type: "string" },
      costPerStone: { type: "number" },
      reorderThreshold: { type: "integer" },
      reorderQty: { type: "integer" },
      procurementLeadTimeDays: { type: "integer" },
      preferredSupplier: { type: "string" },
      active: { type: "boolean" },
    },
  },
  DiamondInventoryLedgerEntry: {
    type: "object",
    properties: {
      _id: ObjectId,
      diamondCode: { type: "string" },
      movementType: { $ref: "#/components/schemas/DiamondLedgerType" },
      quantity: { type: "integer", description: "Signed quantity" },
      jobCardId: ObjectId,
      gatiPieceCode: { type: "string" },
      referenceDoc: { type: "string" },
      at: { ...DateTime },
      notes: { type: "string" },
    },
  },
  DiamondAllocation: {
    type: "object",
    properties: {
      _id: ObjectId,
      jobCardId: ObjectId,
      gatiPieceCode: { type: "string" },
      diamondCode: { type: "string" },
      quantityAllocated: { type: "integer" },
      quantityConsumed: { type: "integer" },
      status: { $ref: "#/components/schemas/AllocationStatus" },
      allocatedAt: { ...DateTime },
      consumedAt: { ...DateTime },
      releasedAt: { ...DateTime },
    },
  },
  MetalLedgerEntry: {
    type: "object",
    properties: {
      _id: ObjectId,
      metalType: { type: "string" },
      movementType: { $ref: "#/components/schemas/MetalLedgerType" },
      weightGrams: { type: "number" },
      jobCardId: ObjectId,
      gatiPieceCode: { type: "string" },
      stageCode: { type: "string" },
      cellCode: { type: "string" },
      at: { ...DateTime },
      notes: { type: "string" },
    },
  },
  PurchaseOrderDraft: {
    type: "object",
    properties: {
      _id: ObjectId,
      poNumber: { type: "string" },
      supplier: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            diamondCode: { type: "string" },
            qty: { type: "integer" },
            costEstimate: { type: "number" },
            notes: { type: "string" },
          },
        },
      },
      totalCost: { type: "number" },
      status: { $ref: "#/components/schemas/PoStatus" },
      createdAt: { ...DateTime },
      approvedAt: { ...DateTime },
    },
  },
  Alert: {
    type: "object",
    properties: {
      _id: ObjectId,
      type: { type: "string" },
      severity: { $ref: "#/components/schemas/AlertSeverity" },
      subjectType: { $ref: "#/components/schemas/AlertSubjectType" },
      subjectId: { type: "string" },
      message: { type: "string" },
      payload: { type: "object", additionalProperties: true },
      raisedAt: { ...DateTime },
      acknowledgedAt: { ...DateTime },
      resolvedAt: { ...DateTime },
    },
  },
  CapacityBaseline: {
    type: "object",
    properties: {
      stageCode: { type: "string" },
      windowDays: { type: "integer" },
      unitsPerHour: { type: "number" },
      unitsPerDay: { type: "number" },
      stdDev: { type: "number" },
      sampleSize: { type: "integer" },
      lastComputedAt: { ...DateTime },
    },
  },
  StageQueueInfo: {
    type: "object",
    properties: {
      stageCode: { type: "string" },
      stageName: { type: "string" },
      displayOrder: { type: "integer" },
      queueUnits: { type: "integer" },
      activeCells: { type: "integer" },
      capacityPerDay: { type: "number" },
      queueDays: { type: "number" },
      isBottleneck: { type: "boolean" },
      unitsPerDayPerCell: { type: "number" },
      source: { type: "string", enum: ["data", "expected"] },
      expectedDurationHours: { type: "number" },
    },
  },
  OrderSpec: {
    type: "object",
    required: ["totalQty"],
    properties: {
      totalQty: { type: "integer", minimum: 1 },
      totalStones: { type: "integer" },
      totalGrams: { type: "number" },
      requiresStages: { type: "array", items: { type: "string" } },
      excludeStages: { type: "array", items: { type: "string" } },
      expectedDeliveryAt: { ...DateTime },
      priority: { $ref: "#/components/schemas/Priority" },
    },
  },
  PlanningResult: {
    type: "object",
    properties: {
      leadTimeDays: { type: "number" },
      estimatedCompletionAt: { ...DateTime },
      bottleneckStage: { type: "string", nullable: true },
      capacityStatus: {
        type: "string",
        enum: ["WITHIN_RANGE", "AT_LIMIT", "NEEDS_OVERTIME", "NEEDS_HIRE"],
      },
      overtimeHoursNeeded: { type: "number" },
      onTimeProbability: { type: "string", enum: ["high", "medium", "low"] },
      criticalPath: { type: "array", items: { type: "string" } },
      perStage: { type: "array", items: { type: "object", additionalProperties: true } },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
  OrderRollup: {
    type: "object",
    properties: {
      orderNumber: { type: "string" },
      customerCode: { type: "string" },
      expectedDeliveryAt: { ...DateTime },
      totalPieces: { type: "integer" },
      totalQty: { type: "integer" },
      completedCount: { type: "integer" },
      inProgressCount: { type: "integer" },
      onHoldCount: { type: "integer" },
      plannedCount: { type: "integer" },
      delayedCount: { type: "integer" },
      worstLatenessDays: { type: "number" },
      stageDistribution: {
        type: "array",
        items: { $ref: "#/components/schemas/StageDistributionEntry" },
      },
      priority: { $ref: "#/components/schemas/Priority" },
      status: {
        type: "string",
        enum: ["planned", "in_progress", "on_hold", "completed"],
      },
    },
  },
  RequirementRow: {
    type: "object",
    properties: {
      diamondCode: { type: "string" },
      gSize: { type: "string" },
      sieve: { type: "string" },
      diaSizeMM: { type: "number" },
      onHand: { type: "integer" },
      allocated: { type: "integer" },
      available: { type: "integer" },
      required: { type: "integer" },
      delta: { type: "integer" },
      reorderSuggestedQty: { type: "integer" },
      status: { type: "string", enum: ["ok", "low", "shortage", "critical"] },
    },
  },
  // Chandra core entities (sketched — admin frontend already knows them)
  ChandraOrder: {
    type: "object",
    properties: {
      _id: ObjectId,
      orderNumber: { type: "string" },
      clientId: { type: "string" },
      clientName: { type: "string" },
      clientUsername: { type: "string" },
      status: {
        type: "string",
        enum: [
          "order_received",
          "order_confirmed",
          "order_in_production",
          "order_shipped",
          "order_delivered",
          "order_cancelled",
        ],
      },
      items: { type: "array", items: { type: "object", additionalProperties: true } },
      totalAmount: { type: "number" },
      createdAt: { ...DateTime },
    },
    additionalProperties: true,
  },
  Banner: {
    type: "object",
    properties: {
      _id: ObjectId,
      title: { type: "string" },
      imageKey: { type: "string" },
      imageUrl: { type: "string" },
      linkUrl: { type: "string" },
      displayOrder: { type: "integer" },
      isActive: { type: "boolean" },
    },
  },
  Category: {
    type: "object",
    additionalProperties: true,
  },
  Product: {
    type: "object",
    additionalProperties: true,
  },
} as const;

// ───────────────────────────────────────────────────────────────────
// Reusable response builders (kept tiny — the OpenAPI tooling tolerates `any`)
// ───────────────────────────────────────────────────────────────────

type SchemaRef = { $ref: string } | { type: string; [k: string]: unknown };

export function jsonResp(description: string, schema?: SchemaRef): Record<string, unknown> {
  return {
    description,
    content: schema
      ? { "application/json": { schema } }
      : { "application/json": { schema: { type: "object", additionalProperties: true } } },
  };
}

export function errResp(description = "Server error"): Record<string, unknown> {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  };
}

export const standardErrors = {
  "400": errResp("Bad request"),
  "401": errResp("Unauthorized"),
  "403": errResp("Forbidden"),
  "404": errResp("Not found"),
  "500": errResp("Server error"),
} as const;

export const adminSecured = [{ bearerAuth: [] as string[] }];
export const clientSecured = [{ bearerAuth: [] as string[] }];

/** Shorthand for "{ $ref: '#/components/schemas/<name>' }". */
export function ref(name: keyof typeof schemas): { $ref: string } {
  return { $ref: `#/components/schemas/${String(name)}` };
}
