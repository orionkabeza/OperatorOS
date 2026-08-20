"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Drawer } from "../design/Drawer";
import { Money } from "../design/Money";
import { Qty } from "../design/Qty";
import { qtyToNumber } from "@/lib/decimal";
import { useStockMovements } from "@/lib/queries/stock";
import type { Product } from "@/lib/api/types";

function marginPercent(product: Product): number {
  if (product.priceMinor === 0) return 0;
  return ((product.priceMinor - product.costMinor) / product.priceMinor) * 100;
}

/** D.5.2 — product detail drawer, 720px, tabbed. Suppliers tab deferred to Phase 3 per docs/plans/phase-1.md §4. */
export function ProductDetailDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { data: movements } = useStockMovements({ productId: product?.id });

  return (
    <Drawer open={Boolean(product)} onOpenChange={(next) => !next && onClose()} title={product?.name ?? ""} size="detail">
      {product ? (
        <Tabs.Root defaultValue="details">
          <Tabs.List aria-label="Product detail sections" className="flex gap-4 border-b border-rule">
            {(["details", "pricing", "stock", "movement"] as const).map((t) => (
              <Tabs.Trigger
                key={t}
                value={t}
                className="border-b-2 border-transparent px-12 py-8 text-table font-semibold capitalize text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
              >
                {t}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="details" className="flex flex-col gap-12 pt-16">
            <div className="grid grid-cols-2 gap-8 text-table">
              <span className="text-ink-soft">SKU</span>
              <span className="font-mono text-ink">{product.sku}</span>
              <span className="text-ink-soft">Barcode</span>
              <span className="font-mono text-ink">{product.barcode ?? "—"}</span>
              <span className="text-ink-soft">Category</span>
              <span className="text-ink">{product.categoryName}</span>
              <span className="text-ink-soft">Unit</span>
              <span className="text-ink">{product.unitName}</span>
              <span className="text-ink-soft">Tax class</span>
              <span className="text-ink">{product.taxClass}</span>
            </div>
            <div>
              <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Also known as</p>
              {product.aliases.length > 0 ? (
                <p className="text-body text-ink">{product.aliases.join(", ")}</p>
              ) : (
                <p className="text-meta text-ink-soft">No aliases recorded.</p>
              )}
            </div>
            <div>
              <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Unit conversions</p>
              <ul className="text-body text-ink">
                {product.unitConversions.map((u) => (
                  <li key={u.unitId}>
                    1 {u.unitName} = {u.factorToBase} {product.unitName}
                    {u.factorToBase !== 1 ? "s" : ""}
                  </li>
                ))}
              </ul>
            </div>
          </Tabs.Content>

          <Tabs.Content value="pricing" className="flex flex-col gap-12 pt-16">
            <div className="grid grid-cols-2 gap-8 text-table">
              <span className="text-ink-soft">Cost price</span>
              <Money amount={product.costMinor} />
              <span className="text-ink-soft">Selling price</span>
              <Money amount={product.priceMinor} />
              <span className="text-ink-soft">Wholesale price</span>
              {product.wholesalePriceMinor != null ? <Money amount={product.wholesalePriceMinor} /> : <span>—</span>}
              <span className="text-ink-soft">Minimum selling price</span>
              {product.minSellPriceMinor != null ? <Money amount={product.minSellPriceMinor} /> : <span>—</span>}
              <span className="text-ink-soft">Margin</span>
              <span className={marginPercent(product) < 0 ? "text-out" : "text-in"}>{marginPercent(product).toFixed(1)}%</span>
            </div>
            <p className="text-meta text-ink-soft">Price history charting lands with fuller Back Office reporting (Phase 4) — not faked here.</p>
          </Tabs.Content>

          <Tabs.Content value="stock" className="flex flex-col gap-12 pt-16">
            <div className="grid grid-cols-2 gap-8 text-table">
              <span className="text-ink-soft">On hand (all locations)</span>
              <Qty value={qtyToNumber(product.onHand)} unit={product.unitName} />
              <span className="text-ink-soft">Reorder point</span>
              <Qty value={qtyToNumber(product.reorderPoint)} unit={product.unitName} />
              <span className="text-ink-soft">Reorder quantity</span>
              <Qty value={qtyToNumber(product.reorderQty)} unit={product.unitName} />
            </div>
            <div>
              <p className="mb-4 text-micro font-semibold uppercase tracking-tracked text-ink-soft">By location</p>
              <ul className="flex flex-col gap-4 text-table">
                {product.locations.map((l) => (
                  <li key={l.locationId} className="flex items-center justify-between">
                    <span className="text-ink">{l.locationName}</span>
                    <Qty value={qtyToNumber(l.onHand)} unit={product.unitName} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-4 text-micro font-semibold uppercase tracking-tracked text-ink-soft">Stock card (reverse-chronological)</p>
              {!movements || movements.length === 0 ? (
                <p className="text-meta text-ink-soft">No movements recorded yet.</p>
              ) : (
                <table className="w-full border-collapse text-table">
                  <thead>
                    <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                      <th className="py-4">Date</th>
                      <th className="py-4">Type</th>
                      <th className="py-4 text-right">Qty</th>
                      <th className="py-4 text-right">Balance</th>
                      <th className="py-4">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-t border-rule">
                        <td className="py-4">{new Date(m.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="py-4 capitalize">{m.type.replace(/_/g, " ")}</td>
                        <td className="py-4 text-right font-mono">{m.qtyDelta}</td>
                        <td className="py-4 text-right font-mono">{m.balanceAfter}</td>
                        <td className="py-4 text-meta text-ink-soft">{m.reference ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Tabs.Content>

          <Tabs.Content value="movement" className="flex flex-col gap-12 pt-16">
            <p className="text-body text-ink-soft">
              Sell-through charting and days-of-cover need a real trading history to be meaningful — this demo session&apos;s data is too fresh to
              show them honestly rather than fake a curve. The movements ledger above (Stock tab) is the real, current record.
            </p>
          </Tabs.Content>
        </Tabs.Root>
      ) : null}
    </Drawer>
  );
}
