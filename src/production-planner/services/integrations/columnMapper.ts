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
