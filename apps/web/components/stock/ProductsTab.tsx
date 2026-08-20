"use client";

import { minorUnits } from "@operatoros/shared";
import clsx from "clsx";
import { useState } from "react";
import { Money } from "../design/Money";
import { Qty } from "../design/Qty";
import { Table, type TableColumn } from "../design/Table";
import { ProductDetailDrawer } from "./ProductDetailDrawer";
import { qtyToNumber } from "@/lib/decimal";
import { useCategories, useProducts } from "@/lib/queries/products";
import type { Product, ProductFilters } from "@/lib/api/types";

const QUICK_FILTERS: { id: NonNullable<ProductFilters["quickFilter"]> | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "low-stock", label: "Low stock" },
  { id: "out-of-stock", label: "Out of stock" },
  { id: "negative-stock", label: "Negative stock" },
  { id: "expiring-30d", label: "Expiring in 30 days" },
  { id: "no-movement-90d", label: "No movement in 90d" },
  { id: "below-cost", label: "Below cost" },
];

function marginPercent(product: Product): number {
  if (product.priceMinor === 0) return 0;
  return ((product.priceMinor - product.costMinor) / product.priceMinor) * 100;
}

/** D.5.1 — dense product table with quick-filter chips. */
export function ProductsTab() {
  const [quickFilter, setQuickFilter] = useState<NonNullable<ProductFilters["quickFilter"]> | "all">("all");
  const [categoryId, setCategoryId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);

  const { data: categories } = useCategories();
  const { data: products } = useProducts({
    search: search || undefined,
    categoryId: categoryId || undefined,
    quickFilter: quickFilter === "all" ? undefined : quickFilter,
  });

  const columns: TableColumn<Product>[] = [
    { key: "name", label: "Name", render: (p) => p.name, sortValue: (p) => p.name },
    { key: "sku", label: "SKU", render: (p) => p.sku, sortValue: (p) => p.sku },
    { key: "category", label: "Category", render: (p) => p.categoryName, sortValue: (p) => p.categoryName },
    {
      key: "onHand",
      label: "On hand",
      numeric: true,
      render: (p) => <Qty value={qtyToNumber(p.onHand)} tone={qtyToNumber(p.onHand) < 0 ? "zero" : qtyToNumber(p.onHand) <= qtyToNumber(p.reorderPoint) ? "low" : "normal"} />,
      sortValue: (p) => qtyToNumber(p.onHand),
    },
    {
      key: "cost",
      label: "Unit cost",
      numeric: true,
      render: (p) => <Money amount={p.costMinor} />,
      sortValue: (p) => p.costMinor,
    },
    {
      key: "price",
      label: "Selling price",
      numeric: true,
      render: (p) => <Money amount={p.priceMinor} />,
      sortValue: (p) => p.priceMinor,
    },
    {
      key: "margin",
      label: "Margin %",
      numeric: true,
      render: (p) => {
        const m = marginPercent(p);
        return <span className={clsx("font-mono", m < 0 ? "text-out" : m < 15 ? "text-watch" : "text-in")}>{m.toFixed(1)}%</span>;
      },
      sortValue: (p) => marginPercent(p),
    },
    {
      key: "value",
      label: "Value on hand",
      numeric: true,
      render: (p) => <Money amount={minorUnits(Math.round(qtyToNumber(p.onHand) * p.costMinor))} />,
      sortValue: (p) => qtyToNumber(p.onHand) * p.costMinor,
    },
    {
      key: "status",
      label: "Status",
      render: (p) => {
        const onHand = qtyToNumber(p.onHand);
        if (onHand < 0) return <span className="text-out">Negative</span>;
        if (onHand === 0) return <span className="text-out">Out of stock</span>;
        if (onHand <= qtyToNumber(p.reorderPoint)) return <span className="text-watch">Low</span>;
        return <span className="text-in">OK</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center gap-8">
        <input
          aria-label="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="h-control rounded border border-rule bg-paper px-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
        />
        <select
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
        >
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-label="Quick filters" className="scroll-x-safe flex gap-4">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setQuickFilter(f.id)}
            aria-pressed={quickFilter === f.id}
            className={clsx(
              "h-control shrink-0 whitespace-nowrap rounded border px-12 text-meta font-semibold",
              quickFilter === f.id ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft hover:border-steel",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Table columns={columns} rows={products ?? []} onRowClick={setSelected} emptyMessage="No products match these filters." />

      <ProductDetailDrawer product={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
