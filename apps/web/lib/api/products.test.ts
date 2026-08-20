import { beforeEach, describe, expect, it } from "vitest";
import { buildImportPreview } from "./products";
import { resetMockDb } from "../mock/store";

describe("buildImportPreview (D.2 Step 3 CSV/XLSX import validation)", () => {
  beforeEach(() => resetMockDb());

  it("accepts a fully valid row", () => {
    const preview = buildImportPreview([{ name: "Hammer", sku: "TL-HAM-01", unit: "piece", cost: "2000", price: "3000", opening_qty: "10" }]);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]?.errors).toEqual([]);
  });

  it("flags missing name and SKU", () => {
    const preview = buildImportPreview([{ name: "", sku: "", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" }]);
    expect(preview.rows[0]?.errors).toContain("Name is required.");
    expect(preview.rows[0]?.errors).toContain("SKU is required.");
  });

  it("flags a non-numeric cost/price", () => {
    const preview = buildImportPreview([{ name: "Hammer", sku: "TL-HAM-01", unit: "piece", cost: "abc", price: "def", opening_qty: "0" }]);
    expect(preview.rows[0]?.errors).toContain("Cost must be a positive number.");
    expect(preview.rows[0]?.errors).toContain("Price must be a positive number.");
  });

  it("flags selling price below cost as a warning-level error (still surfaced, not silently allowed)", () => {
    const preview = buildImportPreview([{ name: "Hammer", sku: "TL-HAM-01", unit: "piece", cost: "3000", price: "2000", opening_qty: "0" }]);
    expect(preview.rows[0]?.errors.some((e) => e.includes("below cost"))).toBe(true);
  });

  it("detects duplicate SKUs within the same file", () => {
    const preview = buildImportPreview([
      { name: "Hammer", sku: "TL-HAM-01", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" },
      { name: "Hammer 2", sku: "TL-HAM-01", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" },
    ]);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[1]?.isDuplicate).toBe(true);
    expect(preview.rows[0]?.isDuplicate).toBe(false);
  });

  it("detects a SKU that already exists in the catalog", () => {
    const preview = buildImportPreview([
      { name: "Cement Extra", sku: "CEM-50-CIM", unit: "bag", cost: "9200", price: "10500", opening_qty: "0" },
    ]);
    expect(preview.rows[0]?.isDuplicate).toBe(true);
  });

  it("counts valid vs error rows correctly across a mixed batch", () => {
    const preview = buildImportPreview([
      { name: "Hammer", sku: "TL-HAM-01", unit: "piece", cost: "2000", price: "3000", opening_qty: "10" },
      { name: "", sku: "BAD", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" },
    ]);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(1);
  });
});
