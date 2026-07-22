/** Stage codes that are diamond setting stages. */
export const SETTING_STAGE_CODES = new Set(["DIA_SET", "SETTING"]);

const SETTING_TIME_TABLE = [
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

/** Sum totalCaratsPerPiece (= NetWeight) across all diamond specs. */
export function getTotalDiamondCarats(
  diamondSpecs: Array<{ totalCaratsPerPiece: number }> | undefined
): number | undefined {
  if (!diamondSpecs?.length) return undefined;
  const total = diamondSpecs.reduce((sum, d) => sum + (d.totalCaratsPerPiece ?? 0), 0);
  return total > 0 ? total : undefined;
}

/**
 * Resolve PerPc_Pieces qty: jc.perPcPieces (card-level) first, then sum stonesPerPiece from diamond specs.
 */
export function resolvePerPcPieces(
  perPcPieces: number | undefined,
  diamondSpecs: Array<{ stonesPerPiece: number }> | undefined
): number | undefined {
  if (perPcPieces && perPcPieces > 0) return perPcPieces;
  const fromSpecs = (diamondSpecs ?? []).reduce((s, d) => s + (d.stonesPerPiece ?? 0), 0);
  return fromSpecs > 0 ? fromSpecs : undefined;
}

/**
 * Calculate setting stage stone time.
 * Uses NetWeight (totalCaratsPerPiece) for table lookup and resolved PerPc_Pieces as qty.
 */
export function calculateSettingTimeHours(
  totalCaratsPerPiece: number | undefined,
  stonesPerPiece: number | undefined,
  fallback = 0
): number {
  if (!totalCaratsPerPiece || totalCaratsPerPiece <= 0 || !stonesPerPiece || stonesPerPiece <= 0) {
    return fallback;
  }
  const entry = SETTING_TIME_TABLE.reduce((best, e) =>
    Math.abs(e.diamondCarats - totalCaratsPerPiece) < Math.abs(best.diamondCarats - totalCaratsPerPiece)
      ? e : best
  );
  const perItemTime = entry.baseTimeHours / entry.baseQty;
  return perItemTime * stonesPerPiece;
}
