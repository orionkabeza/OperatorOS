import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { qtyToNumber } from "./decimal";
import type { BasketLineInput, PaymentLineInput } from "./api/types";

/**
 * Pure basket arithmetic — deliberately separated from any component so the
 * money math (spec D.4: "record a sale... without the seller ever leaving
 * the keyboard", and E.5's "money is always integer minor units") is
 * directly unit-testable without mounting React.
 */

export function lineTotalMinor(line: BasketLineInput): MinorUnits {
  const gross = Math.round(qtyToNumber(line.qty) * line.unitPriceMinor);
  return minorUnits(gross - line.lineDiscountMinor);
}

export function subtotalMinor(lines: BasketLineInput[]): MinorUnits {
  return minorUnits(lines.reduce((sum, l) => sum + lineTotalMinor(l), 0));
}

export interface VatConfig {
  registered: boolean;
  ratePercent: number; // e.g. 18
}

export function vatMinor(subtotal: MinorUnits, discount: MinorUnits, vat: VatConfig): MinorUnits {
  if (!vat.registered) return minorUnits(0);
  const taxable = subtotal - discount;
  return minorUnits(Math.round((taxable * vat.ratePercent) / 100));
}

export function grandTotalMinor(subtotal: MinorUnits, discount: MinorUnits, vat: MinorUnits): MinorUnits {
  return minorUnits(subtotal - discount + vat);
}

export function paidSoFarMinor(payments: PaymentLineInput[]): MinorUnits {
  return minorUnits(payments.reduce((sum, p) => sum + p.amountMinor, 0));
}

export function remainingMinor(total: MinorUnits, payments: PaymentLineInput[]): MinorUnits {
  return minorUnits(total - paidSoFarMinor(payments));
}

export function changeDueMinor(cashGivenMinor: MinorUnits, amountOwedMinor: MinorUnits): MinorUnits {
  return minorUnits(Math.max(0, cashGivenMinor - amountOwedMinor));
}

/** Percent-discount helper — the discount control toggles between % and amount (D.4). */
export function discountFromPercent(subtotal: MinorUnits, percent: number): MinorUnits {
  return minorUnits(Math.round((subtotal * percent) / 100));
}
