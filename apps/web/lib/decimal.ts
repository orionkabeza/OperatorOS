import type { QtyString } from "./api/types";

/**
 * Quantities cross the API as decimal strings (e.g. "12.5" of rebar cut to
 * length), never floats — same reasoning as money being integer minor units
 * (spec E.5), just for a field where the value genuinely can be fractional.
 * These helpers do arithmetic on a fixed-point integer (scaled by 1000, i.e.
 * 3 decimal places — enough for any unit conversion factor a hardware store
 * needs: piece/box/bundle factors are always whole or simple fractions)
 * rather than JS floats, so repeated basket edits don't drift.
 */
const SCALE = 1000;

function toScaled(qty: QtyString | number): number {
  const n = typeof qty === "number" ? qty : Number.parseFloat(qty);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * SCALE);
}

function fromScaled(scaled: number): QtyString {
  const n = scaled / SCALE;
  // Trim trailing zeros but keep it a plain decimal string, e.g. "3" not "3.000".
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function qtyToNumber(qty: QtyString): number {
  return toScaled(qty) / SCALE;
}

export function numberToQty(n: number): QtyString {
  return fromScaled(toScaled(n));
}

export function addQty(a: QtyString, b: QtyString): QtyString {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subQty(a: QtyString, b: QtyString): QtyString {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function mulQty(a: QtyString, factor: number): QtyString {
  return fromScaled(Math.round(toScaled(a) * factor));
}

export function isPositiveQty(qty: QtyString): boolean {
  return toScaled(qty) > 0;
}

export function isZeroQty(qty: QtyString): boolean {
  return toScaled(qty) === 0;
}

export function compareQty(a: QtyString, b: QtyString): number {
  return toScaled(a) - toScaled(b);
}
