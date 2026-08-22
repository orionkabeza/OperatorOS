import type { MinorUnits } from "@operatoros/shared";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { LOCATION_ID, LOCATION_ID_2, LOCATION_NAME, LOCATION_NAME_2 } from "../mock/seed";
import { schemas } from "./generated/client";
import { listProducts } from "./products";
import type { z } from "zod";
import type {
  AdjustStockInput,
  StockMovement,
  StockMovementFilters,
  StockMovementType,
  StockTransfer,
  Stocktake,
  StocktakeLine,
  StocktakeScope,
} from "./types";

const MOVEMENT_TYPE_MAP: Record<string, StockMovementType> = {
  purchase_receipt: "purchase_receipt",
  // "issue" (a manual stock-out via POST /stock/issue) has no distinct
  // frontend bucket — closest real analogue is a manual adjustment.
  issue: "adjustment",
  adjustment: "adjustment",
  transfer_out: "transfer",
  transfer_in: "transfer",
  write_off: "write_off",
  sale: "sale",
  return: "return",
};

async function mapStockMovement(m: z.infer<typeof schemas.StockMovementOut>, productNameById: Map<string, string>): Promise<StockMovement> {
  const isOutflow = Number(m.quantity_delta) < 0;
  return {
    id: m.id,
    productId: m.product_id,
    productName: productNameById.get(m.product_id) ?? m.product_id,
    type: MOVEMENT_TYPE_MAP[m.movement_type] ?? "adjustment",
    qtyDelta: m.quantity_delta,
    balanceAfter: m.running_balance,
    // StockMovementOut carries one `location_id`, not a from/to pair
    // (transfers are two separate movement rows, `transfer_out`/
    // `transfer_in`, each single-location) — derived from the sign of the
    // delta rather than fabricated.
    fromLocationId: isOutflow ? m.location_id : null,
    toLocationId: isOutflow ? null : m.location_id,
    userId: m.actor_user_id ?? "",
    userName: m.actor_user_id ?? "", // no separate display name on the wire
    reference: m.reference_id,
    timestamp: m.occurred_at,
  };
}

/** Real endpoint only supports `product_id`/`location_id`/`movement_type` query params — `from`/`to` date-range filtering happens client-side after fetch. */
export async function listStockMovements(filters?: StockMovementFilters): Promise<StockMovement[]> {
  if (USE_MOCK_API) {
    let rows = store.getDb().stockMovements;
    if (filters?.productId) rows = rows.filter((m) => m.productId === filters.productId);
    if (filters?.type) rows = rows.filter((m) => m.type === filters.type);
    return mockDelay(rows);
  }
  const [raw, products] = await Promise.all([
    apiRequest<unknown>("GET", "/api/v1/stock/movements", { query: { product_id: filters?.productId } }),
    listProducts(),
  ]);
  const productNameById = new Map(products.map((p) => [p.id, p.name]));
  let rows = await Promise.all(schemas.StockMovementOut.array().parse(raw).map((m) => mapStockMovement(m, productNameById)));
  if (filters?.type) rows = rows.filter((r) => r.type === filters.type);
  if (filters?.from) rows = rows.filter((r) => r.timestamp >= filters.from!);
  if (filters?.to) rows = rows.filter((r) => r.timestamp <= filters.to!);
  return rows;
}

export async function adjustStock(input: AdjustStockInput): Promise<StockMovement> {
  if (USE_MOCK_API) {
    return mockDelay(store.appendStockMovement({ productId: input.productId, type: "adjustment", qtyDelta: input.qtyDelta, reference: input.reason }));
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/stock/adjust", {
    body: { location_id: await getDefaultLocationId(), product_id: input.productId, quantity_delta: input.qtyDelta, reason: input.reason },
    idempotencyKey: newIdempotencyKey(),
  });
  // POST /adjust returns ProductLocationOut (the resulting balance), not a
  // StockMovementOut row — reconstructed here from what we do know (the
  // request just made) rather than a movement id/timestamp the response
  // doesn't carry.
  const balance = schemas.ProductLocationOut.parse(raw);
  const products = await listProducts();
  return {
    id: `${balance.product_id}-${Date.now()}`,
    productId: balance.product_id,
    productName: products.find((p) => p.id === balance.product_id)?.name ?? balance.product_id,
    type: "adjustment",
    qtyDelta: input.qtyDelta,
    balanceAfter: balance.on_hand,
    fromLocationId: null,
    toLocationId: null,
    userId: "",
    userName: "",
    reference: input.reason,
    timestamp: new Date().toISOString(),
  };
}

// --- Stock-takes --------------------------------------------------------

function mapStocktakeLine(l: z.infer<typeof schemas.StocktakeLineOut>): StocktakeLine {
  return {
    productId: l.product_id,
    productName: l.product_id, // StocktakeLineOut has no product name — enriching would need a per-line product lookup
    expectedQty: l.expected_quantity,
    countedQty: l.counted_quantity,
    countedBy: l.counted_by_user_id,
    countedAt: l.counted_at,
    varianceQty: l.variance_qty,
    varianceValueMinor: l.variance_value_minor as MinorUnits | null,
    reason: l.reason,
  };
}

function mapStocktakeOut(s: z.infer<typeof schemas.StocktakeOut>): Stocktake {
  return {
    id: s.id,
    status: s.status === "posted" ? "posted" : s.status === "reviewing" ? "review" : "counting",
    // StocktakeOut carries raw `scope`/no category or location display name
    // — a human label needs a category-name lookup this list view doesn't
    // warrant; the raw scope string stands in.
    scopeLabel: s.scope,
    freezeItems: s.freeze_during_count,
    startedAt: s.started_at,
    postedAt: s.posted_at,
    lines: (s.lines ?? []).map(mapStocktakeLine),
  };
}

/**
 * `StocktakeScope`'s real wire shape is a flat `scope: string` (`"all" |
 * "category" | "list"`, api/routers/stock_stocktake.py) plus a separate,
 * always-required `location_id` — not the frontend's `"all" | {categoryId}
 * | {locationId}` discriminated shape. `{locationId}` doesn't correspond to
 * a distinct backend scope (every stock-take is already scoped to one
 * location via the mandatory field) — treated as `scope: "all"` at that
 * location, which is what it actually means server-side.
 */
export async function startStocktake(scope: StocktakeScope, freezeItems: boolean): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.startStocktake(scope, freezeItems));
  let wireScope = "all";
  let categoryId: string | null = null;
  let locationId = await getDefaultLocationId();
  if (typeof scope === "object" && "categoryId" in scope) {
    wireScope = "category";
    categoryId = scope.categoryId;
  } else if (typeof scope === "object" && "locationId" in scope) {
    locationId = scope.locationId;
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/stock/stocktakes", {
    body: { location_id: locationId, scope: wireScope, category_id: categoryId, freeze_during_count: freezeItems },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapStocktakeOut(schemas.StocktakeOut.parse(raw));
}

export async function getStocktake(id: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.getStocktake(id));
  const raw = await apiRequest<unknown>("GET", `/api/v1/stock/stocktakes/${id}`);
  return mapStocktakeOut(schemas.StocktakeOut.parse(raw));
}

/** Real endpoint needs the stock-take LINE's own id (`.../lines/{line_id}/count`), not a product id — resolved via a `getStocktake` lookup first since the caller only has `productId`. */
export async function countStocktakeLine(stocktakeId: string, productId: string, countedQty: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.countStocktakeLine(stocktakeId, productId, countedQty));
  const currentRaw = await apiRequest<unknown>("GET", `/api/v1/stock/stocktakes/${stocktakeId}`);
  const current = schemas.StocktakeOut.parse(currentRaw);
  const line = (current.lines ?? []).find((l) => l.product_id === productId);
  if (!line) throw new Error(`No stock-take line for product ${productId} on stock-take ${stocktakeId}.`);
  await apiRequest<unknown>("POST", `/api/v1/stock/stocktakes/${stocktakeId}/lines/${line.id}/count`, {
    body: { counted_quantity: countedQty },
    idempotencyKey: newIdempotencyKey(),
  });
  const refreshedRaw = await apiRequest<unknown>("GET", `/api/v1/stock/stocktakes/${stocktakeId}`);
  return mapStocktakeOut(schemas.StocktakeOut.parse(refreshedRaw));
}

/**
 * There is no `POST .../review` (or any status-changing "move to review")
 * endpoint — `Stocktake.status` only ever goes `counting -> posted`
 * (api/routers/stock_stocktake.py::post_stocktake); `"reviewing"` is
 * checked for in a couple of places but nothing ever sets it. `GET
 * .../review` is a read-only view of the current lines, usable while still
 * `counting` — called here to refresh the real line data, but the
 * returned `Stocktake.status` stays whatever the backend actually reports
 * rather than claiming a transition that didn't happen.
 */
export async function moveStocktakeToReview(stocktakeId: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.moveStocktakeToReview(stocktakeId));
  const [linesRaw, stocktakeRaw] = await Promise.all([
    apiRequest<unknown>("GET", `/api/v1/stock/stocktakes/${stocktakeId}/review`),
    apiRequest<unknown>("GET", `/api/v1/stock/stocktakes/${stocktakeId}`),
  ]);
  const lines = schemas.StocktakeLineOut.array().parse(linesRaw);
  const stocktake = mapStocktakeOut(schemas.StocktakeOut.parse(stocktakeRaw));
  return { ...stocktake, lines: lines.map(mapStocktakeLine) };
}

export async function postStocktake(stocktakeId: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.postStocktake(stocktakeId));
  const raw = await apiRequest<unknown>("POST", `/api/v1/stock/stocktakes/${stocktakeId}/post`, { idempotencyKey: newIdempotencyKey() });
  return mapStocktakeOut(schemas.StocktakeOut.parse(raw));
}

/** No `GET /api/v1/stock/stocktakes` list endpoint exists at all — only create and get-by-id (api/routers/stock_stocktake.py's full route list). There is no way to enumerate past stock-takes against the real backend; genuinely unsupported, not a naming mismatch. */
export async function listStocktakes(): Promise<Stocktake[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().stocktakes);
  return notSupportedByBackend("Listing past stock-takes (no list endpoint exists — only create and get-by-id)");
}

// --- Transfers ------------------------------------------------------------

function mapTransferOut(t: z.infer<typeof schemas.TransferOut>): StockTransfer {
  return {
    id: t.id,
    fromLocationId: t.from_location_id,
    fromLocationName: t.from_location_id, // TransferOut has no location display name
    toLocationId: t.to_location_id,
    toLocationName: t.to_location_id,
    status: t.status as StockTransfer["status"],
    lines: (t.lines ?? []).map((l) => ({
      productId: l.product_id,
      productName: l.product_id, // TransferLineOut has no product name either
      qty: l.quantity_sent,
      receivedQty: l.quantity_received,
    })),
    createdAt: t.sent_at,
    receivedAt: t.received_at,
  };
}

export async function createTransfer(fromLocationId: string, toLocationId: string, lines: { productId: string; qty: string }[]): Promise<StockTransfer> {
  if (USE_MOCK_API) return mockDelay(store.createTransfer(fromLocationId, toLocationId, lines));
  const raw = await apiRequest<unknown>("POST", "/api/v1/stock/transfers", {
    body: {
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      lines: lines.map((l) => ({ product_id: l.productId, quantity: l.qty })),
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapTransferOut(schemas.TransferOut.parse(raw));
}

export async function receiveTransfer(transferId: string, received: { productId: string; qty: string }[]): Promise<StockTransfer> {
  if (USE_MOCK_API) return mockDelay(store.receiveTransfer(transferId, received));
  const raw = await apiRequest<unknown>("POST", `/api/v1/stock/transfers/${transferId}/receive`, {
    body: { lines: received.map((r) => ({ product_id: r.productId, quantity_received: r.qty })) },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapTransferOut(schemas.TransferOut.parse(raw));
}

/**
 * The locations a transfer can move stock between.
 *
 * `TransfersTab` used to import `LOCATION_ID`/`LOCATION_NAME` straight from
 * `lib/mock/seed.ts` and send those ids to the real API — the same mistake
 * that made `POST /day/open` fail on a foreign key, and it would also have
 * printed the demo branch names ("Nyabugogo", "Kimironko") to a business
 * that has neither. Mode-branching belongs here, not in a component.
 *
 * This used to be unsupported against a real backend: `GET
 * /api/v1/stock/locations` returns per-product stock rows (empty for a
 * business with no products), and `GET /api/v1/users/me` gave location ids
 * with no names. `MeOut.locations` now carries the names — added for the top
 * bar, which had the same problem and papered over it with a mock branch —
 * so this can answer for real. It lists the locations the signed-in user is
 * assigned to, which is the set they may transfer between.
 */
export async function listTransferLocations(): Promise<{ id: string; name: string }[]> {
  if (USE_MOCK_API) {
    return mockDelay([
      { id: LOCATION_ID, name: LOCATION_NAME },
      { id: LOCATION_ID_2, name: LOCATION_NAME_2 },
    ]);
  }
  const me = schemas.MeOut.parse(await apiRequest<unknown>("GET", "/api/v1/users/me"));
  return me.locations.map((l) => ({ id: l.id, name: l.name }));
}

/** No `GET /api/v1/stock/transfers` list endpoint exists at all — same gap as `listStocktakes`, only create and get-by-id exist. */
export async function listTransfers(): Promise<StockTransfer[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().transfers);
  return notSupportedByBackend("Listing past stock transfers (no list endpoint exists — only create, get-by-id, and receive)");
}
