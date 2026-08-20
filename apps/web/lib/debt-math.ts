import { minorUnits, type MinorUnits } from "@operatoros/shared";

/**
 * Pure Debt Book money/ageing math (D.6) — deliberately separated from any
 * component, same discipline as lib/basket-math.ts, so the two places this
 * phase's brief calls out as money-critical (payment allocation, ageing
 * buckets) are directly unit-testable without mounting React.
 *
 * Invoices here are credit-bearing sales per docs/DECISIONS.md's "invoices
 * are credit-bearing sales, not a shadow ledger" entry — `dueDateAt` is
 * snapshotted at sale time, never recomputed live.
 */

export type AgeingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const AGEING_BUCKETS: AgeingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  current: "Current",
  "1-30": "1–30",
  "31-60": "31–60",
  "61-90": "61–90",
  "90+": "90+",
};

/** Whole days between `dueDateAt` and `asOf` — positive means overdue. Floored, not rounded: a due date that was 30.9 days ago is still bucket "1-30" until it crosses a full 31st day. */
export function daysOverdue(dueDateAt: string, asOf: Date = new Date()): number {
  const due = new Date(dueDateAt).getTime();
  const now = asOf.getTime();
  return Math.floor((now - due) / 86_400_000);
}

/**
 * Bucket boundaries (D.6 ageing bar, matching design-reference's 5-bucket
 * scheme): current (not yet due, or due today), 1-30, 31-60, 61-90, 90+.
 * Boundaries are inclusive at the bucket they fall into — day 30 is "1-30",
 * day 31 is "31-60", tested explicitly at each boundary.
 */
export function ageingBucket(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface AgeableInvoice {
  id: string;
  remainingMinor: MinorUnits;
  dueDateAt: string;
}

/** Sums remaining balance per ageing bucket, in fixed bucket order — the header band's ageing bar. */
export function bucketTotals(invoices: AgeableInvoice[], asOf: Date = new Date()): Record<AgeingBucket, MinorUnits> {
  const totals: Record<AgeingBucket, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const inv of invoices) {
    if (inv.remainingMinor <= 0) continue;
    const bucket = ageingBucket(daysOverdue(inv.dueDateAt, asOf));
    totals[bucket] += inv.remainingMinor;
  }
  return {
    current: minorUnits(totals.current),
    "1-30": minorUnits(totals["1-30"]),
    "31-60": minorUnits(totals["31-60"]),
    "61-90": minorUnits(totals["61-90"]),
    "90+": minorUnits(totals["90+"]),
  };
}

// ---------------------------------------------------------------------------
// Payment allocation (D.6.4): auto-oldest-first or manual per invoice
// ---------------------------------------------------------------------------

export interface AllocatableInvoice {
  id: string;
  remainingMinor: MinorUnits;
  dueDateAt: string;
}

export interface Allocation {
  invoiceId: string;
  amountMinor: MinorUnits;
}

/**
 * Walks a customer's open invoices oldest-due-date-first, allocating as much
 * of `paymentMinor` as each invoice can absorb before moving to the next.
 * Any amount left over once every invoice is fully paid is returned as
 * `unallocatedMinor` (an overpayment — the caller decides what to do with
 * it, e.g. hold as credit; not decided here).
 */
export function autoAllocate(paymentMinor: MinorUnits, invoices: AllocatableInvoice[]): { allocations: Allocation[]; unallocatedMinor: MinorUnits } {
  const sorted = [...invoices].filter((i) => i.remainingMinor > 0).sort((a, b) => new Date(a.dueDateAt).getTime() - new Date(b.dueDateAt).getTime());
  let remaining: number = paymentMinor;
  const allocations: Allocation[] = [];
  for (const inv of sorted) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, inv.remainingMinor);
    if (amount > 0) {
      allocations.push({ invoiceId: inv.id, amountMinor: minorUnits(amount) });
      remaining -= amount;
    }
  }
  return { allocations, unallocatedMinor: minorUnits(remaining) };
}

export interface ManualAllocationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a manually-specified allocation: every line must reference a
 * real invoice, no line may exceed that invoice's remaining balance, no
 * line may be negative, and the lines must sum to exactly the payment total
 * (spec D.6.4/plan §0.2: "validated to sum to the payment total and never
 * exceed any one invoice's remaining balance").
 */
export function validateManualAllocation(paymentMinor: MinorUnits, lines: Allocation[], invoices: AllocatableInvoice[]): ManualAllocationResult {
  const errors: string[] = [];
  const byId = new Map(invoices.map((i) => [i.id, i]));

  for (const line of lines) {
    const invoice = byId.get(line.invoiceId);
    if (!invoice) {
      errors.push(`Invoice ${line.invoiceId} does not belong to this account.`);
      continue;
    }
    if (line.amountMinor < 0) {
      errors.push(`Allocation to ${line.invoiceId} cannot be negative.`);
    }
    if (line.amountMinor > invoice.remainingMinor) {
      errors.push(`Allocation to ${line.invoiceId} (RWF ${(line.amountMinor / 100).toLocaleString()}) exceeds its remaining balance (RWF ${(invoice.remainingMinor / 100).toLocaleString()}).`);
    }
  }

  const sum = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (sum !== paymentMinor) {
    errors.push(`Allocated total (RWF ${(sum / 100).toLocaleString()}) must equal the payment amount (RWF ${(paymentMinor / 100).toLocaleString()}).`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Account status (drives the STATUS chip + filter chips on the customer table)
// ---------------------------------------------------------------------------

export type AccountStatus = "current" | "due_this_week" | "overdue" | "over_limit";

export interface AccountStatusInput {
  balanceMinor: MinorUnits;
  creditLimitMinor: MinorUnits;
  oldestDueDateAt: string | null;
}

/** Over-limit outranks overdue outranks due-this-week outranks current — matches the design reference's "critical" row-tint taking priority over a plain overdue chip. */
export function accountStatus(input: AccountStatusInput, asOf: Date = new Date()): AccountStatus {
  if (input.creditLimitMinor > 0 && input.balanceMinor >= input.creditLimitMinor) return "over_limit";
  if (!input.oldestDueDateAt) return "current";
  const days = daysOverdue(input.oldestDueDateAt, asOf);
  if (days > 0) return "overdue";
  if (days >= -7) return "due_this_week";
  return "current";
}

export function creditLimitUsagePercent(balanceMinor: MinorUnits, creditLimitMinor: MinorUnits): number {
  if (creditLimitMinor <= 0) return 0;
  return Math.min(100, Math.round((balanceMinor / creditLimitMinor) * 100));
}
