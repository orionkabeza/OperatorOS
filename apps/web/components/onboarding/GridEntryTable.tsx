"use client";

import { useRef, useState } from "react";
import { Button } from "../design/Button";
import { createProduct } from "@/lib/api/products";
import { minorUnits } from "@operatoros/shared";

interface GridRow {
  name: string;
  sku: string;
  unit: string;
  cost: string;
  price: string;
  openingQty: string;
}

const COLUMNS: { key: keyof GridRow; label: string; width: string }[] = [
  { key: "name", label: "Name", width: "flex-1" },
  { key: "sku", label: "SKU", width: "w-96" },
  { key: "unit", label: "Unit", width: "w-96" },
  { key: "cost", label: "Cost", width: "w-96" },
  { key: "price", label: "Price", width: "w-96" },
  { key: "openingQty", label: "Opening qty", width: "w-96" },
];

function emptyRow(): GridRow {
  return { name: "", sku: "", unit: "piece", cost: "", price: "", openingQty: "0" };
}

/** D.2 Step 3 "Type them in" — fast, keyboard-first grid entry. Tab moves cell to cell natively (real <input> tab order); Enter always appends a fresh row and focuses its first cell, from any column. */
export function GridEntryTable({ onSaved }: { onSaved: (count: number) => void }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  function updateCell(rowIndex: number, key: keyof GridRow, value: string) {
    setRows((prev) => prev.map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row)));
  }

  function addRow(focusFirstCellOfNew = true) {
    setRows((prev) => {
      const next = [...prev, emptyRow()];
      if (focusFirstCellOfNew) {
        const newIndex = next.length - 1;
        requestAnimationFrame(() => {
          cellRefs.current.get(`${newIndex}-name`)?.focus();
        });
      }
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addRow();
    }
  }

  const nonEmptyRows = rows.filter((r) => r.name.trim() && r.sku.trim());

  async function handleSaveAll() {
    setSaving(true);
    try {
      for (const row of nonEmptyRows) {
        await createProduct({
          name: row.name.trim(),
          sku: row.sku.trim(),
          categoryId: "cat-tools",
          unitId: "unit-piece",
          costMinor: minorUnits(Math.round((Number.parseFloat(row.cost) || 0) * 100)),
          priceMinor: minorUnits(Math.round((Number.parseFloat(row.price) || 0) * 100)),
          openingQty: row.openingQty || "0",
        });
      }
      setSavedCount(nonEmptyRows.length);
      onSaved(nonEmptyRows.length);
      setRows([emptyRow(), emptyRow(), emptyRow()]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-12">
      <p className="text-meta text-ink-soft">
        Tab moves across the row, Enter starts a new row. Name and SKU are required to save a row.
      </p>
      <div className="scroll-x-safe rounded border border-rule">
        <table className="w-full min-w-full border-collapse text-table">
          <thead>
            <tr className="bg-steel text-white">
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-8 py-4 text-left text-micro uppercase tracking-tracked">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-rule">
                {COLUMNS.map((col) => (
                  <td key={col.key} className="p-4">
                    <input
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${rowIndex}-${col.key}`, el);
                      }}
                      aria-label={`Row ${rowIndex + 1} ${col.label}`}
                      value={row[col.key]}
                      onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="h-control w-full rounded border border-rule bg-paper px-8 text-table text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-8">
        <Button variant="secondary" type="button" onClick={() => addRow()}>
          Add row
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={nonEmptyRows.length === 0 || saving}
          disabledReason={nonEmptyRows.length === 0 ? "Enter at least one product with a name and SKU." : undefined}
          onClick={() => void handleSaveAll()}
        >
          {saving ? "Saving…" : `Save ${nonEmptyRows.length || ""} products`}
        </Button>
      </div>
      {savedCount !== null ? (
        <p role="status" className="text-meta text-in">
          Saved {savedCount} products.
        </p>
      ) : null}
    </div>
  );
}
