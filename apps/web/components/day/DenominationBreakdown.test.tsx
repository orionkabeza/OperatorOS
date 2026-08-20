import { describe, expect, it } from "vitest";
import { denominationTotalMinor } from "./DenominationBreakdown";

describe("denominationTotalMinor (D.3/D.7.5/D.11 shared cash-count sum)", () => {
  it("sums a realistic mixed count to minor units", () => {
    const total = denominationTotalMinor([
      { value: 5000, isCoin: false, count: 10 }, // 50,000
      { value: 2000, isCoin: false, count: 5 }, // 10,000
      { value: 1000, isCoin: false, count: 3 }, // 3,000
      { value: 500, isCoin: false, count: 2 }, // 1,000
      { value: 100, isCoin: true, count: 4 }, // 400
      { value: 50, isCoin: true, count: 2 }, // 100
    ]);
    // 50,000 + 10,000 + 3,000 + 1,000 + 400 + 100 = 64,500 RWF = 6,450,000 minor
    expect(total).toBe(6_450_000);
  });

  it("returns zero for an all-zero count", () => {
    expect(denominationTotalMinor([{ value: 5000, isCoin: false, count: 0 }])).toBe(0);
  });
});
