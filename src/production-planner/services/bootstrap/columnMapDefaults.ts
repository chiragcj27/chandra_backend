/**
 * Canonical default values for GatiColumnMap documents.
 * Imported by both seedDefaultColumnMaps (boot seeding) and the adapters
 * (fallback creation when the DB was wiped without a server restart).
 */

export const DEFAULT_ALIASES = {
  diamond: ["LABGROWN DIAMOND", "NATURAL DIAMOND", "DIAMOND", "LAB GROWN DIAMOND"],
  metal: ["GOLD", "PLATINUM", "SILVER"],
  finding: ["FINDING", "FINDINGS"],
};

export const DEFAULT_ORDER_COLUMNS = [
  { rawColumn: "OrderDate",          fieldPath: "orderedAt" },
  { rawColumn: "OrderNoWithoutSrNo", fieldPath: "orderNumber",    required: true },
  { rawColumn: "ItmPrdDelDate",      fieldPath: "expectedDeliveryAt" },
  { rawColumn: "OrderQty",           fieldPath: "totalQty" },
  { rawColumn: "OrderItemSrNo",      fieldPath: "orderItemSrNo",  required: true },
  { rawColumn: "Customer",           fieldPath: "customerCode" },
  { rawColumn: "RawAliasName",       fieldPath: "_rowKind",       required: true },
  { rawColumn: "StyleCode_Repeat",   fieldPath: "styleNo" },
  { rawColumn: "ItmItemSizeName",    fieldPath: "size" },
  { rawColumn: "ItemCode",           fieldPath: "_itemCode" },
  { rawColumn: "GSize",              fieldPath: "_diamond.gSize" },
  { rawColumn: "Size",               fieldPath: "_diamond.sieve" },
  { rawColumn: "DiaSizeMM",          fieldPath: "_diamond.diaSizeMM" },
  { rawColumn: "Pointer",            fieldPath: "_diamond.pointer" },
  { rawColumn: "NetWeight",          fieldPath: "_netWeight" },
];

export const DEFAULT_WIP_COLUMNS = [
  { rawColumn: "WAX",   stageCode: "WAX",           cellCode: "C1" },
  { rawColumn: "WSET",  stageCode: "WAX_SET",        cellCode: "C1" },
  { rawColumn: "GRN",   stageCode: "GRN",            cellCode: "C1" },
  { rawColumn: "DIA",   stageCode: "DIA_SET",         cellCode: "C1" },
  { rawColumn: "CEN",   stageCode: "CENTERING",      cellCode: "C1" },
  { rawColumn: "CST",   stageCode: "CASTING",        cellCode: "C1" },
  { rawColumn: "FIL",   stageCode: "FILING",         cellCode: "C1" },
  { rawColumn: "FIL-2", stageCode: "FILING",         cellCode: "C2" },
  { rawColumn: "FIL-3", stageCode: "FILING",         cellCode: "C3" },
  { rawColumn: "PPL",   stageCode: "PRE_POLISH",     cellCode: "C1" },
  { rawColumn: "PPL-2", stageCode: "PRE_POLISH",     cellCode: "C2" },
  { rawColumn: "SET",   stageCode: "SETTING",        cellCode: "C1" },
  { rawColumn: "REF",   stageCode: "REFINING",       cellCode: "C1" },
  { rawColumn: "FPL",   stageCode: "FINAL_POLISH",   cellCode: "C1" },
  { rawColumn: "FPL2",  stageCode: "FINAL_POLISH",   cellCode: "C2" },
  { rawColumn: "FG",    stageCode: "FINISHED_GOODS", cellCode: "C1" },
  { rawColumn: "FG 2",  stageCode: "FINISHED_GOODS", cellCode: "C2" },
  { rawColumn: "QC",    stageCode: "QC",             cellCode: "C1" },
  { rawColumn: "CAD",   stageCode: "CAD",            cellCode: "C1" },
  { rawColumn: "CAM",   stageCode: "CAM",            cellCode: "C1" },
  { rawColumn: "Otec",  stageCode: "OTEC",           cellCode: "C1" },
  { rawColumn: "HOLD",  stageCode: "HOLD",           cellCode: "C1" },
  { rawColumn: "IGI",   stageCode: "IGI",            cellCode: "C1" },
  { rawColumn: "MDL",   stageCode: "MDL",            cellCode: "C1" },
  { rawColumn: "WFD",   stageCode: "WFD",            cellCode: "C1" },
];
