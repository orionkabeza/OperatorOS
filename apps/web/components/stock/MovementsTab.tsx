"use client";

import Papa from "papaparse";
import { useState } from "react";
import { Table, type TableColumn } from "../design/Table";
import { useStockMovements } from "@/lib/queries/stock";
import type { StockMovement, StockMovementType } from "@/lib/api/types";

const TYPES: StockMovementType[] = ["sale", "purchase_receipt", "return", "adjustment", "transfer", "write_off", "stocktake_correction"];

/** D.5.3 — "the 'why did my count change' screen." Read-only, exportable, every movement across every product. */
export function MovementsTab() {
  const [type, setType] = useState<StockMovementType | "">("");
  const { data: movements } = useStockMovements(type ? { type } : undefined);

  const columns: TableColumn<StockMovement>[] = [
    { key: "timestamp", label: "Date", render: (m) => new Date(m.timestamp).toLocaleString("en-GB"), sortValue: (m) => m.timestamp },
    { key: "product", label: "Product", render: (m) => m.productName, sortValue: (m) => m.productName },
    { key: "type", label: "Type", render: (m) => m.type.replace(/_/g, " ") },
    { key: "qty", label: "Qty", numeric: true, render: (m) => m.qtyDelta },
    { key: "balance", label: "Balance after", numeric: true, render: (m) => m.balanceAfter },
    { key: "user", label: "User", render: (m) => m.userName },
    { key: "reference", label: "Reference", render: (m) => m.reference ?? "—" },
  ];

  function exportCsv() {
    if (!movements) return;
    const csv = Papa.unparse(
      movements.map((m) => ({
        date: m.timestamp,
        product: m.productName,
        type: m.type,
        qty: m.qtyDelta,
        balance_after: m.balanceAfter,
        user: m.userName,
        reference: m.reference ?? "",
      })),
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock-movements.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-16">
      <select
        aria-label="Filter by movement type"
        value={type}
        onChange={(e) => setType(e.target.value as StockMovementType | "")}
        className="h-control w-fit rounded border border-rule bg-paper px-8 text-table text-ink"
      >
        <option value="">All movement types</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <Table columns={columns} rows={movements ?? []} onExportCsv={exportCsv} emptyMessage="No stock movements recorded yet." />
    </div>
  );
}
