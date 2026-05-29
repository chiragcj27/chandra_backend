import { Cell } from "../../models/cell";
import { GatiColumnMap } from "../../models/gatiColumnMap";
import {
  DEFAULT_ALIASES,
  DEFAULT_ORDER_COLUMNS,
  DEFAULT_WIP_COLUMNS,
} from "./columnMapDefaults";

/**
 * Standard cells used across all stages.
 * C1 = primary worktable, C2 = second worktable, C3 = overflow / third worktable.
 */
const DEFAULT_CELLS = [
  { code: "C1", name: "Cell 1", stageCodes: [] },
  { code: "C2", name: "Cell 2", stageCodes: [] },
  { code: "C3", name: "Cell 3", stageCodes: [] },
];

/**
 * Detect whether the WIP column map is using the legacy hyphen cell-code format
 * (e.g. "FIL-2", "FPL-3") that predates the underscore/numeric format.
 * When detected, the whole wipColumns array is replaced with the current defaults.
 */
function hasLegacyCellCodes(cols: { cellCode: string }[]): boolean {
  return cols.some(c => /^[A-Z]+-\d+$/.test(c.cellCode));
}

/**
 * Seed default configuration on first boot. Idempotent:
 *
 * - Cells: upserts C1/C2/C3 — skips if already present.
 * - Order column map: creates once; skips if an active map already exists.
 * - WIP column map:
 *     • Creates with current defaults if no active map exists.
 *     • Migrates to current defaults if map uses legacy hyphen cell codes.
 *     • Fills defaults if wipColumns is empty.
 *     • Leaves admin-configured maps alone otherwise.
 */
export async function seedDefaultColumnMaps(): Promise<void> {
  // ── 1. Seed cells ──────────────────────────────────────────────────────────
  for (const cell of DEFAULT_CELLS) {
    const exists = await Cell.findOne({ code: cell.code });
    if (!exists) {
      await Cell.create(cell);
    }
  }

  // ── 2. Seed order column map ───────────────────────────────────────────────
  const existingOrders = await GatiColumnMap.findOne({ fileType: "orders", active: true });
  if (!existingOrders) {
    await GatiColumnMap.create({
      fileType: "orders",
      version: 1,
      aliases: DEFAULT_ALIASES,
      orderColumns: DEFAULT_ORDER_COLUMNS.map((c) => ({ ...c })),
      wipColumns: [],
      active: true,
    });
  } else {
    const hasAliases =
      existingOrders.aliases.diamond.length > 0 ||
      existingOrders.aliases.metal.length > 0 ||
      existingOrders.aliases.finding.length > 0;
    if (!hasAliases) {
      existingOrders.aliases = DEFAULT_ALIASES as typeof existingOrders.aliases;
      if (existingOrders.orderColumns.length === 0) {
        existingOrders.orderColumns = DEFAULT_ORDER_COLUMNS.map((c) => ({ ...c })) as typeof existingOrders.orderColumns;
      }
      await existingOrders.save();
    }
  }

  // ── 3. Seed WIP column map ─────────────────────────────────────────────────
  const existingWip = await GatiColumnMap.findOne({ fileType: "wip", active: true });

  if (!existingWip) {
    await GatiColumnMap.create({
      fileType: "wip",
      version: 1,
      aliases: DEFAULT_ALIASES,
      orderColumns: [],
      wipColumns: DEFAULT_WIP_COLUMNS.map((c) => ({ ...c })),
      active: true,
    });
  } else {
    const hasAliases =
      existingWip.aliases.diamond.length > 0 ||
      existingWip.aliases.metal.length > 0 ||
      existingWip.aliases.finding.length > 0;

    if (!hasAliases) {
      existingWip.aliases = DEFAULT_ALIASES as typeof existingWip.aliases;
    }

    // Migrate legacy hyphen cell codes (FIL-2, FPL-3, etc.) to current format
    const needsMigration =
      existingWip.wipColumns.length === 0 ||
      hasLegacyCellCodes(existingWip.wipColumns as { cellCode: string }[]);

    if (needsMigration) {
      existingWip.wipColumns = DEFAULT_WIP_COLUMNS.map((c) => ({ ...c })) as typeof existingWip.wipColumns;
    }

    if (!hasAliases || needsMigration) {
      await existingWip.save();
    }
  }
}
