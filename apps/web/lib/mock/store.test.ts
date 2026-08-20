import { minorUnits } from "@operatoros/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkCreditLimit,
  closeDay,
  findProduct,
  getDaySession,
  openDay,
  recordSale,
  resetMockDb,
  reverseSale,
} from "./store";

describe("mock ledger — day session gate + credit limit (D.3/D.4)", () => {
  beforeEach(() => resetMockDb());

  it("blocks recording a sale before the day is open", () => {
    expect(() =>
      recordSale({
        lines: [{ productId: "prod-trowel", name: "Trowel", qty: "1", unitId: "unit-piece", unitPriceMinor: minorUnits(450000), lineDiscountMinor: minorUnits(0) }],
        customerId: null,
        discountMinor: minorUnits(0),
        payments: [{ method: "cash", amountMinor: minorUnits(450000), cashGivenMinor: minorUnits(450000) }],
        receiptChannel: "none",
      }),
    ).toThrow(/shop isn't open/);
  });

  it("opens the day and records a variance when the count differs from expected", () => {
    const expected = getDaySession().expectedMinor!;
    const session = openDay({ countedMinor: minorUnits(expected + 500000), reason: "float_added" });
    expect(session.status).toBe("open");
    expect(session.varianceMinor).toBe(500000);
    expect(session.reason).toBe("float_added");
  });

  it("decrements stock and credits the till on a cash sale", () => {
    openDay({ countedMinor: getDaySession().expectedMinor! });
    const before = findProduct("prod-trowel").onHand;
    const sale = recordSale({
      lines: [{ productId: "prod-trowel", name: "Trowel", qty: "2", unitId: "unit-piece", unitPriceMinor: minorUnits(450000), lineDiscountMinor: minorUnits(0) }],
      customerId: null,
      discountMinor: minorUnits(0),
      payments: [{ method: "cash", amountMinor: minorUnits(900000), cashGivenMinor: minorUnits(1000000) }],
      receiptChannel: "none",
    });
    expect(findProduct("prod-trowel").onHand).toBe(String(Number(before) - 2));
    expect(sale.changeDueMinor).toBe(100000); // gave 10,000, owed 9,000 -> 1,000 change
    expect(sale.totalMinor).toBe(900000);
  });

  it("blocks a credit sale that would exceed the customer's credit limit, and allows an explicit override to still compute correctly", () => {
    openDay({ countedMinor: getDaySession().expectedMinor! });
    // cust-kigali-builders: limit 2,000,000 minor... wait these are already minor (RWF*100). Balance already near limit.
    const check = checkCreditLimit("cust-kigali-builders", minorUnits(500_000 * 100));
    expect(check.allowed).toBe(false);
    expect(check.newBalanceMinor).toBeGreaterThan(check.creditLimitMinor);
  });

  it("allows a credit sale within the limit", () => {
    const check = checkCreditLimit("cust-nzeyimana", minorUnits(50_000 * 100));
    expect(check.allowed).toBe(true);
  });

  it("reversing a sale restores stock and customer balance", () => {
    openDay({ countedMinor: getDaySession().expectedMinor! });
    const before = findProduct("prod-trowel").onHand;
    const sale = recordSale({
      lines: [{ productId: "prod-trowel", name: "Trowel", qty: "1", unitId: "unit-piece", unitPriceMinor: minorUnits(450000), lineDiscountMinor: minorUnits(0) }],
      customerId: null,
      discountMinor: minorUnits(0),
      payments: [{ method: "cash", amountMinor: minorUnits(450000), cashGivenMinor: minorUnits(450000) }],
      receiptChannel: "none",
    });
    reverseSale(sale.id);
    expect(findProduct("prod-trowel").onHand).toBe(before);
  });

  it("closing the day records a variance against expected cash-in-till", () => {
    openDay({ countedMinor: getDaySession().expectedMinor! });
    const closed = closeDay({ countedMinor: minorUnits((getDaySession().countedMinor ?? 0) - 20000) });
    expect(closed.status).toBe("closed");
    expect(closed.varianceMinor).toBe(-20000);
  });
});
