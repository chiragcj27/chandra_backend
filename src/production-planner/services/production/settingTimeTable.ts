/**
 * Setting stage time reference table.
 *
 * Indexed by total diamond carats per piece
 * (= NetWeight from diamond row → stored as diamondSpecs[].totalCaratsPerPiece).
 *
 * Formula:
 *   perItemTime = baseTimeHours / baseQty
 *   expectedTime = perItemTime × actualQty
 *
 * Qty used (in priority order):
 *   1. perPcPieces  — from PerPc_Pieces column in Excel
 *   2. totalQty     — jewelry piece count fallback
 *   3. DEV_STANDBY_SETTING_QTY = 6 (dev only)
 */

export interface SettingTimeEntry {
  /** Total diamond carats per piece (from NetWeight of diamond row) */
  diamondCarats: number;
  /** Reference quantity (base) */
  baseQty: number;
  /** Hours to complete baseQty pieces at this diamond carat weight */
  baseTimeHours: number;
}

export const DEV_STANDBY_SETTING_QTY = 6;

/** Stage codes that use this formula */
export const SETTING_STAGE_CODES = new Set(["DIA_SET", "SETTING"]);

/**
 * Reference data for DIA_SET / SETTING stage.
 * Adjust values once you have real production measurements.
 */
export const SETTING_TIME_TABLE: SettingTimeEntry[] = [
  { diamondCarats: 0.05, baseQty: 10, baseTimeHours: 0.5  },
  { diamondCarats: 0.10, baseQty: 10, baseTimeHours: 1.0  },
  { diamondCarats: 0.15, baseQty: 10, baseTimeHours: 1.5  },
  { diamondCarats: 0.20, baseQty: 10, baseTimeHours: 2.0  },
  { diamondCarats: 0.25, baseQty: 10, baseTimeHours: 2.5  },
  { diamondCarats: 0.30, baseQty: 10, baseTimeHours: 3.0  },
  { diamondCarats: 0.40, baseQty: 10, baseTimeHours: 3.5  },
  { diamondCarats: 0.50, baseQty: 10, baseTimeHours: 4.0  },
  { diamondCarats: 0.60, baseQty: 10, baseTimeHours: 4.5  },
  { diamondCarats: 0.75, baseQty: 10, baseTimeHours: 5.0  },
  { diamondCarats: 1.00, baseQty: 10, baseTimeHours: 6.0  },
  { diamondCarats: 1.25, baseQty: 10, baseTimeHours: 7.0  },
  { diamondCarats: 1.50, baseQty: 10, baseTimeHours: 8.0  },
  { diamondCarats: 2.00, baseQty: 10, baseTimeHours: 10.0 },
  { diamondCarats: 2.50, baseQty: 10, baseTimeHours: 12.0 },
  { diamondCarats: 3.00, baseQty: 10, baseTimeHours: 14.0 },
];

/**
 * Get total diamond carats per piece from diamondSpecs.
 * Sums totalCaratsPerPiece across all diamond spec entries.
 */
export function getTotalDiamondCarats(
  diamondSpecs: Array<{ totalCaratsPerPiece: number }> | undefined
): number | undefined {
  if (!diamondSpecs?.length) return undefined;
  const total = diamondSpecs.reduce((sum, d) => sum + (d.totalCaratsPerPiece ?? 0), 0);
  return total > 0 ? total : undefined;
}

/**
 * Calculate expected hours for DIA_SET / SETTING stage.
 *
 * @param perPcPieces    From PerPc_Pieces Excel column (priority 1)
 * @param totalQty       Jewelry piece count (priority 2)
 * @param diamondCarats  Total diamond carats/pc from NetWeight diamond row (size lookup)
 * @param fallback       Hours when data is missing
 */
export function calculateSettingTimeHours(
  perPcPieces: number | undefined,
  totalQty: number | undefined,
  diamondCarats: number | undefined,
  fallback = 12
): number {
  if (!diamondCarats || diamondCarats <= 0) return fallback;

  const qty =
    (perPcPieces && perPcPieces > 0) ? perPcPieces :
    (totalQty    && totalQty    > 0) ? totalQty    :
    (process.env.NODE_ENV !== "production" ? DEV_STANDBY_SETTING_QTY : null);

  if (!qty) return fallback;

  const usedSource =
    (perPcPieces && perPcPieces > 0) ? "PerPc_Pieces" :
    (totalQty    && totalQty    > 0) ? "totalQty"     :
    `DEV_STANDBY(${DEV_STANDBY_SETTING_QTY})`;

  const entry = SETTING_TIME_TABLE.reduce((best, e) =>
    Math.abs(e.diamondCarats - diamondCarats) < Math.abs(best.diamondCarats - diamondCarats)
      ? e : best
  );

  const perItemTime = entry.baseTimeHours / entry.baseQty;
  const result      = perItemTime * qty;

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[SettingTime] qty=${qty} (${usedSource})  diamondCarats=${diamondCarats}ct\n` +
      `  → table  : ${entry.baseQty} pcs / ${entry.diamondCarats}ct = ${entry.baseTimeHours}h\n` +
      `  → per item: ${entry.baseTimeHours}h / ${entry.baseQty} = ${perItemTime.toFixed(3)}h per piece\n` +
      `  → total  : ${perItemTime.toFixed(3)}h × ${qty} = ${result.toFixed(2)}h`
    );
  }

  return result;
}
