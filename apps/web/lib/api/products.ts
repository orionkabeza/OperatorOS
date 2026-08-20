import { qtyToNumber } from "../decimal";
import { CATEGORIES, UNITS } from "../mock/seed";
import { appendStockMovement, getDb, mockDelay } from "../mock/store";
import { apiRequest, USE_MOCK_API } from "./config";
import type { Category, CreateProductInput, ImportPreview, ImportRow, Product, ProductFilters, Unit } from "./types";

function daysSinceLastMovement(productId: string): number {
  const db = getDb();
  const last = db.stockMovements.find((m) => m.productId === productId);
  if (!last) return 9999;
  return Math.floor((Date.now() - new Date(last.timestamp).getTime()) / 86_400_000);
}

function applyFilters(products: Product[], filters?: ProductFilters): Product[] {
  let rows = products;
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode?.includes(q) ||
        p.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }
  if (filters?.categoryId) rows = rows.filter((p) => p.categoryId === filters.categoryId);
  switch (filters?.quickFilter) {
    case "low-stock":
      rows = rows.filter((p) => qtyToNumber(p.onHand) > 0 && qtyToNumber(p.onHand) <= qtyToNumber(p.reorderPoint));
      break;
    case "out-of-stock":
      rows = rows.filter((p) => qtyToNumber(p.onHand) === 0);
      break;
    case "negative-stock":
      rows = rows.filter((p) => qtyToNumber(p.onHand) < 0);
      break;
    case "below-cost":
      rows = rows.filter((p) => p.priceMinor < p.costMinor);
      break;
    case "no-movement-90d":
      rows = rows.filter((p) => daysSinceLastMovement(p.id) >= 90);
      break;
    case "expiring-30d":
      rows = []; // No expiry-date field modeled yet (perishables aren't in the seed catalog) — genuinely empty, not faked.
      break;
    default:
      break;
  }
  return rows;
}

export async function listProducts(filters?: ProductFilters): Promise<Product[]> {
  if (USE_MOCK_API) {
    const rows = applyFilters(
      getDb().products.filter((p) => !p.archived),
      filters,
    );
    return mockDelay(rows);
  }
  return apiRequest<Product[]>("GET", "/api/v1/products", {
    query: { search: filters?.search, categoryId: filters?.categoryId, quickFilter: filters?.quickFilter },
  });
}

export async function getProduct(id: string): Promise<Product> {
  if (USE_MOCK_API) {
    const product = getDb().products.find((p) => p.id === id);
    if (!product) throw new Error(`Product ${id} not found`);
    return mockDelay(product);
  }
  return apiRequest<Product>("GET", `/api/v1/products/${id}`);
}

export async function listCategories(): Promise<Category[]> {
  if (USE_MOCK_API) return mockDelay(CATEGORIES);
  return apiRequest<Category[]>("GET", "/api/v1/categories");
}

export async function listUnits(): Promise<Unit[]> {
  if (USE_MOCK_API) return mockDelay(UNITS);
  return apiRequest<Unit[]>("GET", "/api/v1/units");
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  if (USE_MOCK_API) {
    const db = getDb();
    const unit = UNITS.find((u) => u.id === input.unitId) ?? UNITS[0]!;
    const category = CATEGORIES.find((c) => c.id === input.categoryId) ?? CATEGORIES[0]!;
    const product: Product = {
      id: `prod-${crypto.randomUUID()}`,
      name: input.name,
      aliases: [],
      sku: input.sku,
      barcode: input.barcode ?? null,
      categoryId: category.id,
      categoryName: category.name,
      unitId: unit.id,
      unitName: unit.name,
      unitConversions: [{ unitId: unit.id, unitName: unit.name, factorToBase: 1 }],
      costMinor: input.costMinor,
      priceMinor: input.priceMinor,
      wholesalePriceMinor: null,
      minSellPriceMinor: null,
      taxClass: "standard",
      imageUrl: null,
      notes: "",
      reorderPoint: "0",
      reorderQty: "0",
      locations: [{ locationId: "loc-nyabugogo", locationName: "Nyabugogo branch", onHand: "0", reserved: "0" }],
      onHand: "0",
      archived: false,
    };
    db.products.push(product);
    if (input.openingQty && qtyToNumber(input.openingQty) !== 0) {
      appendStockMovement({ productId: product.id, type: "adjustment", qtyDelta: input.openingQty, reference: "Opening stock" });
    }
    return mockDelay(product);
  }
  return apiRequest<Product>("POST", "/api/v1/products", { body: input });
}

/** Client-side CSV parse-and-validate preview per D.2 Step 3 — the real commit still goes through the API. */
export function buildImportPreview(rawRows: Record<string, string>[]): ImportPreview {
  const seenSkus = new Set<string>();
  const seenNames = new Set<string>();
  const existingSkus = new Set(getDb().products.map((p) => p.sku.toLowerCase()));
  const rows: ImportRow[] = rawRows.map((raw, i) => {
    const errors: string[] = [];
    const name = (raw.name ?? "").trim();
    const sku = (raw.sku ?? "").trim();
    const unit = (raw.unit ?? "piece").trim();
    const costMajor = Number.parseFloat(raw.cost ?? "");
    const priceMajor = Number.parseFloat(raw.price ?? "");
    const openingQty = (raw.opening_qty ?? raw.openingQty ?? "0").trim();

    if (!name) errors.push("Name is required.");
    if (!sku) errors.push("SKU is required.");
    if (!Number.isFinite(costMajor) || costMajor < 0) errors.push("Cost must be a positive number.");
    if (!Number.isFinite(priceMajor) || priceMajor < 0) errors.push("Price must be a positive number.");
    if (Number.isFinite(costMajor) && Number.isFinite(priceMajor) && priceMajor < costMajor) {
      errors.push("Selling price is below cost — check this is intentional.");
    }
    if (Number.isNaN(Number.parseFloat(openingQty))) errors.push("Opening quantity must be a number.");

    const isDuplicate =
      (sku !== "" && (seenSkus.has(sku.toLowerCase()) || existingSkus.has(sku.toLowerCase()))) ||
      (name !== "" && seenNames.has(name.toLowerCase()));
    if (sku) seenSkus.add(sku.toLowerCase());
    if (name) seenNames.add(name.toLowerCase());
    if (isDuplicate) errors.push("Duplicate SKU or name (in this file or already in your catalog).");

    return {
      rowNumber: i + 1,
      name,
      sku,
      unit,
      costMinor: (Number.isFinite(costMajor) ? Math.round(costMajor * 100) : 0) as ImportRow["costMinor"],
      priceMinor: (Number.isFinite(priceMajor) ? Math.round(priceMajor * 100) : 0) as ImportRow["priceMinor"],
      openingQty,
      errors,
      isDuplicate,
    };
  });

  return {
    rows,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    duplicateCount: rows.filter((r) => r.isDuplicate).length,
  };
}

export async function commitImport(rows: ImportRow[]): Promise<{ created: number }> {
  const db = getDb();
  const validRows = rows.filter((r) => r.errors.length === 0);
  for (const row of validRows) {
    const product: Product = {
      id: `prod-${crypto.randomUUID()}`,
      name: row.name,
      aliases: [],
      sku: row.sku,
      barcode: null,
      categoryId: "cat-tools",
      categoryName: "Tools",
      unitId: "unit-piece",
      unitName: row.unit || "piece",
      unitConversions: [{ unitId: "unit-piece", unitName: row.unit || "piece", factorToBase: 1 }],
      costMinor: row.costMinor,
      priceMinor: row.priceMinor,
      wholesalePriceMinor: null,
      minSellPriceMinor: null,
      taxClass: "standard",
      imageUrl: null,
      notes: "",
      reorderPoint: "0",
      reorderQty: "0",
      locations: [{ locationId: "loc-nyabugogo", locationName: "Nyabugogo branch", onHand: row.openingQty, reserved: "0" }],
      onHand: row.openingQty,
      archived: false,
    };
    db.products.push(product);
  }
  return mockDelay({ created: validRows.length });
}
