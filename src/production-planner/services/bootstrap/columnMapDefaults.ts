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
  // Optional — if the order Excel has an item-category column, map it here
  { rawColumn: "ItemCategory",       fieldPath: "itemCategory" },
  // Diamonds per piece — used for setting-stage time calculation
  { rawColumn: "PerPc_Pieces",       fieldPath: "perPcPieces" },
];

/**
 * WIP column map: rawColumn (Excel header) → stageCode + cellCode.
 *
 * Ordering follows the production flow (CAD → FG → IGI/SAM/MDL).
 * Backward-compat aliases (old hyphen names) are kept so existing WIP files
 * continue to import without changes.
 */
export const DEFAULT_WIP_COLUMNS = [
  // ── CAD ──────────────────────────────────────────────────────────────────────
  { rawColumn: "CAD",    stageCode: "CAD",           cellCode: "CAD"   },
  // ── CAM ──────────────────────────────────────────────────────────────────────
  { rawColumn: "CAM",    stageCode: "CAM",           cellCode: "CAM"   },
  // ── WAX ──────────────────────────────────────────────────────────────────────
  { rawColumn: "WAX",    stageCode: "WAX",           cellCode: "WAX"   },
  // ── WAX SET ──────────────────────────────────────────────────────────────────
  { rawColumn: "WSET",   stageCode: "WAX_SET",       cellCode: "WSET"  },
  // ── CASTING ──────────────────────────────────────────────────────────────────
  { rawColumn: "CST",    stageCode: "CASTING",       cellCode: "CST"   },
  // ── CENTERING ────────────────────────────────────────────────────────────────
  { rawColumn: "CEN",    stageCode: "CENTERING",     cellCode: "CEN"   },
  // ── GRINDING ─────────────────────────────────────────────────────────────────
  { rawColumn: "GRN",    stageCode: "GRN",           cellCode: "GRN"   },
  // ── REFINING ─────────────────────────────────────────────────────────────────
  { rawColumn: "REF",      stageCode: "REFINING",    cellCode: "REF"   },
  { rawColumn: "REFINING", stageCode: "REFINING",    cellCode: "REF"   },
  // ── FILING (cells: FIL1, FIL2, FIL3, SFIL) ───────────────────────────────────
  { rawColumn: "FIL1",   stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "FIL2",   stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "FIL3",   stageCode: "FILING",        cellCode: "FIL3"  },
  { rawColumn: "SFIL",   stageCode: "FILING",        cellCode: "SFIL"  },
  // backward compat (old hyphen names)
  { rawColumn: "FIL",    stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "FIL-2",  stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "FIL-3",  stageCode: "FILING",        cellCode: "FIL3"  },
  // ── ASSEMBLE (cells: ASBL, ASBL_1, ASBL_2, ASBL_3) ──────────────────────────
  { rawColumn: "ASBL",   stageCode: "ASSEMBLE",      cellCode: "ASBL"   },
  { rawColumn: "ASBL_1", stageCode: "ASSEMBLE",      cellCode: "ASBL_1" },
  { rawColumn: "ASBL_2", stageCode: "ASSEMBLE",      cellCode: "ASBL_2" },
  { rawColumn: "ASBL_3", stageCode: "ASSEMBLE",      cellCode: "ASBL_3" },
  // ── POLISH (cells: POL_1, POL_2, POL_3, SPOL) ────────────────────────────────
  { rawColumn: "POL_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "POL_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "POL_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "SPOL",   stageCode: "POL",           cellCode: "SPOL"  },
  // backward compat (old PPL names)
  { rawColumn: "PPL",    stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "PPL_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "PPL_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "PPL_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "PPL-2",  stageCode: "POL",           cellCode: "POL_2" },
  // ── OTEC (optional — after POL) ───────────────────────────────────────────────
  { rawColumn: "OTEC",   stageCode: "OTEC",          cellCode: "OTEC"  },
  { rawColumn: "Otec",   stageCode: "OTEC",          cellCode: "OTEC"  },
  // ── WFD (optional — after PPL or OTEC) ───────────────────────────────────────
  { rawColumn: "WFD",    stageCode: "WFD",           cellCode: "WFD"   },
  // ── DIAMOND SETTING ──────────────────────────────────────────────────────────
  { rawColumn: "DIA",    stageCode: "DIA_SET",       cellCode: "DIA"   },
  // ── SETTING ──────────────────────────────────────────────────────────────────
  { rawColumn: "SET",    stageCode: "SETTING",       cellCode: "SET"   },
  // ── FINAL POLISH (cells: FPL1, FPL2, FPL3) ───────────────────────────────────
  { rawColumn: "FPL1",   stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "FPL2",   stageCode: "FINAL_POLISH",  cellCode: "FPL2"  },
  { rawColumn: "FPL3",   stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  // backward compat
  { rawColumn: "FPL",    stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "FPL-3",  stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  // ── QC ───────────────────────────────────────────────────────────────────────
  { rawColumn: "QC",     stageCode: "QC",            cellCode: "QC"    },
  // ── FINISHED GOODS (cells: FG1, FG2, FG3) ────────────────────────────────────
  { rawColumn: "FG1",    stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "FG2",    stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  { rawColumn: "FG3",    stageCode: "FINISHED_GOODS", cellCode: "FG3"  },
  // backward compat
  { rawColumn: "FG",     stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "FG 2",   stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  // ── IGI / GSL ────────────────────────────────────────────────────────────────
  { rawColumn: "IGI",    stageCode: "IGI",           cellCode: "IGI"   },
  { rawColumn: "GSL",    stageCode: "IGI",           cellCode: "GSL"   },
  // ── SAMPLING ─────────────────────────────────────────────────────────────────
  { rawColumn: "SAM",    stageCode: "SAM",           cellCode: "SAM"   },
  // ── MDL ──────────────────────────────────────────────────────────────────────
  { rawColumn: "MDL",    stageCode: "MDL",           cellCode: "MDL"   },
  // ── OUT-OF-FLOW (appear at any point) ────────────────────────────────────────
  { rawColumn: "HOLD",   stageCode: "HOLD",          cellCode: "HOLD"  },
  { rawColumn: "JW",     stageCode: "JW",            cellCode: "JW"    },
];

/**
 * Stage codes that have been merged into other stages as cells.
 * These are deactivated by the seed so they no longer appear in the flow.
 */
export const OBSOLETE_STAGE_CODES = ["SPOL", "SFIL", "PRE_POLISH"] as const;

/**
 * Predefined stage definitions — the canonical production flow.
 * Seeded into StageDefinition on every server start (displayOrder + name
 * are always refreshed; duration/dependencies respect admin edits).
 *
 * displayOrder rules:
 *   -1      : PENDING (pre-production virtual state)
 *   1–19    : Main production flow
 *   98–99   : Out-of-flow / special (HOLD, JW — not shown in linear stage view)
 */
export const DEFAULT_STAGE_DEFINITIONS: {
  code: string;
  name: string;
  displayOrder: number;
  expectedDurationHours: number;
  isOptional?: boolean;
  isTerminal?: boolean;
  parallelGroup?: string;
}[] = [
  // ── Pre-production ────────────────────────────────────────────────────────────
  { code: "PENDING",        name: "Pending",         displayOrder: -1, expectedDurationHours: 0   },
  // ── Main flow ────────────────────────────────────────────────────────────────
  { code: "CAD",            name: "CAD",             displayOrder: 1,  expectedDurationHours: 8   },
  { code: "CAM",            name: "CAM",             displayOrder: 2,  expectedDurationHours: 4   },
  { code: "WAX",            name: "Wax",             displayOrder: 3,  expectedDurationHours: 8,  parallelGroup: "WAX_FAMILY" },
  { code: "WAX_SET",        name: "Wax Setting",     displayOrder: 4,  expectedDurationHours: 6,  parallelGroup: "WAX_FAMILY" },
  { code: "CASTING",        name: "Casting",         displayOrder: 5,  expectedDurationHours: 12  },
  { code: "CENTERING",      name: "Centering",       displayOrder: 6,  expectedDurationHours: 4   },
  { code: "GRN",            name: "Grinding",        displayOrder: 7,  expectedDurationHours: 4   },
  { code: "REFINING",       name: "Refining",        displayOrder: 8,  expectedDurationHours: 6   },
  { code: "FILING",         name: "Filing",          displayOrder: 9,  expectedDurationHours: 8   },
  { code: "ASSEMBLE",       name: "Assemble",        displayOrder: 10, expectedDurationHours: 6   },
  { code: "POL",            name: "Polish",          displayOrder: 11, expectedDurationHours: 6   },
  { code: "OTEC",           name: "OTEC",            displayOrder: 12, expectedDurationHours: 2,  isOptional: true },
  { code: "WFD",            name: "WFD",             displayOrder: 13, expectedDurationHours: 4,  isOptional: true },
  { code: "DIA_SET",        name: "Diamond Setting", displayOrder: 14, expectedDurationHours: 12  },
  { code: "SETTING",        name: "Setting",         displayOrder: 15, expectedDurationHours: 10  },
  { code: "FINAL_POLISH",   name: "Final Polish",    displayOrder: 16, expectedDurationHours: 4   },
  { code: "QC",             name: "Quality Check",   displayOrder: 17, expectedDurationHours: 4   },
  { code: "FINISHED_GOODS", name: "Finished Goods",  displayOrder: 18, expectedDurationHours: 2,  isTerminal: true },
  { code: "IGI",            name: "IGI / GSL",       displayOrder: 19, expectedDurationHours: 48  },
  { code: "SAM",            name: "Sampling",        displayOrder: 20, expectedDurationHours: 8   },
  { code: "MDL",            name: "MDL",             displayOrder: 21, expectedDurationHours: 4   },
  // ── Out-of-flow ───────────────────────────────────────────────────────────────
  { code: "HOLD",           name: "Hold",            displayOrder: 98, expectedDurationHours: 24, isOptional: true },
  { code: "JW",             name: "JW",              displayOrder: 99, expectedDurationHours: 4,  isOptional: true },
];
