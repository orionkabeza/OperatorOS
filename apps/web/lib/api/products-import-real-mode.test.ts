import { beforeEach, describe, expect, it, vi } from "vitest";

// Separate file from products.test.ts because USE_MOCK_API is read at module
// scope: the mock-mode behaviour and the real-backend behaviour genuinely
// cannot be exercised in the same module graph.
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  USE_MOCK_API: false,
}));

const { buildImportPreview } = await import("./products");
const { resetMockDb } = await import("../mock/store");

describe("buildImportPreview against a real backend", () => {
  beforeEach(() => resetMockDb());

  // The regression: this compared uploads to the demo seed catalog even when
  // pointed at a real backend, so a product named/SKU'd like demo data was
  // reported as "already in your catalog" against a business that had never
  // seen it. commitImport forwards is_duplicate, and the API skips any row
  // carrying it -- so the row was silently dropped from a real import.
  it("does not flag a row as duplicate just because the demo catalog has that SKU", () => {
    const preview = buildImportPreview([
      { name: "Cement Extra", sku: "CEM-50-CIM", unit: "bag", cost: "9200", price: "10500", opening_qty: "0" },
    ]);
    expect(preview.rows[0]?.isDuplicate).toBe(false);
    expect(preview.duplicateCount).toBe(0);
    expect(preview.validCount).toBe(1);
  });

  it("does not flag a row as duplicate just because the demo catalog has that name", () => {
    const preview = buildImportPreview([
      { name: "Cement 50kg (CIMERWA)", sku: "CEM-50-NEW", unit: "bag", cost: "9200", price: "10500", opening_qty: "0" },
    ]);
    expect(preview.rows[0]?.isDuplicate).toBe(false);
  });

  // Still genuinely knowable client-side, so it must keep working -- the fix
  // narrows what the preview claims to know, it doesn't switch detection off.
  it("still detects duplicates within the uploaded file itself", () => {
    const preview = buildImportPreview([
      { name: "Hammer", sku: "TL-HAM-99", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" },
      { name: "Hammer 2", sku: "TL-HAM-99", unit: "piece", cost: "2000", price: "3000", opening_qty: "0" },
    ]);
    expect(preview.rows[0]?.isDuplicate).toBe(false);
    expect(preview.rows[1]?.isDuplicate).toBe(true);
    expect(preview.duplicateCount).toBe(1);
  });

  it("still validates required fields and numbers", () => {
    const preview = buildImportPreview([
      { name: "", sku: "", unit: "piece", cost: "abc", price: "3000", opening_qty: "0" },
    ]);
    expect(preview.rows[0]?.errors).toContain("Name is required.");
    expect(preview.rows[0]?.errors).toContain("Cost must be a positive number.");
  });
});
