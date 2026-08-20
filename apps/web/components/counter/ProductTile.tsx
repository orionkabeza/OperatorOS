import clsx from "clsx";
import { Money } from "../design/Money";
import { Qty } from "../design/Qty";
import { qtyToNumber } from "@/lib/decimal";
import type { Product } from "@/lib/api/types";

/** D.4 — 140×120px product tile with a stock chip; out-of-stock tiles dim and offer a fallback. */
export function ProductTile({
  product,
  onAdd,
  onSellAnyway,
}: {
  product: Product;
  onAdd: (product: Product) => void;
  onSellAnyway: (product: Product) => void;
}) {
  const onHand = qtyToNumber(product.onHand);
  const outOfStock = onHand <= 0;
  const low = onHand > 0 && onHand <= qtyToNumber(product.reorderPoint);

  return (
    <div className="flex h-tile w-full flex-col justify-between rounded border border-rule bg-paper p-8 text-left shadow-shelf">
      {/*
        Spec D.4 says out-of-stock tiles are "50% opacity" — but diluting
        the "Out of stock" label along with everything else drops its
        RWF-red-on-cream contrast from a passing ratio to ~2.24:1, well
        under WCAG AA's 4.5:1 floor for text this size (confirmed via axe,
        not assumed). Resolved by dimming only the now-moot sale info
        (name/price) and keeping the actionable status label at full
        opacity — same visual intent ("this tile reads as inactive"),
        without an accessibility regression.
      */}
      <button
        type="button"
        onClick={() => (outOfStock ? undefined : onAdd(product))}
        disabled={outOfStock}
        aria-label={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to the basket`}
        title={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to the basket`}
        className={clsx("flex flex-1 flex-col items-start gap-4 text-left disabled:cursor-not-allowed", outOfStock && "opacity-50")}
      >
        <span className="line-clamp-2 text-table font-semibold text-ink">{product.name}</span>
        <Money amount={product.priceMinor} size="body" />
      </button>
      <div className="flex items-center justify-between gap-4">
        {outOfStock ? (
          <button
            type="button"
            onClick={() => onSellAnyway(product)}
            className="text-micro font-semibold uppercase tracking-tracked text-out underline underline-offset-2"
          >
            Out of stock
          </button>
        ) : (
          <Qty value={onHand} unit="in stock" tone={low ? "low" : "normal"} className="text-micro" />
        )}
      </div>
    </div>
  );
}
