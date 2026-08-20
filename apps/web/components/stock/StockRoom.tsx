"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { MovementsTab } from "./MovementsTab";
import { ProductsTab } from "./ProductsTab";
import { StocktakeTab } from "./StocktakeTab";
import { TransfersTab } from "./TransfersTab";

/** D.5 — Stock Room. */
export function StockRoom() {
  const [tab, setTab] = useState<"products" | "movements" | "stocktake" | "transfers">("products");

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <Tabs.List aria-label="Stock Room sections" className="flex gap-4 border-b border-rule">
        {([
          ["products", "Products"],
          ["movements", "Movements"],
          ["stocktake", "Stock-take"],
          ["transfers", "Transfers"],
        ] as const).map(([value, label]) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className="border-b-2 border-transparent px-16 py-8 text-table font-semibold uppercase tracking-wide text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="pt-16">
        <Tabs.Content value="products">
          <ProductsTab />
        </Tabs.Content>
        <Tabs.Content value="movements">
          <MovementsTab />
        </Tabs.Content>
        <Tabs.Content value="stocktake">
          <StocktakeTab />
        </Tabs.Content>
        <Tabs.Content value="transfers">
          <TransfersTab />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
