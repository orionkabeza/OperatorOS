import { describe, expect, it } from "vitest";
import { addQty, compareQty, isPositiveQty, isZeroQty, mulQty, numberToQty, qtyToNumber, subQty } from "./decimal";

describe("decimal qty helpers", () => {
  it("adds decimal quantities without float drift", () => {
    // Classic float trap: 0.1 + 0.2 !== 0.3 in raw JS floats.
    expect(addQty("0.1", "0.2")).toBe("0.3");
  });

  it("subtracts and can go negative (negative stock is allowed, only flagged)", () => {
    expect(subQty("5", "8")).toBe("-3");
  });

  it("multiplies by a unit conversion factor", () => {
    expect(mulQty("2", 12)).toBe("24"); // 2 boxes of 12 -> 24 pieces
    expect(mulQty("1.5", 10)).toBe("15"); // 1.5 bundles of 10 -> 15 pieces
  });

  it("round-trips numbers", () => {
    expect(qtyToNumber("12.5")).toBe(12.5);
    expect(numberToQty(12.5)).toBe("12.5");
    expect(numberToQty(3)).toBe("3");
  });

  it("reports positivity and zero correctly", () => {
    expect(isPositiveQty("0.001")).toBe(true);
    expect(isPositiveQty("0")).toBe(false);
    expect(isPositiveQty("-1")).toBe(false);
    expect(isZeroQty("0")).toBe(true);
    expect(isZeroQty("0.000")).toBe(true);
    expect(isZeroQty("0.001")).toBe(false);
  });

  it("compares quantities", () => {
    expect(compareQty("5", "3")).toBeGreaterThan(0);
    expect(compareQty("3", "5")).toBeLessThan(0);
    expect(compareQty("5", "5")).toBe(0);
  });
});
