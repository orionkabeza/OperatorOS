import { EmptyState } from "../design/EmptyState";
import { ProductTile } from "./ProductTile";
import type { Product } from "@/lib/api/types";

export function ProductGrid({
  products,
  onAdd,
  onSellAnyway,
}: {
  products: Product[];
  onAdd: (product: Product) => void;
  onSellAnyway: (product: Product) => void;
}) {
  if (products.length === 0) {
    return <EmptyState statement="No products match that search or category." />;
  }
  return (
    <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5" role="list" aria-label="Products">
      {products.map((product) => (
        <div key={product.id} role="listitem">
          <ProductTile product={product} onAdd={onAdd} onSellAnyway={onSellAnyway} />
        </div>
      ))}
    </div>
  );
}
