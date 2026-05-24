import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Parse the first sheet of an Excel or CSV workbook from a Buffer.
 * Returns headers + array of row objects keyed by header name.
 *
 * Empty / blank cells come back as `undefined` (not `""` or `null`),
 * which lets downstream validators treat them uniformly with `== null`.
 *
 * Handles both `.xlsx`, `.xls`, and `.csv` (xlsx autodetects from content).
 */
export function parseWorkbookFromBuffer(buf: Buffer, sheetName?: string): ParsedSheet {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: false });
  const targetSheet = sheetName ?? wb.SheetNames[0];
  if (!targetSheet) {
    return { headers: [], rows: [], rowCount: 0 };
  }
  const sheet = wb.Sheets[targetSheet];
  if (!sheet) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  // sheet_to_json with header:1 → array-of-arrays so we can pull headers explicitly.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: undefined,
    blankrows: false,
  });

  if (aoa.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  const rawHeaders = aoa[0] ?? [];
  const headers: string[] = rawHeaders.map((h) => (typeof h === "string" ? h.trim() : String(h ?? "")));

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const v = row[c];
      obj[key] = v === "" ? undefined : v;
    }
    rows.push(obj);
  }

  return { headers, rows, rowCount: rows.length };
}
