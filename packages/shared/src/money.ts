/**
 * Money is always minor units (RWF cents, i.e. amount × 100), stored and passed
 * around as an integer — never a float. See OperatorOS-Spec.md Part E.5.
 */
export type MinorUnits = number & { readonly __brand: "MinorUnits" };

export function minorUnits(value: number): MinorUnits {
  if (!Number.isInteger(value)) {
    throw new TypeError(`MinorUnits must be an integer, got ${value}`);
  }
  return value as MinorUnits;
}

const RWF_MINOR_PER_MAJOR = 100;

/** `RWF 1,240,500` — no decimals shown for RWF, matches spec B.3's money formatting rule. */
export function formatRwf(amount: MinorUnits): string {
  const parts = toRwfParts(amount);
  return `RWF ${parts.negative ? "-" : ""}${parts.figure}`;
}

/**
 * Split for the <Money> component: the spec requires the "RWF" prefix and
 * the numeral to be styled differently (prefix in --ink-soft at 0.75em,
 * figure at full size in Plex Mono), and negatives use a leading minus in
 * --out, never parentheses.
 */
export function toRwfParts(amount: MinorUnits): { negative: boolean; figure: string } {
  const major = amount / RWF_MINOR_PER_MAJOR;
  const negative = major < 0;
  const abs = Math.round(Math.abs(major));
  return { negative, figure: abs.toLocaleString("en-US") };
}
