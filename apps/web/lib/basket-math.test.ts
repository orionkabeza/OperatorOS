import { minorUnits } from "@operatoros/shared";
import { describe, expect, it } from "vitest";
import {
  changeDueMinor,
  discountFromPercent,
  grandTotalMinor,
  lineTotalMinor,
  paidSoFarMinor,
  remainingMinor,
  subtotalMinor,
  vatMinor,
} from "./basket-math";
import type { BasketLineInput, PaymentLineInput } from "./api/types";

const line = (over: Partial<BasketLineInput> = {}): BasketLineInput => ({
  productId: "p1",
  name: "Cement 50kg",
  qty: "3",
  unitId: "unit-bag",
  unitPriceMinor: minorUnits(1_050_000), // RWF 10,500
  lineDiscountMinor: minorUnits(0),
  ...over,
});

describe("basket math (D.4)", () => {
  it("computes a line total from qty × unit price, minus line discount", () => {
    expect(lineTotalMinor(line())).toBe(3_150_000); // 3 × 10,500 = 31,500 RWF
  });

  it("applies a line discount", () => {
    expect(lineTotalMinor(line({ lineDiscountMinor: minorUnits(50_000) }))).toBe(3_100_000);
  });

  it("handles fractional quantities without float drift", () => {
    // 12.5kg of rebar at RWF 9,300/piece-equivalent — exercised via a fractional qty directly.
    expect(lineTotalMinor(line({ qty: "0.1", unitPriceMinor: minorUnits(100) }))).toBe(10);
  });

  it("sums a multi-line subtotal", () => {
    const lines = [line({ qty: "3" }), line({ productId: "p2", qty: "1", unitPriceMinor: minorUnits(450_000) })];
    expect(subtotalMinor(lines)).toBe(3_150_000 + 450_000);
  });

  it("computes VAT only when the business is VAT-registered", () => {
    const subtotal = minorUnits(1_000_000);
    expect(vatMinor(subtotal, minorUnits(0), { registered: false, ratePercent: 18 })).toBe(0);
    expect(vatMinor(subtotal, minorUnits(0), { registered: true, ratePercent: 18 })).toBe(180_000);
  });

  it("computes VAT on the post-discount taxable amount", () => {
    const subtotal = minorUnits(1_000_000);
    const discount = minorUnits(100_000);
    expect(vatMinor(subtotal, discount, { registered: true, ratePercent: 18 })).toBe(162_000);
  });

  it("computes the grand total as subtotal minus discount plus VAT", () => {
    expect(grandTotalMinor(minorUnits(1_000_000), minorUnits(100_000), minorUnits(162_000))).toBe(1_062_000);
  });

  it("converts a percent discount to a minor-unit amount", () => {
    expect(discountFromPercent(minorUnits(1_000_000), 10)).toBe(100_000);
  });

  describe("multi-line payments and change", () => {
    const payments: PaymentLineInput[] = [
      { method: "cash", amountMinor: minorUnits(3_000_000) },
      { method: "momo", amountMinor: minorUnits(487_000) },
    ];

    it("sums payments across multiple lines (e.g. cash + MoMo split)", () => {
      expect(paidSoFarMinor(payments)).toBe(3_487_000);
    });

    it("computes the remaining balance", () => {
      expect(remainingMinor(minorUnits(5_487_000), payments)).toBe(2_000_000);
    });

    it("is exactly zero remaining when fully covered", () => {
      expect(remainingMinor(minorUnits(3_487_000), payments)).toBe(0);
    });

    it("computes correct change due for cash given above the amount owed", () => {
      expect(changeDueMinor(minorUnits(5_000_000), minorUnits(4_870_000))).toBe(130_000);
    });

    it("never returns negative change when cash given is short", () => {
      expect(changeDueMinor(minorUnits(1_000_000), minorUnits(4_870_000))).toBe(0);
    });
  });
});
