import { minorUnits } from "@operatoros/shared";
import { describe, expect, it } from "vitest";
import {
  accountStatus,
  ageingBucket,
  autoAllocate,
  bucketTotals,
  creditLimitUsagePercent,
  daysOverdue,
  validateManualAllocation,
  type AgeableInvoice,
  type AllocatableInvoice,
} from "./debt-math";

const ASOF = new Date("2026-08-20T12:00:00.000Z");

function dueDaysAgo(days: number): string {
  return new Date(ASOF.getTime() - days * 86_400_000).toISOString();
}

describe("daysOverdue", () => {
  it("is positive for a past due date", () => {
    expect(daysOverdue(dueDaysAgo(10), ASOF)).toBe(10);
  });
  it("is zero for a due date exactly today", () => {
    expect(daysOverdue(dueDaysAgo(0), ASOF)).toBe(0);
  });
  it("is negative for a future due date", () => {
    expect(daysOverdue(dueDaysAgo(-5), ASOF)).toBe(-5);
  });
});

describe("ageingBucket boundaries", () => {
  it("day 0 (due today) and negative (not yet due) are current", () => {
    expect(ageingBucket(0)).toBe("current");
    expect(ageingBucket(-3)).toBe("current");
  });
  it("day 1 is 1-30", () => {
    expect(ageingBucket(1)).toBe("1-30");
  });
  it("day 30 is still 1-30, day 31 rolls to 31-60", () => {
    expect(ageingBucket(30)).toBe("1-30");
    expect(ageingBucket(31)).toBe("31-60");
  });
  it("day 60 is still 31-60, day 61 rolls to 61-90", () => {
    expect(ageingBucket(60)).toBe("31-60");
    expect(ageingBucket(61)).toBe("61-90");
  });
  it("day 90 is still 61-90, day 91 rolls to 90+", () => {
    expect(ageingBucket(90)).toBe("61-90");
    expect(ageingBucket(91)).toBe("90+");
  });
});

describe("bucketTotals", () => {
  it("sums remaining balances into the correct buckets and ignores fully-paid invoices", () => {
    const invoices: AgeableInvoice[] = [
      { id: "a", remainingMinor: minorUnits(100_00), dueDateAt: dueDaysAgo(-5) }, // current
      { id: "b", remainingMinor: minorUnits(200_00), dueDateAt: dueDaysAgo(15) }, // 1-30
      { id: "c", remainingMinor: minorUnits(300_00), dueDateAt: dueDaysAgo(45) }, // 31-60
      { id: "d", remainingMinor: minorUnits(400_00), dueDateAt: dueDaysAgo(75) }, // 61-90
      { id: "e", remainingMinor: minorUnits(500_00), dueDateAt: dueDaysAgo(120) }, // 90+
      { id: "f", remainingMinor: minorUnits(0), dueDateAt: dueDaysAgo(200) }, // paid off, excluded
    ];
    const totals = bucketTotals(invoices, ASOF);
    expect(totals.current).toBe(100_00);
    expect(totals["1-30"]).toBe(200_00);
    expect(totals["31-60"]).toBe(300_00);
    expect(totals["61-90"]).toBe(400_00);
    expect(totals["90+"]).toBe(500_00);
  });
});

describe("autoAllocate (oldest-first)", () => {
  const invoices: AllocatableInvoice[] = [
    { id: "newest", remainingMinor: minorUnits(50_000), dueDateAt: dueDaysAgo(5) },
    { id: "oldest", remainingMinor: minorUnits(30_000), dueDateAt: dueDaysAgo(40) },
    { id: "middle", remainingMinor: minorUnits(40_000), dueDateAt: dueDaysAgo(20) },
  ];

  it("pays the oldest-due invoice first, then the next, regardless of input order", () => {
    const { allocations, unallocatedMinor } = autoAllocate(minorUnits(50_000), invoices);
    expect(allocations).toEqual([
      { invoiceId: "oldest", amountMinor: 30_000 },
      { invoiceId: "middle", amountMinor: 20_000 },
    ]);
    expect(unallocatedMinor).toBe(0);
  });

  it("fully pays every invoice and reports the overpayment as unallocated when the payment exceeds total debt", () => {
    const { allocations, unallocatedMinor } = autoAllocate(minorUnits(200_000), invoices);
    const total = allocations.reduce((s, a) => s + a.amountMinor, 0);
    expect(total).toBe(120_000); // sum of all three invoices
    expect(unallocatedMinor).toBe(80_000);
  });

  it("allocates nothing and returns the full amount unallocated when there are no open invoices", () => {
    const { allocations, unallocatedMinor } = autoAllocate(minorUnits(10_000), []);
    expect(allocations).toEqual([]);
    expect(unallocatedMinor).toBe(10_000);
  });

  it("skips invoices that are already fully paid (remainingMinor 0)", () => {
    const withPaid: AllocatableInvoice[] = [...invoices, { id: "paid", remainingMinor: minorUnits(0), dueDateAt: dueDaysAgo(100) }];
    const { allocations } = autoAllocate(minorUnits(5_000), withPaid);
    expect(allocations.every((a) => a.invoiceId !== "paid")).toBe(true);
  });
});

describe("validateManualAllocation", () => {
  const invoices: AllocatableInvoice[] = [
    { id: "inv-1", remainingMinor: minorUnits(30_000), dueDateAt: dueDaysAgo(40) },
    { id: "inv-2", remainingMinor: minorUnits(40_000), dueDateAt: dueDaysAgo(20) },
  ];

  it("accepts a valid split that sums exactly to the payment total", () => {
    const result = validateManualAllocation(
      minorUnits(50_000),
      [
        { invoiceId: "inv-1", amountMinor: minorUnits(30_000) },
        { invoiceId: "inv-2", amountMinor: minorUnits(20_000) },
      ],
      invoices,
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects a split that does not sum to the payment total (remainder validation)", () => {
    const result = validateManualAllocation(minorUnits(50_000), [{ invoiceId: "inv-1", amountMinor: minorUnits(30_000) }], invoices);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must equal the payment amount/);
  });

  it("rejects a line that exceeds its invoice's remaining balance", () => {
    const result = validateManualAllocation(minorUnits(50_000), [{ invoiceId: "inv-1", amountMinor: minorUnits(50_000) }], invoices);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds its remaining balance"))).toBe(true);
  });

  it("rejects a line referencing an invoice not on this account", () => {
    const result = validateManualAllocation(minorUnits(10_000), [{ invoiceId: "not-mine", amountMinor: minorUnits(10_000) }], invoices);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("does not belong"))).toBe(true);
  });

  it("rejects a negative allocation line", () => {
    const result = validateManualAllocation(minorUnits(-10_000), [{ invoiceId: "inv-1", amountMinor: minorUnits(-10_000) }], invoices);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cannot be negative"))).toBe(true);
  });
});

describe("accountStatus", () => {
  it("is over_limit when balance meets or exceeds the credit limit, outranking overdue", () => {
    expect(accountStatus({ balanceMinor: minorUnits(200_000), creditLimitMinor: minorUnits(200_000), oldestDueDateAt: dueDaysAgo(90) }, ASOF)).toBe(
      "over_limit",
    );
  });
  it("is overdue when the oldest invoice's due date has passed and balance is under limit", () => {
    expect(accountStatus({ balanceMinor: minorUnits(50_000), creditLimitMinor: minorUnits(200_000), oldestDueDateAt: dueDaysAgo(5) }, ASOF)).toBe(
      "overdue",
    );
  });
  it("is due_this_week when the oldest invoice is due within the next 7 days", () => {
    expect(accountStatus({ balanceMinor: minorUnits(50_000), creditLimitMinor: minorUnits(200_000), oldestDueDateAt: dueDaysAgo(-3) }, ASOF)).toBe(
      "due_this_week",
    );
  });
  it("is current when there is no open invoice or the nearest due date is more than a week out", () => {
    expect(accountStatus({ balanceMinor: minorUnits(0), creditLimitMinor: minorUnits(200_000), oldestDueDateAt: null }, ASOF)).toBe("current");
    expect(accountStatus({ balanceMinor: minorUnits(50_000), creditLimitMinor: minorUnits(200_000), oldestDueDateAt: dueDaysAgo(-20) }, ASOF)).toBe(
      "current",
    );
  });
});

describe("creditLimitUsagePercent", () => {
  it("computes a rounded percentage, capped at 100", () => {
    expect(creditLimitUsagePercent(minorUnits(150_000), minorUnits(200_000))).toBe(75);
    expect(creditLimitUsagePercent(minorUnits(250_000), minorUnits(200_000))).toBe(100);
  });
  it("is 0 when there is no credit limit set", () => {
    expect(creditLimitUsagePercent(minorUnits(50_000), minorUnits(0))).toBe(0);
  });
});
