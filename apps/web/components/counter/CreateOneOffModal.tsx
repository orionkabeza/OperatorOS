"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { minorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import { useCategories } from "@/lib/queries/products";
import { useCreateProduct } from "@/lib/queries/products";
import type { Product } from "@/lib/api/types";

/**
 * D.4 "no match" row: "[Create it] [Sell as a one-off item]". Both paths
 * create a real catalog product in this mock (see docs/DECISIONS.md) —
 * modeling a truly ephemeral, non-catalog sale line would need schema
 * changes not justified for Phase 1's scope, and the spec's own emphasis
 * ("nothing is manual twice") argues for always landing in the catalog
 * anyway. The distinction that matters operationally — did this get a
 * proper SKU/category or just a name and price — is preserved via the
 * `oneOff` flag on the pending product, used only to skip the category
 * step in this form, not persisted differently.
 */
export function CreateOneOffModal({
  open,
  name,
  oneOff,
  onClose,
  onCreated,
}: {
  open: boolean;
  name: string;
  oneOff: boolean;
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const { data: categories } = useCategories();
  const createProduct = useCreateProduct();
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-steel-deep/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-shutter max-w-full -translate-x-1/2 -translate-y-1/2 rounded border-t-4 border-tape bg-paper p-24 shadow-shelf">
          <Dialog.Title className="type-expanded font-display text-card-title font-bold text-ink">
            {oneOff ? "Sell as a one-off item" : "Create a new product"}
          </Dialog.Title>
          <Dialog.Description className="mt-4 text-meta text-ink-soft">&quot;{name}&quot;</Dialog.Description>

          <div className="mt-16 flex flex-col gap-12">
            <Input label="Selling price" money inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
            <Input label="Cost price" money inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>

          <div className="mt-24 flex justify-end gap-8">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button
              variant="primary"
              disabled={!price}
              onClick={async () => {
                const product = await createProduct.mutateAsync({
                  name,
                  sku: `ONEOFF-${Date.now()}`,
                  categoryId: categories?.[0]?.id ?? "cat-tools",
                  unitId: "unit-piece",
                  priceMinor: minorUnits(Math.round((Number.parseFloat(price) || 0) * 100)),
                  costMinor: minorUnits(Math.round((Number.parseFloat(cost) || 0) * 100)),
                  openingQty: "1",
                });
                onCreated(product);
                setPrice("");
                setCost("");
              }}
            >
              {oneOff ? "Add to basket" : "Create and add to basket"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
