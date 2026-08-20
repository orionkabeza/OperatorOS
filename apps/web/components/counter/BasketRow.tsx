"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { Money } from "../design/Money";
import { lineTotalMinor } from "@/lib/basket-math";
import { addQty, qtyToNumber, subQty } from "@/lib/decimal";
import type { BasketLine } from "@/lib/stores/basket-store";
import type { Product } from "@/lib/api/types";

/**
 * D.4 basket row: quantity stepper, unit price (click to edit), line total,
 * remove, and a menu for change price / line discount / note / unit
 * conversion — spec calls this out as a long-press/right-click menu; a
 * visible "⋮" button is the accessible equivalent (long-press/right-click
 * has no reliable keyboard or screen-reader affordance).
 */
export function BasketRow({
  line,
  product,
  autoFocusQty,
  onQtyChange,
  onPriceChange,
  onDiscountChange,
  onNoteChange,
  onUnitChange,
  onRemove,
}: {
  line: BasketLine;
  product: Product | undefined;
  autoFocusQty: boolean;
  onQtyChange: (qty: string) => void;
  onPriceChange: (priceMinor: number) => void;
  onDiscountChange: (discountMinor: number) => void;
  onNoteChange: (note: string) => void;
  onUnitChange: (unitId: string, unitPriceMinor: number) => void;
  onRemove: () => void;
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const lineTotal = lineTotalMinor(line);

  return (
    <li className="flex flex-col gap-4 border-b border-rule py-8">
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-ink">{line.name}</p>
          {line.note ? <p className="text-meta text-ink-soft">{line.note}</p> : null}
        </div>
        <Money amount={lineTotal} />
      </div>
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-4" role="group" aria-label={`Quantity for ${line.name}`}>
          <button
            type="button"
            aria-label={`Decrease quantity of ${line.name}`}
            onClick={() => onQtyChange(subQty(line.qty, "1"))}
            className="flex h-control w-control items-center justify-center rounded border border-rule text-table text-ink hover:border-steel"
          >
            −
          </button>
          <input
            aria-label={`Quantity of ${line.name}`}
            autoFocus={autoFocusQty}
            value={line.qty}
            onChange={(e) => onQtyChange(e.target.value)}
            inputMode="decimal"
            className="h-control w-64 rounded border border-rule bg-paper px-8 text-center font-mono text-table text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
          />
          <button
            type="button"
            aria-label={`Increase quantity of ${line.name}`}
            onClick={() => onQtyChange(addQty(line.qty, "1"))}
            className="flex h-control w-control items-center justify-center rounded border border-rule text-table text-ink hover:border-steel"
          >
            +
          </button>
          {product && product.unitConversions.length > 1 ? (
            <select
              aria-label={`Unit for ${line.name}`}
              value={line.unitId}
              onChange={(e) => {
                const conv = product.unitConversions.find((u) => u.unitId === e.target.value);
                if (conv) onUnitChange(conv.unitId, product.priceMinor * conv.factorToBase);
              }}
              className="h-control rounded border border-rule bg-paper px-4 text-meta text-ink"
            >
              {product.unitConversions.map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {u.unitName}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="flex items-center gap-8">
          {editingPrice ? (
            <input
              autoFocus
              aria-label={`Unit price for ${line.name}`}
              defaultValue={String(line.unitPriceMinor / 100)}
              onBlur={(e) => {
                onPriceChange(Math.round((Number.parseFloat(e.target.value) || 0) * 100));
                setEditingPrice(false);
              }}
              className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
            />
          ) : (
            <button type="button" onClick={() => setEditingPrice(true)} className="text-meta text-ink-soft underline underline-offset-2">
              <Money amount={line.unitPriceMinor} size="body" />
            </button>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${line.name}`}
                className="flex h-control w-control items-center justify-center rounded text-ink-soft hover:text-ink"
              >
                ⋮
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-40 w-categories rounded border border-rule bg-paper p-4 shadow-shelf"
              >
                <DropdownMenu.Item
                  onSelect={() => setEditingPrice(true)}
                  className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
                >
                  Change price
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setEditingDiscount(true)}
                  className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
                >
                  Apply line discount
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setEditingNote(true)}
                  className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
                >
                  Add note
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onRemove}
                  className="cursor-pointer rounded px-12 py-8 text-table text-out outline-none hover:bg-floor"
                >
                  Remove
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {editingDiscount ? (
        <div className="flex items-center gap-8">
          <label className="text-meta text-ink-soft">Line discount (RWF)</label>
          <input
            autoFocus
            aria-label={`Line discount for ${line.name}`}
            defaultValue={String(line.lineDiscountMinor / 100)}
            onBlur={(e) => {
              onDiscountChange(Math.round((Number.parseFloat(e.target.value) || 0) * 100));
              setEditingDiscount(false);
            }}
            className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
          />
        </div>
      ) : null}

      {editingNote ? (
        <input
          autoFocus
          aria-label={`Note for ${line.name}`}
          defaultValue={line.note ?? ""}
          onBlur={(e) => {
            onNoteChange(e.target.value);
            setEditingNote(false);
          }}
          className="h-control w-full rounded border border-rule bg-paper px-8 text-table text-ink"
        />
      ) : null}

      {product && qtyToNumber(line.qty) > qtyToNumber(product.onHand) ? (
        <p role="alert" className="text-meta text-out">
          Only {product.onHand} in stock — this line will create negative stock.
        </p>
      ) : null}
    </li>
  );
}
