import type { MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import type { MatchMomoTransactionInput, MomoProviderConnection, MomoTransaction } from "./types";

export async function listMomoTransactions(): Promise<MomoTransaction[]> {
  if (USE_MOCK_API) return mockDelay(store.listMomoTransactions());
  return apiRequest<MomoTransaction[]>("GET", "/api/v1/momo/transactions");
}

export async function getUnmatchedMomoTotal(): Promise<{ totalMinor: MinorUnits; count: number }> {
  if (USE_MOCK_API) return mockDelay(store.unmatchedMomoTotal());
  return apiRequest<{ totalMinor: MinorUnits; count: number }>("GET", "/api/v1/momo/transactions/unmatched-total");
}

export async function matchMomoTransaction(input: MatchMomoTransactionInput): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.matchMomoTransaction(input));
  return apiRequest<MomoTransaction>("POST", `/api/v1/momo/transactions/${input.momoTransactionId}/match`, {
    body: { customerId: input.customerId },
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function markMomoAsCash(momoTransactionId: string): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.markMomoAsCash(momoTransactionId));
  return apiRequest<MomoTransaction>("POST", `/api/v1/momo/transactions/${momoTransactionId}/mark-cash`, { idempotencyKey: newIdempotencyKey() });
}

export async function voidMomoTransaction(momoTransactionId: string): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.voidMomoTransaction(momoTransactionId));
  return apiRequest<MomoTransaction>("POST", `/api/v1/momo/transactions/${momoTransactionId}/void`, { idempotencyKey: newIdempotencyKey() });
}

/** D.6.5/§0.3 — requests a payment push against the sandbox MoMo provider; the resulting transaction lands via the same signed-webhook path a real provider would use, settling a few seconds later. */
export async function requestMomoPayment(customerId: string, amountMinor: MinorUnits, phone: string): Promise<{ requestId: string }> {
  if (USE_MOCK_API) return mockDelay(store.requestMomoPayment(customerId, amountMinor, phone));
  return apiRequest<{ requestId: string }>("POST", "/api/v1/momo/request-payment", {
    body: { customerId, amountMinor, phone },
    idempotencyKey: newIdempotencyKey(),
  });
}

// --- Back Office: provider connection (D.7, "Connect now" against the sandbox) ---

export async function getMomoConnection(): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.getMomoConnection());
  return apiRequest<MomoProviderConnection>("GET", "/api/v1/momo/connection");
}

export async function connectMomo(merchantCode: string): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.setMomoConnection("connected", merchantCode));
  return apiRequest<MomoProviderConnection>("POST", "/api/v1/momo/connect", { body: { merchantCode }, idempotencyKey: newIdempotencyKey() });
}

export async function disconnectMomo(): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.setMomoConnection("not_connected"));
  return apiRequest<MomoProviderConnection>("POST", "/api/v1/momo/disconnect", { idempotencyKey: newIdempotencyKey() });
}
