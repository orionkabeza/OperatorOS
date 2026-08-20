import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import type { CloseTillInput, OpenTillInput, TillSession } from "./types";

export async function getOpenTillSession(): Promise<TillSession | null> {
  if (USE_MOCK_API) return mockDelay(store.getOpenTillSession());
  return apiRequest<TillSession | null>("GET", "/api/v1/till/open-session");
}

export async function openTillSession(input: OpenTillInput): Promise<TillSession> {
  if (USE_MOCK_API) return mockDelay(store.openTill(input));
  return apiRequest<TillSession>("POST", "/api/v1/till/open", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function closeTillSession(input: CloseTillInput): Promise<TillSession> {
  if (USE_MOCK_API) return mockDelay(store.closeTill(input));
  return apiRequest<TillSession>("POST", "/api/v1/till/close", { body: input, idempotencyKey: newIdempotencyKey() });
}
