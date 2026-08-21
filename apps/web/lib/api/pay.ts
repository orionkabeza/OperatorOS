import { minorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { PayLinkDetails, SubmitPayLinkResult } from "./types";

/**
 * D.6.5/§0.5 — the public, unauthenticated pay-link surface. Deliberately
 * NOT idempotency-keyed the same way the authenticated debt endpoints are:
 * per plan §3, this and the MoMo webhook are the two routes that are
 * idempotent on `(provider, external_id)` / the token itself rather than a
 * client-supplied `Idempotency-Key`, since an external system — not our own
 * authenticated client — controls retries here.
 *
 * The real router (api/routers/pay.py) is mounted bare at `/pay/{token}` —
 * deliberately outside `/api/v1` (docs/DECISIONS.md "Pay-link tokens are
 * signed JWTs") — never `/api/v1/pay/...`. Confirmed against
 * lib/api/generated/client.ts's endpoint list, which carries the same two
 * path shapes (`/api/v1/...` and bare `/pay/...`) in one generated file.
 */
export async function getPayLink(token: string): Promise<PayLinkDetails> {
  if (USE_MOCK_API) return mockDelay(store.getPayLink(token));
  const raw = await apiRequest<unknown>("GET", `/pay/${token}`);
  const page = schemas.PayLinkPageOut.parse(raw);
  return {
    status: page.status as PayLinkDetails["status"],
    businessName: page.business_name,
    customerName: page.customer_name,
    amountMinor: minorUnits(page.amount_minor),
    // PayLinkPageOut carries no invoice reference field — the real pay link
    // is tied to a customer's whole account, not one invoice; never invented.
    invoiceRef: null,
    expiresAt: page.expires_at,
  };
}

/**
 * `method` only steers the MOCK provider (which of two fake providers
 * "sends" the push) — the real backend has exactly one configured
 * `MobileMoneyProvider` (docs/DECISIONS.md "mobile money is a real
 * signed-webhook seam behind a sandbox provider") and
 * `PayLinkRequestPaymentRequest` (schemas/pay.py) takes only `{ phone }`;
 * there is no method/provider field on the wire at all, confirmed against
 * the generated schema. The real endpoint is also
 * `POST /pay/{token}/request-payment`, not `/pay/{token}/submit` (that path
 * doesn't exist server-side).
 */
export async function submitPayLink(token: string, method: "momo" | "airtel", phone: string): Promise<SubmitPayLinkResult> {
  if (USE_MOCK_API) return mockDelay(store.submitPayLink(token, method, phone));
  const raw = await apiRequest<unknown>("POST", `/pay/${token}/request-payment`, { body: { phone } });
  const result = schemas.PayLinkRequestPaymentOut.parse(raw);
  // The real endpoint always returns status "pending" (the sandbox push
  // settles asynchronously via the webhook a few seconds later) — map onto
  // the frontend's existing "pending_confirmation" | "paid" union.
  return { status: result.status === "paid" ? "paid" : "pending_confirmation" };
}

export async function getPayLinkStatus(token: string): Promise<PayLinkDetails["status"]> {
  if (USE_MOCK_API) return mockDelay(store.payLinkStatusOnly(token));
  const raw = await apiRequest<unknown>("GET", `/pay/${token}/status`);
  const result = schemas.PayLinkStatusOut.parse(raw);
  return result.status as PayLinkDetails["status"];
}
