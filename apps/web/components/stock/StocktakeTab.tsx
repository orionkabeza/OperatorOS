"use client";

import * as Checkbox from "@radix-ui/react-checkbox";
import { useMemo, useState } from "react";
import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { EmptyState } from "../design/EmptyState";
import { useCategories } from "@/lib/queries/products";
import {
  useCountStocktakeLine,
  useMoveStocktakeToReview,
  usePostStocktake,
  useStartStocktake,
  useStocktakes,
} from "@/lib/queries/stock";
import { compareQty } from "@/lib/decimal";
import { minorUnits } from "@operatoros/shared";

/** D.5.4 — "a first-class workflow, not a form": start -> count -> review -> post. */
export function StocktakeTab() {
  const { data: stocktakes } = useStocktakes();
  const { data: categories } = useCategories();
  const startStocktake = useStartStocktake();
  const countLine = useCountStocktakeLine();
  const moveToReview = useMoveStocktakeToReview();
  const postStocktake = usePostStocktake();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [scopeCategoryId, setScopeCategoryId] = useState("");
  const [freezeItems, setFreezeItems] = useState(true);
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});

  const active = stocktakes?.find((s) => s.id === activeId) ?? null;

  const countedCount = active ? active.lines.filter((l) => l.countedQty !== null).length : 0;

  const sortedForReview = useMemo(() => {
    if (!active) return [];
    return [...active.lines]
      .filter((l) => l.varianceQty !== null && l.varianceQty !== "0")
      .sort((a, b) => Math.abs(b.varianceValueMinor ?? 0) - Math.abs(a.varianceValueMinor ?? 0));
  }, [active]);

  const shrinkageMinor = sortedForReview.reduce((sum, l) => sum + Math.min(0, l.varianceValueMinor ?? 0), 0);

  if (!active) {
    return (
      <div className="flex flex-col gap-16">
        <div className="flex flex-wrap items-end gap-8 rounded border border-rule bg-paper p-16">
          <select
            aria-label="Stock-take scope"
            value={scopeCategoryId}
            onChange={(e) => setScopeCategoryId(e.target.value)}
            className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
          >
            <option value="">Whole shop</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-8 text-body text-ink">
            <Checkbox.Root
              checked={freezeItems}
              onCheckedChange={(v) => setFreezeItems(v === true)}
              className="h-16 w-16 rounded border border-rule bg-paper data-[state=checked]:border-tape-deep data-[state=checked]:bg-tape"
            >
              <Checkbox.Indicator>✓</Checkbox.Indicator>
            </Checkbox.Root>
            Freeze counted items (blocks sales during the count)
          </label>
          <Button
            variant="primary"
            type="button"
            onClick={() =>
              void startStocktake
                .mutateAsync({ scope: scopeCategoryId ? { categoryId: scopeCategoryId } : "all", freezeItems })
                .then((st) => setActiveId(st.id))
            }
          >
            Start a stock-take
          </Button>
        </div>

        {stocktakes && stocktakes.length > 0 ? (
          <ul className="flex flex-col gap-8">
            {stocktakes.map((st) => (
              <li key={st.id} className="flex items-center justify-between rounded border border-rule bg-paper px-16 py-8">
                <span className="text-body text-ink">
                  {st.scopeLabel} · {st.status} · started {new Date(st.startedAt).toLocaleDateString("en-GB")}
                </span>
                {st.status !== "posted" ? (
                  <Button variant="secondary" type="button" onClick={() => setActiveId(st.id)}>
                    Continue
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState statement="No stock-takes yet. Start one above to count what you actually have." />
        )}
      </div>
    );
  }

  if (active.status === "counting") {
    const items = [...active.lines].sort((a, b) => {
      const aCounted = a.countedQty !== null;
      const bCounted = b.countedQty !== null;
      if (aCounted !== bCounted) return aCounted ? 1 : -1;
      return a.productName.localeCompare(b.productName);
    });
    return (
      <div className="flex max-w-form flex-col gap-16">
        <p className="text-body text-ink">
          {countedCount} of {active.lines.length} counted
        </p>
        <ul className="flex flex-col gap-4">
          {items.map((line) => {
            const counted = line.countedQty !== null;
            return (
              <li key={line.productId} className={`flex items-center justify-between rounded border border-rule px-12 py-8 ${counted ? "bg-floor opacity-60" : "bg-paper"}`}>
                <span className="text-body text-ink">{line.productName}</span>
                <input
                  aria-label={`Counted quantity for ${line.productName}`}
                  inputMode="decimal"
                  value={countInputs[line.productId] ?? line.countedQty ?? ""}
                  onChange={(e) => setCountInputs((prev) => ({ ...prev, [line.productId]: e.target.value }))}
                  onBlur={(e) => {
                    if (e.target.value.trim() === "") return;
                    void countLine.mutateAsync({ stocktakeId: active.id, productId: line.productId, countedQty: e.target.value.trim() });
                  }}
                  className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-ink"
                />
              </li>
            );
          })}
        </ul>
        <Button variant="primary" type="button" onClick={() => void moveToReview.mutateAsync(active.id)}>
          Review
        </Button>
      </div>
    );
  }

  if (active.status === "review") {
    return (
      <div className="flex max-w-form flex-col gap-16">
        <p className="text-body font-semibold text-ink">
          Shrinkage: <Money amount={minorUnits(Math.abs(shrinkageMinor))} emphasis={shrinkageMinor < 0 ? "out" : undefined} /> across{" "}
          {sortedForReview.length} items
        </p>
        {sortedForReview.length === 0 ? (
          <p className="text-body text-ink-soft">No variances — everything matched.</p>
        ) : (
          <table className="w-full border-collapse text-table">
            <thead>
              <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                <th className="py-4">Product</th>
                <th className="py-4 text-right">Expected</th>
                <th className="py-4 text-right">Counted</th>
                <th className="py-4 text-right">Variance qty</th>
                <th className="py-4 text-right">Variance value</th>
              </tr>
            </thead>
            <tbody>
              {sortedForReview.map((line) => (
                <tr key={line.productId} className="border-t border-rule">
                  <td className="py-8">{line.productName}</td>
                  <td className="py-8 text-right font-mono">{line.expectedQty}</td>
                  <td className="py-8 text-right font-mono">{line.countedQty}</td>
                  <td className="py-8 text-right font-mono">
                    <span className={compareQty(line.varianceQty ?? "0", "0") < 0 ? "text-out" : "text-in"}>{line.varianceQty}</span>
                  </td>
                  <td className="py-8 text-right">
                    <Money amount={minorUnits(line.varianceValueMinor ?? 0)} emphasis={(line.varianceValueMinor ?? 0) < 0 ? "out" : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex gap-8">
          <Button variant="ghost" type="button" onClick={() => setActiveId(null)}>
            Back to list
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() =>
              void postStocktake.mutateAsync(active.id).then(() => {
                setActiveId(null);
              })
            }
          >
            Post stock-take
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-body text-in">This stock-take was posted on {active.postedAt ? new Date(active.postedAt).toLocaleString("en-GB") : ""}.</p>
      <Button variant="ghost" type="button" onClick={() => setActiveId(null)}>
        Back to list
      </Button>
    </div>
  );
}
