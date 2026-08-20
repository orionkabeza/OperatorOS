import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, USE_MOCK_API } from "./config";
import type { PayLinkDetails, SubmitPayLinkResult } from "./types";

/**
 * D.6.5/§0.5 — the public, unauthenticated pay-link surface. Deliberately
 * NOT idempotency-keyed the same way the authenticated debt endpoints are:
 * per plan §3, this and the MoMo webhook are the two routes that are
 * idempotent on `(provider, external_id)` / the token itself rather than a
 * client-supplied `Idempotency-Key`, since an external system — not our own
 * authenticated client — controls retries here.
 */
export async function getPayLink(token: string): Promise<PayLinkDetails> {
  if (USE_MOCK_API) return mockDelay(store.getPayLink(token));
  return apiRequest<PayLinkDetails>("GET", `/api/v1/pay/${token}`);
}

export async function submitPayLink(token: string, method: "momo" | "airtel", phone: string): Promise<SubmitPayLinkResult> {
  if (USE_MOCK_API) return mockDelay(store.submitPayLink(token, method, phone));
  return apiRequest<SubmitPayLinkResult>("POST", `/api/v1/pay/${token}/submit`, { body: { method, phone } });
}

export async function getPayLinkStatus(token: string): Promise<PayLinkDetails["status"]> {
  if (USE_MOCK_API) return mockDelay(store.payLinkStatusOnly(token));
  return apiRequest<PayLinkDetails["status"]>("GET", `/api/v1/pay/${token}/status`);
}
