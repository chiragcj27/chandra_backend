import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Parse one sheet of an Excel or CSV workbook from a Buffer.
 * Returns headers + array of row objects keyed by header name.
 *
 * Empty / blank cells come back as `undefined` (not `""` or `null`),
 * which lets downstream validators treat them uniformly with `== null`.
 *
 * Handles both `.xlsx`, `.xls`, and `.csv` (xlsx autodetects from content).
 *
 * @param sheetName - Which sheet to parse. Defaults to the first sheet.
 * @param combineAllSheets - When true, ALL sheets are parsed and their rows
 *   are merged into a single result (each sheet's own header row is used for
 *   that sheet's columns). Useful for Order Excel files where GatiSOFT spreads
 *   different orders across multiple sheets.
 */
export function parseWorkbookFromBuffer(
  buf: Buffer,
  sheetName?: string,
  combineAllSheets = false
): ParsedSheet {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: false });

  const sheetNames: string[] = combineAllSheets
    ? wb.SheetNames
    : [sheetName ?? wb.SheetNames[0]];

  const allRows: Record<string, unknown>[] = [];
  let mergedHeaders: string[] = [];

  for (const sName of sheetNames) {
    if (!sName) continue;
    const sheet = wb.Sheets[sName];
    if (!sheet) continue;

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: undefined,
      blankrows: false,
    });
    if (aoa.length === 0) continue;

    // Auto-detect the real header row.
    // GatiSOFT WIP exports place a "Grand Total" summary row above the real
    // column headers. Scan the first 5 rows and pick the first that has ≥2
    // non-blank cells — that is always the real header.
    let headerIdx = 0;
    for (let i = 0; i < Math.min(aoa.length, 5); i++) {
      const nonEmpty = (aoa[i] ?? []).filter(
        (h) => h != null && String(h).trim() !== ""
      ).length;
      if (nonEmpty >= 2) {
        headerIdx = i;
        break;
      }
    }

    const rawHeaders = aoa[headerIdx] ?? [];
    const headers: string[] = rawHeaders.map((h) =>
      typeof h === "string" ? h.trim() : String(h ?? "")
    );

    // Keep track of the widest header set seen across sheets for the merged result.
    if (headers.length > mergedHeaders.length) mergedHeaders = headers;

    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] ?? [];
      const obj: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        const v = row[c];
        obj[key] = v === "" ? undefined : v;
      }
      allRows.push(obj);
    }
  }

  return { headers: mergedHeaders, rows: allRows, rowCount: allRows.length };
}
