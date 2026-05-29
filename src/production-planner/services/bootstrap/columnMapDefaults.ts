/**
 * Canonical default values for GatiColumnMap documents and StageDefinitions.
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

// Raw column names ARE the cell identifiers (the column header = the work cell).
// stageCode maps to the logical stage; cellCode = the raw column itself so each
// physical work area is uniquely tracked without a separate Cell record.
export const DEFAULT_WIP_COLUMNS = [
  { rawColumn: "WAX",   stageCode: "WAX",           cellCode: "WAX"   },
  { rawColumn: "WSET",  stageCode: "WAX_SET",        cellCode: "WSET"  },
  { rawColumn: "GRN",   stageCode: "GRN",            cellCode: "GRN"   },
  { rawColumn: "DIA",   stageCode: "DIA_SET",         cellCode: "DIA"   },
  { rawColumn: "CEN",   stageCode: "CENTERING",      cellCode: "CEN"   },
  { rawColumn: "CST",   stageCode: "CASTING",        cellCode: "CST"   },
  { rawColumn: "FIL",   stageCode: "FILING",         cellCode: "FIL"   },
  { rawColumn: "FIL-2", stageCode: "FILING",         cellCode: "FIL-2" },
  { rawColumn: "FIL-3", stageCode: "FILING",         cellCode: "FIL-3" },
  { rawColumn: "PPL",   stageCode: "PRE_POLISH",     cellCode: "PPL"   },
  { rawColumn: "PPL-2", stageCode: "PRE_POLISH",     cellCode: "PPL-2" },
  { rawColumn: "SET",   stageCode: "SETTING",        cellCode: "SET"   },
  { rawColumn: "REF",   stageCode: "REFINING",       cellCode: "REF"   },
  { rawColumn: "FPL",   stageCode: "FINAL_POLISH",   cellCode: "FPL"   },
  { rawColumn: "FPL2",  stageCode: "FINAL_POLISH",   cellCode: "FPL2"  },
  { rawColumn: "FG",    stageCode: "FINISHED_GOODS", cellCode: "FG"    },
  { rawColumn: "FG 2",  stageCode: "FINISHED_GOODS", cellCode: "FG 2"  },
  { rawColumn: "QC",    stageCode: "QC",             cellCode: "QC"    },
  { rawColumn: "CAD",   stageCode: "CAD",            cellCode: "CAD"   },
  { rawColumn: "CAM",   stageCode: "CAM",            cellCode: "CAM"   },
  { rawColumn: "Otec",  stageCode: "OTEC",           cellCode: "Otec"  },
  { rawColumn: "HOLD",  stageCode: "HOLD",           cellCode: "HOLD"  },
  { rawColumn: "IGI",   stageCode: "IGI",            cellCode: "IGI"   },
  { rawColumn: "MDL",   stageCode: "MDL",            cellCode: "MDL"   },
  { rawColumn: "WFD",   stageCode: "WFD",            cellCode: "WFD"   },
  { rawColumn: "SAM",   stageCode: "SAM",            cellCode: "SAM"   },
  { rawColumn: "ASBL",  stageCode: "ASBL",           cellCode: "ASBL"  },
  { rawColumn: "SPOL",  stageCode: "SPOL",           cellCode: "SPOL"  },
  { rawColumn: "ASBL2", stageCode: "ASBL",           cellCode: "ASBL2" },
  { rawColumn: "SFIL",  stageCode: "SFIL",           cellCode: "SFIL"  },
  { rawColumn: "JW",    stageCode: "JW",             cellCode: "JW"    },
  { rawColumn: "FPL-3", stageCode: "FINAL_POLISH",   cellCode: "FPL-3" },
];

/**
 * Predefined stage definitions — derived from DEFAULT_WIP_COLUMNS, deduplicated.
 * Seeded into StageDefinition on first startup so the system works without any
 * manual "detect stages" step. isTerminal marks the final delivery/done stage.
 */
export const DEFAULT_STAGE_DEFINITIONS = [
  { code: "PENDING",        name: "Pending",         displayOrder: -1 },
  { code: "WAX",            name: "Wax",             displayOrder: 0  },
  { code: "WAX_SET",        name: "Wax Setting",     displayOrder: 1  },
  { code: "GRN",            name: "Graining",        displayOrder: 2  },
  { code: "DIA_SET",        name: "Diamond Setting", displayOrder: 3  },
  { code: "CENTERING",      name: "Centering",       displayOrder: 4  },
  { code: "CASTING",        name: "Casting",         displayOrder: 5  },
  { code: "FILING",         name: "Filing",          displayOrder: 6  },
  { code: "PRE_POLISH",     name: "Pre Polish",      displayOrder: 7  },
  { code: "SETTING",        name: "Setting",         displayOrder: 8  },
  { code: "REFINING",       name: "Refining",        displayOrder: 9  },
  { code: "FINAL_POLISH",   name: "Final Polish",    displayOrder: 10 },
  { code: "FINISHED_GOODS", name: "Finished Goods",  displayOrder: 11 },
  { code: "QC",             name: "Quality Check",   displayOrder: 12 },
  { code: "CAD",            name: "CAD",             displayOrder: 13 },
  { code: "CAM",            name: "CAM",             displayOrder: 14 },
  { code: "OTEC",           name: "Otec",            displayOrder: 15 },
  { code: "HOLD",           name: "Hold",            displayOrder: 16 },
  { code: "IGI",            name: "IGI Certification", displayOrder: 17 },
  { code: "MDL",            name: "MDL",             displayOrder: 18 },
  { code: "WFD",            name: "WFD",             displayOrder: 19, isTerminal: true },
  { code: "SAM",            name: "Sampling",        displayOrder: 20 },
  { code: "ASBL",           name: "Assembly",        displayOrder: 21 },
  { code: "SPOL",           name: "Sand Polish",     displayOrder: 22 },
  { code: "SFIL",           name: "Sand Filing",     displayOrder: 23 },
  { code: "JW",             name: "JW",              displayOrder: 24 },
] as const;
