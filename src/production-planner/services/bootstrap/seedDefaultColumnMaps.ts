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
 * Seed default configuration on first boot. Idempotent:
 *
 * - Cells: upserts C1/C2/C3 — skips if already present.
 * - Order column map: creates once; skips if an active map already exists.
 * - WIP column map: creates with all 25 default mappings if no active map exists.
 *   If an active map exists BUT wipColumns is empty (was created by an earlier
 *   server version that shipped an empty map), fills the defaults in.
 *   If wipColumns is already populated (admin has configured it), leaves it alone.
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
    // Fix a map that was created by the old empty fallback (aliases all blank)
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
    // Fix a map that was created by the old empty fallback
    const hasAliases =
      existingWip.aliases.diamond.length > 0 ||
      existingWip.aliases.metal.length > 0 ||
      existingWip.aliases.finding.length > 0;
    if (!hasAliases) {
      existingWip.aliases = DEFAULT_ALIASES as typeof existingWip.aliases;
    }
    if (existingWip.wipColumns.length === 0) {
      existingWip.wipColumns = DEFAULT_WIP_COLUMNS.map((c) => ({ ...c })) as typeof existingWip.wipColumns;
    }
    if (!hasAliases || existingWip.wipColumns.length === 0) {
      await existingWip.save();
    }
  }
  // Admin-configured wipColumns are left alone (aliases still fixed if blank)
}
