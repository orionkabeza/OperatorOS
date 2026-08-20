import Papa from "papaparse";
import ExcelJS from "exceljs";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * D.2 Step 3 "Upload a list" — CSV via papaparse, XLSX via exceljs (both
 * pure-JS, no macro execution — exceljs specifically was picked per
 * docs/plans/phase-1.md §0.6's "well-audited pure-JS parser... no
 * server-side macro execution, size-capped" requirement). Both paths
 * return the same shape so the rest of the importer UI doesn't care which
 * format was uploaded.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — generous for a product list, small enough to parse client-side without hanging the tab.

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${Math.round(file.size / 1024 / 1024)}MB) — please split it into smaller files, under 5MB each.`);
  }

  if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const headers = result.meta.fields ?? [];
    return { headers, rows: result.data };
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? "").trim());
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1);
      record[header] = cell.value == null ? "" : String(cell.value);
    });
    if (Object.values(record).some((v) => v.trim() !== "")) rows.push(record);
  });

  return { headers, rows };
}

/** Builds a downloadable "corrected template" CSV — the header row plus only the rows that failed validation, so the owner can fix and re-upload just those. */
export function buildCorrectedTemplateCsv(headers: string[], errorRows: Record<string, string>[]): string {
  return Papa.unparse({ fields: headers, data: errorRows.map((row) => headers.map((h) => row[h] ?? "")) });
}
