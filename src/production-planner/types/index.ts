/**
 * Shared types for the production-planner module.
 * Mongoose document interfaces live alongside their schemas in models/.
 * This file holds lightweight literal types and shared shapes only.
 */

export const UNIT_OF_WORK = ["piece", "grams", "stones"] as const;
export type UnitOfWork = (typeof UNIT_OF_WORK)[number];

export const JOB_CARD_STATUSES = [
  "pending",
  "planned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
  // Administrative proceed statuses from WIP "Proceed *" columns
  "proceed_cancel",
  "proceed_po",
  "proceed_stock_assign",
  "proceed_manufacturer",
  "proceed_pending",
] as const;
export type JobCardStatus = (typeof JOB_CARD_STATUSES)[number];

export const PRIORITY_LEVELS = ["normal", "urgent", "critical"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const QC_RESULTS = ["pass", "fail", "rework"] as const;
export type QcResult = (typeof QC_RESULTS)[number];

export const DIAMOND_LEDGER_TYPES = [
  "receipt",
  "allocation",
  "consumption",
  "return",
  "adjustment",
  "loss",
] as const;
export type DiamondLedgerType = (typeof DIAMOND_LEDGER_TYPES)[number];

export const METAL_LEDGER_TYPES = ["issue", "return", "loss", "adjustment"] as const;
export type MetalLedgerType = (typeof METAL_LEDGER_TYPES)[number];

export const ALLOCATION_STATUSES = ["active", "released", "completed"] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_TYPES = [
  "PIECE_STUCK",
  "PIECE_SEVERELY_STUCK",
  "DELIVERY_AT_RISK",
  "DELIVERY_OVERDUE",
  "QC_REWORK",
  "BLOCKER_FORMED",
  "DIAMOND_LOW_STOCK",
  "DIAMOND_SHORTAGE",
  "DIAMOND_IMMINENT_SHORTAGE",
  "MATERIAL_LOSS_SPIKE",
  "BASELINE_DRIFT_SLOW",
  "BASELINE_DRIFT_FAST",
  "STAGE_STALE",
  "STAGE_SLOW",
  "ZOMBIE_ORDER",
  "MASS_REWORK",
  "MONTH_LOAD_HIGH",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SUBJECT_TYPES = ["jobCard", "stage", "cell", "diamond", "order"] as const;
export type AlertSubjectType = (typeof ALERT_SUBJECT_TYPES)[number];

export const IMPORT_FILE_TYPES = ["orders", "wip"] as const;
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number];

export const IMPORT_RUN_STATUSES = ["pending", "processing", "complete", "failed"] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const PO_STATUSES = ["draft", "approved", "sent", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const ORDER_AGGREGATE_STATUSES = [
  "pending",
  "planned",
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
] as const;
export type OrderAggregateStatus = (typeof ORDER_AGGREGATE_STATUSES)[number];

/** Distribution entry on a JobCard: how many pieces are at a given (stage, cell). */
export interface StageDistributionEntry {
  stageCode: string;
  cellCode: string;
  qty: number;
}

/** One distinct diamond spec on a JobCard. A JobCard can have many. */
export interface DiamondSpec {
  gSize: string;
  sieve: string;
  diaSizeMM: number;
  pointer: number;
  totalCaratsPerPiece: number;
  stonesPerPiece: number;
}

/** Findings (clasps, posts, etc.) attached to a JobCard. */
export interface FindingEntry {
  code: string;
  qty: number;
}

/** Per-row error captured during a GatiSOFT import run. */
export interface ImportRowError {
  row: number;
  reason: string;
  raw?: Record<string, unknown>;
}
