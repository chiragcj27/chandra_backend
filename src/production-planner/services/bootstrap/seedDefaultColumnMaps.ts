import { GatiColumnMap } from "../../models/gatiColumnMap";

const DEFAULT_ORDER_COLUMNS = [
  { rawColumn: "OrderDate", fieldPath: "orderedAt" },
  { rawColumn: "OrderNoWithoutSrNo", fieldPath: "orderNumber", required: true },
  { rawColumn: "ItmPrdDelDate", fieldPath: "expectedDeliveryAt" },
  { rawColumn: "OrderQty", fieldPath: "totalQty" },
  { rawColumn: "OrderItemSrNo", fieldPath: "orderItemSrNo", required: true },
  { rawColumn: "Customer", fieldPath: "customerCode" },
  { rawColumn: "RawAliasName", fieldPath: "_rowKind", required: true },
  { rawColumn: "StyleCode_Repeat", fieldPath: "styleNo" },
  { rawColumn: "ItmItemSizeName", fieldPath: "size" },
  { rawColumn: "ItemCode", fieldPath: "_itemCode" },
  { rawColumn: "GSize", fieldPath: "_diamond.gSize" },
  { rawColumn: "Size", fieldPath: "_diamond.sieve" },
  { rawColumn: "DiaSizeMM", fieldPath: "_diamond.diaSizeMM" },
  { rawColumn: "Pointer", fieldPath: "_diamond.pointer" },
  { rawColumn: "NetWeight", fieldPath: "_netWeight" },
] as const;

const DEFAULT_ALIASES = {
  diamond: ["LABGROWN DIAMOND", "NATURAL DIAMOND", "DIAMOND", "LAB GROWN DIAMOND"],
  metal: ["GOLD", "PLATINUM", "SILVER"],
  finding: ["FINDING", "FINDINGS"],
};

/**
 * Seed the default `GatiColumnMap` rows for `orders` and `wip` if none exist yet.
 *
 * - Called from `server.ts` on startup, after Mongo is connected.
 * - Idempotent: skips if an active map already exists for the file type.
 * - Admin can edit either map via `PUT /admin/production/column-maps/:fileType`.
 *
 * The `orders` map ships with the columns observed in the GatiSOFT sample
 * (`order data.csv`); the `wip` map ships empty so the admin reviews each
 * stage-column on first WIP upload (covered in Phase 2).
 */
export async function seedDefaultColumnMaps(): Promise<void> {
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
  }

  const existingWip = await GatiColumnMap.findOne({ fileType: "wip", active: true });
  if (!existingWip) {
    await GatiColumnMap.create({
      fileType: "wip",
      version: 1,
      aliases: DEFAULT_ALIASES,
      orderColumns: [],
      wipColumns: [],
      active: true,
    });
  }
}
