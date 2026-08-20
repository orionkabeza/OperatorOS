"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { BasketRow } from "./BasketRow";
import { CustomerPicker } from "./CustomerPicker";
import { discountFromPercent, grandTotalMinor, subtotalMinor, vatMinor } from "@/lib/basket-math";
import { BUSINESS_VAT_REGISTERED, DEMO_MANAGER_PIN, DISCOUNT_MANAGER_PIN_THRESHOLD_PERCENT, VAT_RATE_PERCENT } from "@/lib/constants";
import { useBasketStore } from "@/lib/stores/basket-store";
import type { Product } from "@/lib/api/types";
import { minorUnits } from "@operatoros/shared";

export function Basket({
  products,
  dayOpen,
  onTakePayment,
  onParkSale,
  onSaveQuote,
  focusQtyLineId,
}: {
  products: Product[];
  dayOpen: boolean;
  onTakePayment: () => void;
  onParkSale: () => void;
  onSaveQuote: () => void;
  focusQtyLineId: string | null;
}) {
  const { lines, customerId, discount, setQty, setUnitPrice, setLineDiscount, setLineNote, setLineUnit, removeLine, setCustomer, setDiscount, clear } =
    useBasketStore();
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const subtotal = subtotalMinor(lines);
  const discountMinorValue =
    discount.mode === "percent" ? discountFromPercent(subtotal, discount.value) : minorUnits(discount.value);
  const vat = vatMinor(subtotal, discountMinorValue, { registered: BUSINESS_VAT_REGISTERED, ratePercent: VAT_RATE_PERCENT });
  const total = grandTotalMinor(subtotal, discountMinorValue, vat);

  const discountPercentEquivalent =
    discount.mode === "percent" ? discount.value : subtotal > 0 ? (discountMinorValue / subtotal) * 100 : 0;
  const needsManagerPin = discountPercentEquivalent > DISCOUNT_MANAGER_PIN_THRESHOLD_PERCENT && !discount.managerPinVerified;

  const empty = lines.length === 0;
  const takePaymentDisabled = empty || !dayOpen || needsManagerPin;
  const takePaymentReason = !dayOpen
    ? "Open the shop before recording a sale."
    : empty
      ? "Add at least one product to the basket."
      : needsManagerPin
        ? "A manager PIN is required for a discount this large."
        : undefined;

  function verifyPin() {
    if (pinInput === DEMO_MANAGER_PIN) {
      setDiscount({ managerPinVerified: true });
      setPinError(false);
      setPinInput("");
    } else {
      setPinError(true);
    }
  }

  return (
    <div className="flex h-full flex-col gap-16">
      <CustomerPicker customerId={customerId} onSelect={setCustomer} />

      <ul aria-label="Basket" className="flex-1 overflow-y-auto">
        {empty ? (
          <li className="py-24 text-center text-body text-ink-soft">The basket is empty. Search or scan a product to add it.</li>
        ) : (
          lines.map((line) => (
            <BasketRow
              key={line.lineId}
              line={line}
              product={productMap.get(line.productId)}
              autoFocusQty={focusQtyLineId === line.lineId}
              onQtyChange={(qty) => setQty(line.lineId, qty)}
              onPriceChange={(priceMinor) => setUnitPrice(line.lineId, minorUnits(priceMinor))}
              onDiscountChange={(discountMinorAmt) => setLineDiscount(line.lineId, minorUnits(discountMinorAmt))}
              onNoteChange={(note) => setLineNote(line.lineId, note)}
              onUnitChange={(unitId, priceMinor) => setLineUnit(line.lineId, unitId, minorUnits(priceMinor))}
              onRemove={() => removeLine(line.lineId)}
            />
          ))
        )}
      </ul>

      <div className="flex flex-col gap-8 border-t border-rule pt-16">
        <div className="flex items-center justify-between text-body text-ink">
          <span>Subtotal</span>
          <Money amount={subtotal} />
        </div>

        <div className="flex items-center justify-between gap-8 text-body text-ink">
          <div className="flex items-center gap-8">
            <span>Discount</span>
            <div className="flex overflow-hidden rounded border border-rule">
              <button
                type="button"
                onClick={() => setDiscount({ mode: "percent", managerPinVerified: false })}
                className={`px-8 py-4 text-micro font-semibold uppercase ${discount.mode === "percent" ? "bg-tape text-ink" : "text-ink-soft"}`}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setDiscount({ mode: "amount", managerPinVerified: false })}
                className={`px-8 py-4 text-micro font-semibold uppercase ${discount.mode === "amount" ? "bg-tape text-ink" : "text-ink-soft"}`}
              >
                RWF
              </button>
            </div>
            <input
              aria-label="Discount value"
              inputMode="decimal"
              value={discount.value || ""}
              onChange={(e) => setDiscount({ value: Number.parseFloat(e.target.value) || 0, managerPinVerified: false })}
              className="h-control w-64 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
            />
          </div>
          <Money amount={discountMinorValue} />
        </div>

        {needsManagerPin ? (
          <div className="flex items-center gap-8 rounded border border-watch bg-paper px-12 py-8">
            <label htmlFor="discount-pin" className="text-meta text-ink-soft">
              Manager PIN required for a discount over {DISCOUNT_MANAGER_PIN_THRESHOLD_PERCENT}%
            </label>
            <input
              id="discount-pin"
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              className="h-control w-96 rounded border border-rule bg-paper px-8 font-mono text-table text-ink"
            />
            <Button variant="secondary" type="button" onClick={verifyPin}>
              Verify
            </Button>
          </div>
        ) : null}
        {pinError ? (
          <p role="alert" className="text-meta text-out">
            Wrong PIN.
          </p>
        ) : null}

        {BUSINESS_VAT_REGISTERED ? (
          <div className="flex items-center justify-between text-body text-ink">
            <span>VAT {VAT_RATE_PERCENT}%</span>
            <Money amount={vat} />
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-rule pt-8">
          <span className="type-expanded font-display text-card-title font-bold text-ink">TOTAL</span>
          <Money amount={total} size="screen-title" />
        </div>

        <Button variant="primary" className="w-full" disabled={takePaymentDisabled} disabledReason={takePaymentReason} onClick={onTakePayment}>
          Take payment
        </Button>

        <div className="flex items-center justify-between gap-8">
          <Button variant="ghost" type="button" disabled={empty} onClick={onSaveQuote}>
            Save as quote
          </Button>
          <Button variant="ghost" type="button" disabled={empty} onClick={onParkSale}>
            Park sale
          </Button>
          <Button variant="ghost" type="button" disabled={empty} onClick={clear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
