import type { GatiAliasMap } from "../../models/gatiColumnMap";

/** Classification of an Order Excel row by its `RawAliasName` value. */
export type RowKind = "diamond" | "metal" | "finding" | "unknown";

/**
 * Match a raw `RawAliasName` value against the configured aliases.
 * Matching is case-insensitive and trims whitespace. Returns the first
 * category whose alias list contains a match.
 */
export function classifyRow(rawAliasName: unknown, aliases: GatiAliasMap): RowKind {
  if (typeof rawAliasName !== "string") return "unknown";
  const needle = rawAliasName.trim().toUpperCase();
  if (!needle) return "unknown";

  const inList = (list: string[]): boolean =>
    list.some((alias) => alias.trim().toUpperCase() === needle);

  if (inList(aliases.diamond)) return "diamond";
  if (inList(aliases.metal)) return "metal";
  if (inList(aliases.finding)) return "finding";
  return "unknown";
}

/** Coerce a cell value to a number; returns null if not parseable. */
export function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce a cell value to a non-empty trimmed string; returns undefined otherwise. */
export function toStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const t = s.trim();
  return t.length ? t : undefined;
}

/**
 * Parse a GatiSOFT-format date string.
 * Default format `MM/DD/YYYY` (e.g. `04/14/2026`). Also accepts ISO `YYYY-MM-DD`.
 * Returns null if unparseable.
 */
export function parseGatiDate(s: unknown): Date | null {
  if (s instanceof Date) return Number.isFinite(s.getTime()) ? s : null;
  if (typeof s === "number") {
    // Excel serial date number (days since 1899-12-30). Convert to JS Date.
    const d = new Date((s - 25569) * 86400 * 1000);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const str = toStr(s);
  if (!str) return null;

  // ISO `YYYY-MM-DD` (or full ISO timestamp)
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // US `MM/DD/YYYY`
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // `DD-MM-YYYY` or `DD/MM/YYYY` (GatiSOFT multi-sheet style, e.g. "22-04-2026")
  const mDmy = str.match(/^(\d{1,2})[-](\d{1,2})[-](\d{4})$/);
  if (mDmy) {
    const day = Number(mDmy[1]);
    const month = Number(mDmy[2]);
    const year = Number(mDmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  return null;
}

/** Build the GatiSOFT piece code `${orderNumber}/${srNo}`. */
export function buildGatiPieceCode(orderNumber: string, srNo: number): string {
  return `${orderNumber}/${srNo}`;
}

/**
 * Style-code token → jewelry category mapping.
 * The category code can appear ANYWHERE in the style number
 * (start, middle, end) — e.g. "001R", "R-001", "RNG-001", "001-R-05".
 *
 * How it works:
 *   1. Split styleNo by separators (-, _, /, space, .)
 *   2. Strip digits from each token → pure letter token
 *   3. Exact-match the letter token against this map (longest key wins)
 *
 * Add more codes as your style numbering evolves.
 */
const STYLE_CODE_MAP: Record<string, string> = {
  // 3-char codes (checked first — more specific)
  RNG: "Ring",
  BNG: "Bangle",
  BRC: "Bracelet",
  NCK: "Necklace",
  PND: "Pendant",
  EAR: "Earring",
  CHN: "Chain",
  MGS: "Mangalsutra",
  ANK: "Anklet",
  KDA: "Kada",
  // 2-char codes
  RG: "Ring",
  BN: "Bangle",
  BR: "Bracelet",
  NK: "Necklace",
  PD: "Pendant",
  ER: "Earring",
  CH: "Chain",
  MG: "Mangalsutra",
  AK: "Anklet",
  KD: "Kada",
  // 1-char codes
  R: "Ring",
  B: "Bracelet",
  A: "Anklet",
  E: "Earring",
  P: "Pendant",
  N: "Necklace",
  C: "Chain",
  K: "Kada",
  M: "Mangalsutra",
};

/**
 * Resolve the jewelry category for a job card.
 *
 * Priority:
 *   1. `itemCategory` if explicitly set on the job card (from order import)
 *   2. Split styleNo by separators, strip digits from each token,
 *      then exact-match against STYLE_CODE_MAP (longest match wins)
 *   3. undefined — no category could be determined
 *
 * Examples:
 *   "R-001"      → "R"   → Ring
 *   "001-R"      → "R"   → Ring
 *   "R1042"      → "R"   → Ring
 *   "RNG001"     → "RNG" → Ring
 *   "001-BNG-05" → "BNG" → Bangle
 *   "BNGRING"    → no clean split → no match (ambiguous, skip)
 */
export function resolveItemCategory(
  itemCategory: string | undefined,
  styleNo: string | undefined
): string | undefined {
  if (itemCategory?.trim()) return itemCategory.trim();
  if (!styleNo?.trim()) return undefined;

  const s = styleNo.trim().toUpperCase();

  // Split on separators and also on digit/letter boundaries
  // e.g. "R001"  → ["R", "001"]
  //      "001R"  → ["001", "R"]
  //      "BNG-01" → ["BNG", "01"]
  const parts = s
    .split(/[-_\/\s.]+/)          // split by explicit separators
    .flatMap((p) => p.split(/(?=[A-Z])(?<=[0-9])|(?=[0-9])(?<=[A-Z])/)); // split on digit↔letter boundary

  for (const part of parts) {
    const letters = part.replace(/\d/g, "").trim();
    if (!letters) continue;
    // Exact match only — avoids partial matches like "CAD" → "C" (Chain)
    if (STYLE_CODE_MAP[letters]) return STYLE_CODE_MAP[letters];
  }

  return undefined;
}
