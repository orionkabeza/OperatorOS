import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import type {
  AdjustStockInput,
  StockMovement,
  StockMovementFilters,
  StockTransfer,
  Stocktake,
  StocktakeScope,
} from "./types";

export async function listStockMovements(filters?: StockMovementFilters): Promise<StockMovement[]> {
  if (USE_MOCK_API) {
    let rows = store.getDb().stockMovements;
    if (filters?.productId) rows = rows.filter((m) => m.productId === filters.productId);
    if (filters?.type) rows = rows.filter((m) => m.type === filters.type);
    return mockDelay(rows);
  }
  return apiRequest<StockMovement[]>("GET", "/api/v1/stock/movements", {
    query: { productId: filters?.productId, type: filters?.type, from: filters?.from, to: filters?.to },
  });
}

export async function adjustStock(input: AdjustStockInput): Promise<StockMovement> {
  if (USE_MOCK_API) {
    return mockDelay(store.appendStockMovement({ productId: input.productId, type: "adjustment", qtyDelta: input.qtyDelta, reference: input.reason }));
  }
  return apiRequest<StockMovement>("POST", "/api/v1/stock/adjust", { body: input, idempotencyKey: newIdempotencyKey() });
}

// --- Stock-takes --------------------------------------------------------

export async function startStocktake(scope: StocktakeScope, freezeItems: boolean): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.startStocktake(scope, freezeItems));
  return apiRequest<Stocktake>("POST", "/api/v1/stock/stocktakes", { body: { scope, freezeItems }, idempotencyKey: newIdempotencyKey() });
}

export async function getStocktake(id: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.getStocktake(id));
  return apiRequest<Stocktake>("GET", `/api/v1/stock/stocktakes/${id}`);
}

export async function countStocktakeLine(stocktakeId: string, productId: string, countedQty: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.countStocktakeLine(stocktakeId, productId, countedQty));
  return apiRequest<Stocktake>("POST", `/api/v1/stock/stocktakes/${stocktakeId}/count`, {
    body: { productId, countedQty },
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function moveStocktakeToReview(stocktakeId: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.moveStocktakeToReview(stocktakeId));
  return apiRequest<Stocktake>("POST", `/api/v1/stock/stocktakes/${stocktakeId}/review`, { idempotencyKey: newIdempotencyKey() });
}

export async function postStocktake(stocktakeId: string): Promise<Stocktake> {
  if (USE_MOCK_API) return mockDelay(store.postStocktake(stocktakeId));
  return apiRequest<Stocktake>("POST", `/api/v1/stock/stocktakes/${stocktakeId}/post`, { idempotencyKey: newIdempotencyKey() });
}

export async function listStocktakes(): Promise<Stocktake[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().stocktakes);
  return apiRequest<Stocktake[]>("GET", "/api/v1/stock/stocktakes");
}

// --- Transfers ------------------------------------------------------------

export async function createTransfer(fromLocationId: string, toLocationId: string, lines: { productId: string; qty: string }[]): Promise<StockTransfer> {
  if (USE_MOCK_API) return mockDelay(store.createTransfer(fromLocationId, toLocationId, lines));
  return apiRequest<StockTransfer>("POST", "/api/v1/stock/transfers", {
    body: { fromLocationId, toLocationId, lines },
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function receiveTransfer(transferId: string, received: { productId: string; qty: string }[]): Promise<StockTransfer> {
  if (USE_MOCK_API) return mockDelay(store.receiveTransfer(transferId, received));
  return apiRequest<StockTransfer>("POST", `/api/v1/stock/transfers/${transferId}/receive`, {
    body: { received },
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function listTransfers(): Promise<StockTransfer[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().transfers);
  return apiRequest<StockTransfer[]>("GET", "/api/v1/stock/transfers");
}
