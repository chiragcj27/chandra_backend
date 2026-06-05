/**
 * Canonical default values for GatiColumnMap documents and StageDefinitions.
 * Imported by both seedDefaultColumnMaps (boot seeding) and the adapters
 * (fallback creation when the DB was wiped without a server restart).
 */

export const DEFAULT_ALIASES = {
  diamond: [
    "LABGROWN DIAMOND", "NATURAL DIAMOND", "DIAMOND", "LAB GROWN DIAMOND",
    "MOISSANITE DIAMOND", "MOISSANITE", "CVD DIAMOND", "CUBIC ZIRCONIA", "CZ",
  ],
  metal: ["GOLD", "PLATINUM", "SILVER", "ROSE GOLD", "WHITE GOLD"],
  finding: ["FINDING", "FINDINGS", "SILVER FINDING", "GOLD FINDING", "PLATINUM FINDING"],
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
  // Jewelry category — supports both column name variants
  { rawColumn: "Category",           fieldPath: "itemCategory" },
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
  // Each stage lists UPPERCASE (GatiSOFT default) + Title-case (Excel export variant)
  // ── CAM (first in flow) ──────────────────────────────────────────────────────
  { rawColumn: "CAM",    stageCode: "CAM",           cellCode: "CAM"   },
  { rawColumn: "Cam",    stageCode: "CAM",           cellCode: "CAM"   },
  // ── CAD ──────────────────────────────────────────────────────────────────────
  { rawColumn: "CAD",    stageCode: "CAD",           cellCode: "CAD"   },
  { rawColumn: "Cad",    stageCode: "CAD",           cellCode: "CAD"   },
  // ── WAX ──────────────────────────────────────────────────────────────────────
  { rawColumn: "WAX",    stageCode: "WAX",           cellCode: "WAX"   },
  { rawColumn: "Wax",    stageCode: "WAX",           cellCode: "WAX"   },
  // ── WAX SET ──────────────────────────────────────────────────────────────────
  { rawColumn: "WSET",   stageCode: "WAX_SET",       cellCode: "WSET"  },
  { rawColumn: "Wset",   stageCode: "WAX_SET",       cellCode: "WSET"  },
  // ── CASTING ──────────────────────────────────────────────────────────────────
  { rawColumn: "CST",    stageCode: "CASTING",       cellCode: "CST"   },
  { rawColumn: "Cst",    stageCode: "CASTING",       cellCode: "CST"   },
  // ── CENTERING ────────────────────────────────────────────────────────────────
  { rawColumn: "CEN",    stageCode: "CENTERING",     cellCode: "CEN"   },
  { rawColumn: "Cen",    stageCode: "CENTERING",     cellCode: "CEN"   },
  // ── GRINDING ─────────────────────────────────────────────────────────────────
  { rawColumn: "GRN",    stageCode: "GRN",           cellCode: "GRN"   },
  { rawColumn: "Grn",    stageCode: "GRN",           cellCode: "GRN"   },
  // DRL (Drilling — maps to GRN if no dedicated stage)
  { rawColumn: "DRL",    stageCode: "GRN",           cellCode: "GRN"   },
  { rawColumn: "Drl",    stageCode: "GRN",           cellCode: "GRN"   },
  // ── REFINING ─────────────────────────────────────────────────────────────────
  { rawColumn: "REF",      stageCode: "REFINING",    cellCode: "REF"   },
  { rawColumn: "Ref",      stageCode: "REFINING",    cellCode: "REF"   },
  { rawColumn: "REFINING", stageCode: "REFINING",    cellCode: "REF"   },
  // ── FILING (cells: FIL1, FIL2, FIL3, SFIL) ───────────────────────────────────
  { rawColumn: "FIL1",   stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "Fil1",   stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "FIL2",   stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "Fil2",   stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "FIL3",   stageCode: "FILING",        cellCode: "FIL3"  },
  { rawColumn: "Fil3",   stageCode: "FILING",        cellCode: "FIL3"  },
  { rawColumn: "SFIL",   stageCode: "FILING",        cellCode: "SFIL"  },
  { rawColumn: "Sfil",   stageCode: "FILING",        cellCode: "SFIL"  },
  // backward compat (single/hyphen)
  { rawColumn: "FIL",    stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "Fil",    stageCode: "FILING",        cellCode: "FIL1"  },
  { rawColumn: "FIL-2",  stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "Fil-2",  stageCode: "FILING",        cellCode: "FIL2"  },
  { rawColumn: "FIL-3",  stageCode: "FILING",        cellCode: "FIL3"  },
  { rawColumn: "Fil-3",  stageCode: "FILING",        cellCode: "FIL3"  },
  // ── ASSEMBLE (cells: ASBL, ASBL_1, ASBL_2, ASBL_3) ──────────────────────────
  { rawColumn: "ASBL",   stageCode: "ASSEMBLE",      cellCode: "ASBL"   },
  { rawColumn: "Asbl",   stageCode: "ASSEMBLE",      cellCode: "ASBL"   },
  { rawColumn: "ASBL_1", stageCode: "ASSEMBLE",      cellCode: "ASBL_1" },
  { rawColumn: "Asbl_1", stageCode: "ASSEMBLE",      cellCode: "ASBL_1" },
  { rawColumn: "ASBL_2", stageCode: "ASSEMBLE",      cellCode: "ASBL_2" },
  { rawColumn: "Asbl_2", stageCode: "ASSEMBLE",      cellCode: "ASBL_2" },
  { rawColumn: "Asbl2",  stageCode: "ASSEMBLE",      cellCode: "ASBL_2" },
  { rawColumn: "ASBL_3", stageCode: "ASSEMBLE",      cellCode: "ASBL_3" },
  { rawColumn: "Asbl_3", stageCode: "ASSEMBLE",      cellCode: "ASBL_3" },
  { rawColumn: "Asbl-3", stageCode: "ASSEMBLE",      cellCode: "ASBL_3" },
  // ── POLISH (cells: POL_1, POL_2, POL_3, SPOL) ────────────────────────────────
  { rawColumn: "POL_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "Pol_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "POL_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "Pol_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "POL_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "Pol_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "SPOL",   stageCode: "POL",           cellCode: "SPOL"  },
  { rawColumn: "Spol",   stageCode: "POL",           cellCode: "SPOL"  },
  // backward compat (old PPL names)
  { rawColumn: "PPL",    stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "Ppl",    stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "PPL_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "Ppl_1",  stageCode: "POL",           cellCode: "POL_1" },
  { rawColumn: "PPL_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "Ppl_2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "PPL_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "Ppl_3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "PPL-2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "Ppl-2",  stageCode: "POL",           cellCode: "POL_2" },
  { rawColumn: "PPL-3",  stageCode: "POL",           cellCode: "POL_3" },
  { rawColumn: "Ppl-3",  stageCode: "POL",           cellCode: "POL_3" },
  // ── OTEC (optional) ───────────────────────────────────────────────────────────
  { rawColumn: "OTEC",   stageCode: "OTEC",          cellCode: "OTEC"  },
  { rawColumn: "Otec",   stageCode: "OTEC",          cellCode: "OTEC"  },
  // ── WFD (optional) ───────────────────────────────────────────────────────────
  { rawColumn: "WFD",    stageCode: "WFD",           cellCode: "WFD"   },
  { rawColumn: "Wfd",    stageCode: "WFD",           cellCode: "WFD"   },
  // ── DIAMOND SETTING ──────────────────────────────────────────────────────────
  { rawColumn: "DIA",    stageCode: "DIA_SET",       cellCode: "DIA"   },
  { rawColumn: "Dia",    stageCode: "DIA_SET",       cellCode: "DIA"   },
  // ── SETTING ──────────────────────────────────────────────────────────────────
  { rawColumn: "SET",    stageCode: "SETTING",       cellCode: "SET"   },
  { rawColumn: "Set",    stageCode: "SETTING",       cellCode: "SET"   },
  // ── FINAL POLISH (cells: FPL1, FPL2, FPL3) ───────────────────────────────────
  { rawColumn: "FPL1",   stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "Fpl1",   stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "FPL2",   stageCode: "FINAL_POLISH",  cellCode: "FPL2"  },
  { rawColumn: "Fpl2",   stageCode: "FINAL_POLISH",  cellCode: "FPL2"  },
  { rawColumn: "FPL3",   stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  { rawColumn: "Fpl3",   stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  // backward compat
  { rawColumn: "FPL",    stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "Fpl",    stageCode: "FINAL_POLISH",  cellCode: "FPL1"  },
  { rawColumn: "FPL-3",  stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  { rawColumn: "Fpl-3",  stageCode: "FINAL_POLISH",  cellCode: "FPL3"  },
  // ── QC ───────────────────────────────────────────────────────────────────────
  { rawColumn: "QC",     stageCode: "QC",            cellCode: "QC"    },
  { rawColumn: "Qc",     stageCode: "QC",            cellCode: "QC"    },
  // ── FINISHED GOODS (cells: FG1, FG2, FG3) ────────────────────────────────────
  { rawColumn: "FG1",    stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "Fg1",    stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "FG2",    stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  { rawColumn: "Fg2",    stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  { rawColumn: "FG3",    stageCode: "FINISHED_GOODS", cellCode: "FG3"  },
  { rawColumn: "Fg3",    stageCode: "FINISHED_GOODS", cellCode: "FG3"  },
  // backward compat
  { rawColumn: "FG",     stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "Fg",     stageCode: "FINISHED_GOODS", cellCode: "FG1"  },
  { rawColumn: "FG 2",   stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  { rawColumn: "Fg 2",   stageCode: "FINISHED_GOODS", cellCode: "FG2"  },
  // ── IGI / GSL ────────────────────────────────────────────────────────────────
  { rawColumn: "IGI",    stageCode: "IGI",           cellCode: "IGI"   },
  { rawColumn: "Igi",    stageCode: "IGI",           cellCode: "IGI"   },
  { rawColumn: "GSL",    stageCode: "IGI",           cellCode: "GSL"   },
  { rawColumn: "Gsl",    stageCode: "IGI",           cellCode: "GSL"   },
  // ── SAMPLING ─────────────────────────────────────────────────────────────────
  { rawColumn: "SAM",    stageCode: "SAM",           cellCode: "SAM"   },
  { rawColumn: "Sam",    stageCode: "SAM",           cellCode: "SAM"   },
  // ── MDL ──────────────────────────────────────────────────────────────────────
  { rawColumn: "MDL",    stageCode: "MDL",           cellCode: "MDL"   },
  // ── OUT-OF-FLOW (appear at any point) ────────────────────────────────────────
  { rawColumn: "HOLD",   stageCode: "HOLD",          cellCode: "HOLD"  },
  { rawColumn: "Hold",   stageCode: "HOLD",          cellCode: "HOLD"  },
  { rawColumn: "JW",     stageCode: "JW",            cellCode: "JW"    },
  { rawColumn: "Jw",     stageCode: "JW",            cellCode: "JW"    },
  // ── SFIL (sample filing — under FILING) ──────────────────────────────────────
  { rawColumn: "Sfil",   stageCode: "FILING",        cellCode: "SFIL"  },
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
  /** Default units per worker-hour. Uses the stage's unitOfWork (grams/stones/piece). */
  unitsPerWorkerHour?: number;
}[] = [
  // ── Pre-production ────────────────────────────────────────────────────────────
  { code: "PENDING",        name: "Pending",         displayOrder: -1, expectedDurationHours: 0,   unitsPerWorkerHour: 0    },
  // ── Main flow ────────────────────────────────────────────────────────────────
  { code: "CAM",            name: "CAM",             displayOrder: 1,  expectedDurationHours: 4,   unitsPerWorkerHour: 1    },
  { code: "CAD",            name: "CAD",             displayOrder: 2,  expectedDurationHours: 8,   unitsPerWorkerHour: 1    },
  { code: "WAX",            name: "Wax",             displayOrder: 3,  expectedDurationHours: 8,   unitsPerWorkerHour: 2,   parallelGroup: "WAX_FAMILY" },
  { code: "WAX_SET",        name: "Wax Setting",     displayOrder: 4,  expectedDurationHours: 6,   unitsPerWorkerHour: 2,   parallelGroup: "WAX_FAMILY" },
  { code: "CASTING",        name: "Casting",         displayOrder: 5,  expectedDurationHours: 12,  unitsPerWorkerHour: 50   },
  { code: "CENTERING",      name: "Centering",       displayOrder: 6,  expectedDurationHours: 4,   unitsPerWorkerHour: 20   },
  { code: "GRN",            name: "Grinding",        displayOrder: 7,  expectedDurationHours: 4,   unitsPerWorkerHour: 20   },
  { code: "REFINING",       name: "Refining",        displayOrder: 8,  expectedDurationHours: 6,   unitsPerWorkerHour: 50   },
  { code: "FILING",         name: "Filing",          displayOrder: 9,  expectedDurationHours: 8,   unitsPerWorkerHour: 50   },
  { code: "ASSEMBLE",       name: "Assemble",        displayOrder: 10, expectedDurationHours: 6,   unitsPerWorkerHour: 3    },
  { code: "POL",            name: "Polish",          displayOrder: 11, expectedDurationHours: 6,   unitsPerWorkerHour: 4    },
  { code: "OTEC",           name: "OTEC",            displayOrder: 12, expectedDurationHours: 2,   unitsPerWorkerHour: 4,   isOptional: true },
  { code: "WFD",            name: "WFD",             displayOrder: 13, expectedDurationHours: 4,   unitsPerWorkerHour: 4,   isOptional: true },
  { code: "DIA_SET",        name: "Diamond Setting", displayOrder: 14, expectedDurationHours: 12,  unitsPerWorkerHour: 12   },
  { code: "SETTING",        name: "Setting",         displayOrder: 15, expectedDurationHours: 10,  unitsPerWorkerHour: 12   },
  { code: "FINAL_POLISH",   name: "Final Polish",    displayOrder: 16, expectedDurationHours: 4,   unitsPerWorkerHour: 4    },
  { code: "QC",             name: "Quality Check",   displayOrder: 17, expectedDurationHours: 4,   unitsPerWorkerHour: 9    },
  { code: "FINISHED_GOODS", name: "Finished Goods",  displayOrder: 18, expectedDurationHours: 2,   unitsPerWorkerHour: 5,   isTerminal: true },
  { code: "IGI",            name: "IGI / GSL",       displayOrder: 19, expectedDurationHours: 48,  unitsPerWorkerHour: 10   },
  { code: "SAM",            name: "Sampling",        displayOrder: 20, expectedDurationHours: 8,   unitsPerWorkerHour: 5    },
  { code: "MDL",            name: "MDL",             displayOrder: 21, expectedDurationHours: 4,   unitsPerWorkerHour: 5    },
  // ── Out-of-flow ───────────────────────────────────────────────────────────────
  { code: "HOLD",           name: "Hold",            displayOrder: 98, expectedDurationHours: 24,  unitsPerWorkerHour: 0,   isOptional: true },
  { code: "JW",             name: "JW",              displayOrder: 99, expectedDurationHours: 4,   unitsPerWorkerHour: 0,   isOptional: true },
];
