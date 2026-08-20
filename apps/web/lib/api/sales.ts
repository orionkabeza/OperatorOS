import type { MinorUnits } from "@operatoros/shared";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import type {
  BasketLineInput,
  CreditLimitCheck,
  ParkedSale,
  Quote,
  RecordReturnInput,
  RecordSaleInput,
  Sale,
} from "./types";

/** The Counter's basket-to-sale call — atomic in the real backend (spec D.4: one transaction). */
export async function recordSale(input: RecordSaleInput): Promise<Sale> {
  if (USE_MOCK_API) return mockDelay(store.recordSale(input), 250);
  return apiRequest<Sale>("POST", "/api/v1/sales", { body: input, idempotencyKey: newIdempotencyKey() });
}

/** Writes a reversing event, never deletes — spec D.4 "Undo" toast affordance. */
export async function undoSale(saleId: string): Promise<void> {
  if (USE_MOCK_API) {
    store.reverseSale(saleId);
    await mockDelay(undefined);
    return;
  }
  await apiRequest<void>("POST", `/api/v1/sales/${saleId}/reverse`, { idempotencyKey: newIdempotencyKey() });
}

export async function checkCreditLimit(customerId: string, addMinor: MinorUnits): Promise<CreditLimitCheck> {
  if (USE_MOCK_API) return mockDelay(store.checkCreditLimit(customerId, addMinor));
  return apiRequest<CreditLimitCheck>("GET", `/api/v1/customers/${customerId}/credit-check`, {
    query: { addMinor: String(addMinor) },
  });
}

export async function parkSale(label: string, lines: BasketLineInput[], customerId: string | null): Promise<ParkedSale> {
  if (USE_MOCK_API) return mockDelay(store.parkSale(label, lines, customerId));
  return apiRequest<ParkedSale>("POST", "/api/v1/sales/park", { body: { label, lines, customerId }, idempotencyKey: newIdempotencyKey() });
}

export async function listParkedSales(): Promise<ParkedSale[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().parkedSales);
  return apiRequest<ParkedSale[]>("GET", "/api/v1/sales/parked");
}

export async function resumeParkedSale(id: string): Promise<ParkedSale | undefined> {
  if (USE_MOCK_API) return mockDelay(store.unparkSale(id));
  return apiRequest<ParkedSale>("POST", `/api/v1/sales/parked/${id}/resume`, { idempotencyKey: newIdempotencyKey() });
}

export async function issueQuote(lines: BasketLineInput[], customerId: string | null, totalMinor: MinorUnits): Promise<Quote> {
  if (USE_MOCK_API) return mockDelay(store.issueQuote(lines, customerId, totalMinor));
  return apiRequest<Quote>("POST", "/api/v1/quotes", { body: { lines, customerId, totalMinor }, idempotencyKey: newIdempotencyKey() });
}

export async function listQuotes(): Promise<Quote[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().quotes);
  return apiRequest<Quote[]>("GET", "/api/v1/quotes");
}

export async function listTodaysSales(): Promise<Sale[]> {
  if (USE_MOCK_API) {
    const day = store.getDaySession();
    const rows = day.openedAt ? store.getDb().sales.filter((s) => s.createdAt >= day.openedAt!) : [];
    return mockDelay(rows);
  }
  return apiRequest<Sale[]>("GET", "/api/v1/sales", { query: { scope: "today" } });
}

export async function findSaleByReceipt(receiptNumber: string): Promise<Sale | undefined> {
  if (USE_MOCK_API) {
    return mockDelay(store.getDb().sales.find((s) => s.receiptNumber === receiptNumber));
  }
  return apiRequest<Sale>("GET", `/api/v1/sales/by-receipt/${receiptNumber}`);
}

export async function recordReturn(input: RecordReturnInput): Promise<{ refundMinor: MinorUnits }> {
  if (USE_MOCK_API) return mockDelay(store.recordReturn(input));
  return apiRequest<{ refundMinor: MinorUnits }>("POST", "/api/v1/returns", { body: input, idempotencyKey: newIdempotencyKey() });
}
