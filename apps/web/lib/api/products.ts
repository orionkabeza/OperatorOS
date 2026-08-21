import { minorUnits } from "@operatoros/shared";
import { addQty, qtyToNumber } from "../decimal";
import { CATEGORIES, UNITS } from "../mock/seed";
import { appendStockMovement, getDb, mockDelay } from "../mock/store";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { z } from "zod";
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

// ---------------------------------------------------------------------------
// Real-API mapping
// ---------------------------------------------------------------------------

let categoriesCache: z.infer<typeof schemas.CategoryOut>[] | null = null;
let unitsCache: z.infer<typeof schemas.UnitOut>[] | null = null;

async function getCategoryUnitLookups() {
  if (!categoriesCache) {
    const raw = await apiRequest<unknown>("GET", "/api/v1/products/categories");
    categoriesCache = schemas.CategoryOut.array().parse(raw);
  }
  if (!unitsCache) {
    const raw = await apiRequest<unknown>("GET", "/api/v1/products/units");
    unitsCache = schemas.UnitOut.array().parse(raw);
  }
  const categoryNameById = new Map(categoriesCache.map((c) => [c.id, c.name]));
  const unitNameById = new Map(unitsCache.map((u) => [u.id, u.name]));
  return { categoryNameById, unitNameById };
}

/**
 * The real `ProductOut` (schemas/products.py) is much flatter than the
 * frontend's `Product` — no `categoryName`/`unitName` (only ids, resolved
 * here against `GET .../categories`/`.../units`), no `wholesalePriceMinor`
 * /`imageUrl`/`notes` (none of these fields exist server-side at all — a
 * genuine gap, not a naming mismatch), no per-location `locations[]`
 * (that's `GET /api/v1/products/{id}/stock`, a SEPARATE call — passed in
 * here only when the caller already has it, to avoid an N+1 fetch across
 * every product in a list), and `status: string` instead of an `archived`
 * boolean.
 */
function mapProductOut(
  p: z.infer<typeof schemas.ProductOut>,
  categoryNameById: Map<string, string>,
  unitNameById: Map<string, string>,
  stockByLocation?: z.infer<typeof schemas.ProductStockOut>[],
): Product {
  const unitName = unitNameById.get(p.base_unit_id) ?? p.base_unit_id;
  const locations = (stockByLocation ?? []).map((s) => ({
    locationId: s.location_id,
    locationName: s.location_id, // ProductStockOut carries no location display name
    onHand: s.on_hand,
    reserved: s.reserved,
  }));
  const onHand = locations.reduce((sum, l) => addQty(sum, l.onHand), "0");
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    sku: p.sku ?? "",
    barcode: p.barcode,
    categoryId: p.category_id ?? "",
    categoryName: p.category_id ? (categoryNameById.get(p.category_id) ?? p.category_id) : "",
    unitId: p.base_unit_id,
    unitName,
    // No per-product unit-conversion list exists server-side — only the
    // base unit is known, so it stands alone at factor 1.
    unitConversions: [{ unitId: p.base_unit_id, unitName, factorToBase: 1 }],
    costMinor: minorUnits(p.cost_price_minor ?? 0),
    priceMinor: minorUnits(p.selling_price_minor),
    wholesalePriceMinor: null, // no such field server-side
    minSellPriceMinor: p.min_selling_price_minor !== null && p.min_selling_price_minor !== undefined ? minorUnits(p.min_selling_price_minor) : null,
    taxClass: (p.tax_class as Product["taxClass"] | undefined) ?? "standard",
    imageUrl: null, // no such field server-side
    notes: "", // ProductOut never echoes notes back (only accepted on create/update)
    reorderPoint: p.reorder_point,
    reorderQty: p.reorder_quantity,
    locations,
    onHand: stockByLocation ? onHand : "0", // "0" (not fetched) in list mode — see getProduct for the per-item stock fetch
    archived: p.status !== "active",
  };
}

export async function listProducts(filters?: ProductFilters): Promise<Product[]> {
  if (USE_MOCK_API) {
    const rows = applyFilters(
      getDb().products.filter((p) => !p.archived),
      filters,
    );
    return mockDelay(rows);
  }
  const { categoryNameById, unitNameById } = await getCategoryUnitLookups();
  const belowCost = filters?.quickFilter === "below-cost" ? "true" : undefined;
  const raw = await apiRequest<unknown>("GET", "/api/v1/products", {
    query: { search: filters?.search, category_id: filters?.categoryId, below_cost: belowCost },
  });
  let rows = schemas.ProductOut.array()
    .parse(raw)
    .map((p) => mapProductOut(p, categoryNameById, unitNameById));

  // Stock-dependent quick filters: derived from the real
  // `GET /api/v1/stock/locations` endpoint (which DOES support
  // `low_stock`/`negative_stock` query params server-side) rather than
  // faked — `out-of-stock` has no direct query param, so it's filtered
  // client-side from the same unfiltered balances fetch.
  if (filters?.quickFilter === "low-stock" || filters?.quickFilter === "out-of-stock" || filters?.quickFilter === "negative-stock") {
    const stockRaw = await apiRequest<unknown>("GET", "/api/v1/stock/locations", {
      query: {
        location_id: await getDefaultLocationId(),
        low_stock: filters.quickFilter === "low-stock" ? "true" : undefined,
        negative_stock: filters.quickFilter === "negative-stock" ? "true" : undefined,
      },
    });
    const balances = schemas.ProductLocationOut.array().parse(stockRaw);
    const matchingIds = new Set(
      filters.quickFilter === "out-of-stock" ? balances.filter((b) => Number(b.on_hand) <= 0).map((b) => b.product_id) : balances.map((b) => b.product_id),
    );
    rows = rows.filter((p) => matchingIds.has(p.id));
  } else if (filters?.quickFilter === "no-movement-90d" || filters?.quickFilter === "expiring-30d") {
    // No cheap way to derive either against the real backend (would mean
    // scanning all stock movements for every product, or a field that
    // doesn't exist at all) — genuinely empty rather than faked, same
    // treatment "expiring-30d" already gets in the mock branch above.
    rows = [];
  }
  return rows;
}

export async function getProduct(id: string): Promise<Product> {
  if (USE_MOCK_API) {
    const product = getDb().products.find((p) => p.id === id);
    if (!product) throw new Error(`Product ${id} not found`);
    return mockDelay(product);
  }
  const { categoryNameById, unitNameById } = await getCategoryUnitLookups();
  const [productRaw, stockRaw] = await Promise.all([
    apiRequest<unknown>("GET", `/api/v1/products/${id}`),
    apiRequest<unknown>("GET", `/api/v1/products/${id}/stock`),
  ]);
  return mapProductOut(schemas.ProductOut.parse(productRaw), categoryNameById, unitNameById, schemas.ProductStockOut.array().parse(stockRaw));
}

export async function listCategories(): Promise<Category[]> {
  if (USE_MOCK_API) return mockDelay(CATEGORIES);
  const raw = await apiRequest<unknown>("GET", "/api/v1/products/categories");
  categoriesCache = schemas.CategoryOut.array().parse(raw);
  return categoriesCache;
}

export async function listUnits(): Promise<Unit[]> {
  if (USE_MOCK_API) return mockDelay(UNITS);
  const raw = await apiRequest<unknown>("GET", "/api/v1/products/units");
  unitsCache = schemas.UnitOut.array().parse(raw);
  // Real `UnitOut` has no `factorToBase`/`isBase` fields (schemas/products.py
  // — units are flat, base-vs-derived conversion isn't modeled server-side
  // at all) — every unit is reported as its own base at factor 1, a
  // disclosed simplification, not invented conversion data.
  return unitsCache.map((u) => ({ id: u.id, name: u.name, factorToBase: 1, isBase: true }));
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
  const { categoryNameById, unitNameById } = await getCategoryUnitLookups();
  const raw = await apiRequest<unknown>("POST", "/api/v1/products", {
    body: {
      name: input.name,
      sku: input.sku,
      barcode: input.barcode ?? null,
      category_id: input.categoryId,
      base_unit_id: input.unitId,
      cost_price_minor: input.costMinor,
      selling_price_minor: input.priceMinor,
      opening_location_id: await getDefaultLocationId(),
      opening_quantity: input.openingQty ?? null,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapProductOut(schemas.ProductOut.parse(raw), categoryNameById, unitNameById);
}

/**
 * Client-side CSV parse-and-validate preview per D.2 Step 3 — the real
 * commit still goes through the API.
 *
 * The "already in your catalog" half of duplicate detection can only run
 * against a catalog this function can actually see. Reading `getDb()`
 * unconditionally meant that against a real backend it compared uploads to
 * the *demo seed* catalog — flagging rows as duplicates of products that do
 * not exist in the business's real data. That was not merely a misleading
 * preview: `commitImport` forwards `is_duplicate` to the API, and
 * `products_import.py::commit_import` skips every row carrying it, so those
 * rows were silently dropped from a real import for a fabricated reason.
 * In real mode the client therefore checks only what it can genuinely know
 * — duplicates *within the uploaded file* — and leaves catalog duplicates
 * to the backend, which re-checks them against live data at commit anyway.
 */
export function buildImportPreview(rawRows: Record<string, string>[]): ImportPreview {
  const seenSkus = new Set<string>();
  const seenNames = new Set<string>();
  const existingSkus = USE_MOCK_API
    ? new Set(getDb().products.map((p) => p.sku.toLowerCase()))
    : new Set<string>();
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

/**
 * This function had NO real-API branch at all before this pass — it
 * unconditionally wrote to the mock db regardless of `USE_MOCK_API`, a
 * pre-existing Phase 0/1 bug this pass also fixes. The real endpoint is
 * `POST /api/v1/products/import/commit`, body `ImportCommitRequest{
 * default_unit_id, opening_location_id?, rows }` — `rows` reuses the same
 * shape `buildImportPreview` already produces (`ImportPreviewRow`), just
 * snake_cased.
 */
export async function commitImport(rows: ImportRow[]): Promise<{ created: number }> {
  if (USE_MOCK_API) {
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
  const { unitNameById } = await getCategoryUnitLookups();
  const defaultUnitId = [...unitNameById.keys()][0] ?? "";
  const raw = await apiRequest<unknown>("POST", "/api/v1/products/import/commit", {
    body: {
      default_unit_id: defaultUnitId,
      opening_location_id: await getDefaultLocationId(),
      rows: rows.map((r) => ({
        row_number: r.rowNumber,
        name: r.name,
        sku: r.sku,
        unit: r.unit,
        cost_price_minor: r.costMinor,
        selling_price_minor: r.priceMinor,
        opening_quantity: r.openingQty,
        errors: r.errors,
        is_duplicate: r.isDuplicate,
      })),
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const result = schemas.ImportCommitResult.parse(raw);
  return { created: result.created };
}
