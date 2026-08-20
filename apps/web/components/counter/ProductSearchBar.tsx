"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../design/Button";
import { BarcodeTimingTracker } from "@/lib/barcode";
import type { Product } from "@/lib/api/types";

/**
 * D.4 product search: fuzzy-ish substring match across name/SKU/barcode/
 * aliases (server-side, via useProducts({search})), numeric-SKU exact
 * match, barcode-HID-timing detection, Enter-adds-top-result,
 * Shift+Enter-adds-and-opens-qty, and the "no match" inline create row.
 */
export function ProductSearchBar({
  allProducts,
  topResult,
  query,
  onQueryChange,
  onAdd,
  onCreateOneOff,
  focusSignal,
}: {
  allProducts: Product[];
  topResult: Product | null;
  query: string;
  onQueryChange: (q: string) => void;
  onAdd: (product: Product, opts?: { openQtyField?: boolean }) => void;
  onCreateOneOff: (name: string, asPermanent: boolean) => void;
  /** Bump this value (e.g. a counter) to refocus the field — spec: autofocus on load and after every completed sale. */
  focusSignal: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trackerRef = useRef(new BarcodeTimingTracker());
  const [lastWasBarcode, setLastWasBarcode] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  function findExact(value: string): Product | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const byBarcode = allProducts.find((p) => p.barcode === trimmed);
    if (byBarcode) return byBarcode;
    const bySku = allProducts.find((p) => p.sku.toLowerCase() === trimmed.toLowerCase());
    return bySku;
  }

  function handleChange(value: string) {
    onQueryChange(value);
    setLastWasBarcode(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    trackerRef.current.record();

    if (e.key === "Enter") {
      const isScan = trackerRef.current.isLikelyScan();
      setLastWasBarcode(isScan);
      const exact = findExact(query);
      const candidate = exact ?? (query.trim() && /^\d+$/.test(query.trim()) ? findExact(query) : undefined) ?? topResult ?? undefined;
      if (candidate) {
        e.preventDefault();
        onAdd(candidate, { openQtyField: e.shiftKey });
        onQueryChange("");
        trackerRef.current.reset();
      }
    }
  }

  const noMatch = query.trim().length > 0 && !topResult;

  return (
    <div className="flex flex-col gap-8">
      <label htmlFor="counter-search" className="sr-only">
        Search products or scan a barcode
      </label>
      <input
        ref={inputRef}
        id="counter-search"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => trackerRef.current.reset()}
        placeholder="Search by name, SKU, or scan a barcode…"
        className="h-control-lg w-full rounded border border-rule bg-paper px-16 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
      />
      {lastWasBarcode ? (
        <p role="status" className="text-meta text-ink-soft">
          Detected as a barcode scan.
        </p>
      ) : null}
      {noMatch ? (
        <div className="flex flex-wrap items-center gap-8 rounded border border-rule bg-paper px-16 py-12">
          <span className="text-body text-ink">
            No product called &quot;{query.trim()}&quot;.
          </span>
          <Button variant="secondary" type="button" onClick={() => onCreateOneOff(query.trim(), true)}>
            Create it
          </Button>
          <Button variant="ghost" type="button" onClick={() => onCreateOneOff(query.trim(), false)}>
            Sell as a one-off item
          </Button>
        </div>
      ) : null}
    </div>
  );
}
