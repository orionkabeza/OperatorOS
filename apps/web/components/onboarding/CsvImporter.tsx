"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "../design/Button";
import { Select } from "./Select";
import { buildImportPreview, commitImport } from "@/lib/api/products";
import type { ImportPreview } from "@/lib/api/types";
import { buildCorrectedTemplateCsv, parseSpreadsheetFile, type ParsedSheet } from "@/lib/import-parse";

const TARGET_FIELDS = [
  { key: "name", label: "Product name", required: true },
  { key: "sku", label: "SKU", required: true },
  { key: "unit", label: "Unit", required: false },
  { key: "cost", label: "Cost price (RWF)", required: true },
  { key: "price", label: "Selling price (RWF)", required: true },
  { key: "opening_qty", label: "Opening quantity", required: false },
] as const;

function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of TARGET_FIELDS) {
    const match = headers.find((h) => h.toLowerCase().replace(/[\s_-]/g, "") === field.key.replace(/_/g, ""));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function applyMapping(sheet: ParsedSheet, mapping: Record<string, string>): Record<string, string>[] {
  return sheet.rows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const field of TARGET_FIELDS) {
      const sourceHeader = mapping[field.key];
      mapped[field.key] = sourceHeader ? (row[sourceHeader] ?? "") : "";
    }
    return mapped;
  });
}

export function CsvImporter({ onImported }: { onImported: (count: number) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<number | null>(null);

  const mappedRows = useMemo(() => (sheet ? applyMapping(sheet, mapping) : []), [sheet, mapping]);
  const preview: ImportPreview | null = useMemo(() => (sheet ? buildImportPreview(mappedRows) : null), [sheet, mappedRows]);

  async function handleFile(file: File) {
    setParseError(null);
    setCommitted(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.rows.length === 0) {
        setParseError("That file has no data rows we could read. Check it has a header row and at least one product.");
        return;
      }
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  function downloadCorrectedTemplate() {
    if (!sheet || !preview) return;
    const errorRows = mappedRows.filter((_, i) => (preview.rows[i]?.errors.length ?? 0) > 0);
    const csv = buildCorrectedTemplateCsv(
      TARGET_FIELDS.map((f) => f.key),
      errorRows,
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "corrected-products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(onlyValid: boolean) {
    if (!preview) return;
    setCommitting(true);
    try {
      const rowsToImport = onlyValid ? preview.rows.filter((r) => r.errors.length === 0) : preview.rows;
      const result = await commitImport(rowsToImport);
      setCommitted(result.created);
      onImported(result.created);
    } finally {
      setCommitting(false);
    }
  }

  const requiredFieldsMapped = TARGET_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);

  return (
    <div className="flex flex-col gap-16">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          id="csv-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <label htmlFor="csv-import-input">
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Choose a CSV or XLSX file
          </Button>
        </label>
      </div>

      {parseError ? (
        <p role="alert" className="text-meta text-out">
          {parseError}
        </p>
      ) : null}

      {sheet ? (
        <>
          <div>
            <h4 className="mb-8 text-table font-semibold text-ink">Match your columns</h4>
            <div className="grid grid-cols-2 gap-12 md:grid-cols-3">
              {TARGET_FIELDS.map((field) => (
                <Select
                  key={field.key}
                  label={`${field.label}${field.required ? " *" : ""}`}
                  value={mapping[field.key] ?? ""}
                  onChange={(v) => setMapping((m) => ({ ...m, [field.key]: v }))}
                  options={sheet.headers.map((h) => ({ value: h, label: h }))}
                  placeholder="Not mapped"
                />
              ))}
            </div>
          </div>

          {preview ? (
            <div>
              <div className="mb-8 flex items-center justify-between">
                <h4 className="text-table font-semibold text-ink">
                  Preview — first {Math.min(20, preview.rows.length)} of {preview.rows.length} rows
                </h4>
                <p className="text-meta text-ink-soft">
                  {preview.validCount} valid · {preview.errorCount} with errors ·{" "}
                  {preview.duplicateCount} duplicate
                </p>
              </div>
              <div className="scroll-x-safe rounded border border-rule">
                <table className="w-full min-w-full border-collapse text-table">
                  <thead>
                    <tr className="bg-steel text-white">
                      <th className="px-8 py-4 text-left text-micro uppercase tracking-tracked">Row</th>
                      <th className="px-8 py-4 text-left text-micro uppercase tracking-tracked">Name</th>
                      <th className="px-8 py-4 text-left text-micro uppercase tracking-tracked">SKU</th>
                      <th className="px-8 py-4 text-right text-micro uppercase tracking-tracked">Cost</th>
                      <th className="px-8 py-4 text-right text-micro uppercase tracking-tracked">Price</th>
                      <th className="px-8 py-4 text-left text-micro uppercase tracking-tracked">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 20).map((row) => (
                      <tr key={row.rowNumber} className="border-b border-rule">
                        <td className="px-8 py-4 font-mono">{row.rowNumber}</td>
                        <td className="px-8 py-4">{row.name || "—"}</td>
                        <td className="px-8 py-4 font-mono">{row.sku || "—"}</td>
                        <td className="px-8 py-4 text-right font-mono">{(row.costMinor / 100).toLocaleString()}</td>
                        <td className="px-8 py-4 text-right font-mono">{(row.priceMinor / 100).toLocaleString()}</td>
                        <td className="px-8 py-4">
                          {row.errors.length === 0 ? (
                            <span className="text-in">Ready</span>
                          ) : (
                            <span className="text-out">{row.errors.join(" ")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!requiredFieldsMapped ? (
                <p role="alert" className="mt-8 text-meta text-out">
                  Map every required column (Product name, SKU, Cost price, Selling price) before importing.
                </p>
              ) : null}

              <div className="mt-16 flex flex-wrap items-center gap-8">
                <Button
                  variant="primary"
                  disabled={!requiredFieldsMapped || preview.validCount === 0 || committing}
                  disabledReason={
                    !requiredFieldsMapped ? "Map every required column first." : preview.validCount === 0 ? "No valid rows to import." : undefined
                  }
                  onClick={() => void handleImport(true)}
                >
                  {committing ? "Importing…" : `Import ${preview.validCount} valid rows`}
                </Button>
                {preview.errorCount > 0 ? (
                  <>
                    <Button variant="secondary" onClick={downloadCorrectedTemplate}>
                      Download corrected template
                    </Button>
                    <span className="text-meta text-ink-soft">or</span>
                    <Button
                      variant="ghost"
                      disabled={!requiredFieldsMapped || committing}
                      onClick={() => void handleImport(false)}
                    >
                      Import anyway (skips {preview.errorCount} bad rows)
                    </Button>
                  </>
                ) : null}
              </div>

              {committed !== null ? (
                <p role="status" className="mt-8 text-meta text-in">
                  Imported {committed} products.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
