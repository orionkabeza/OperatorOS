import { minorUnits, type MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { z } from "zod";
import type { MatchMomoTransactionInput, MomoProviderConnection, MomoTransaction } from "./types";

function mapMomoTransaction(t: z.infer<typeof schemas.MomoTransactionOut>): MomoTransaction {
  return {
    id: t.id,
    provider: (t.provider as MomoTransaction["provider"] | undefined) ?? "mtn",
    externalId: t.external_id,
    phone: t.phone,
    amountMinor: minorUnits(t.amount_minor),
    direction: (t.direction as MomoTransaction["direction"] | undefined) ?? "in",
    occurredAt: t.occurred_at,
    status: (t.status as MomoTransaction["status"] | undefined) ?? "unmatched",
    matchedCustomerId: t.matched_to_type === "debt_payment" || t.matched_to_type === "invoice" ? t.matched_to_id : null,
    // Real MomoTransactionOut carries no matched customer's name or a
    // confidence score once matched — only `/transactions/suggestions`
    // (before matching) has those. Genuinely unavailable post-match.
    matchedCustomerName: null,
    matchConfidence: null,
  };
}

export async function listMomoTransactions(): Promise<MomoTransaction[]> {
  if (USE_MOCK_API) return mockDelay(store.listMomoTransactions());
  const raw = await apiRequest<unknown>("GET", "/api/v1/momo/transactions");
  return schemas.MomoTransactionOut.array().parse(raw).map(mapMomoTransaction);
}

/** No `/unmatched-total` endpoint exists — derived client-side from the real transaction list rather than invented or thrown, since the underlying data (status + amount) is genuinely available from `GET /transactions`. */
export async function getUnmatchedMomoTotal(): Promise<{ totalMinor: MinorUnits; count: number }> {
  if (USE_MOCK_API) return mockDelay(store.unmatchedMomoTotal());
  const transactions = await listMomoTransactions();
  const unmatched = transactions.filter((t) => t.status === "unmatched");
  return {
    totalMinor: minorUnits(unmatched.reduce((sum, t) => sum + t.amountMinor, 0)),
    count: unmatched.length,
  };
}

/**
 * Real endpoint: `POST /api/v1/momo/transactions/{id}/match`, body
 * `MomoMatchRequest{ matched_to_type, location_id?, customer_id?, sale_id? }`
 * — `matched_to_type` is one of `invoice | debt_payment | other_income |
 * not_ours` (schemas/momo.py), not a customer/sale toggle the frontend
 * currently models. `matchMomoTransaction`'s existing (customerId-only)
 * signature maps to `"debt_payment"` — matching a transaction against a
 * customer's account balance, the Debt Book's actual use of this action.
 * There is no `GET` for a single transaction, so the updated row is
 * recovered by re-listing rather than trusting a locally-reconstructed
 * copy.
 */
export async function matchMomoTransaction(input: MatchMomoTransactionInput): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.matchMomoTransaction(input));
  await apiRequest<unknown>("POST", `/api/v1/momo/transactions/${input.momoTransactionId}/match`, {
    body: { matched_to_type: "debt_payment", location_id: await getDefaultLocationId(), customer_id: input.customerId },
    idempotencyKey: newIdempotencyKey(),
  });
  const transactions = await listMomoTransactions();
  const updated = transactions.find((t) => t.id === input.momoTransactionId);
  if (!updated) throw new Error(`MoMo transaction ${input.momoTransactionId} not found after matching.`);
  return updated;
}

/** No backend counterpart at all (momo.py has no `/mark-cash` route) — genuinely unsupported, not a naming mismatch. See docs/DECISIONS.md. */
export async function markMomoAsCash(momoTransactionId: string): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.markMomoAsCash(momoTransactionId));
  return notSupportedByBackend(`Marking MoMo transaction ${momoTransactionId} as cash`);
}

/** No backend counterpart at all (momo.py has no `/void` route) — genuinely unsupported, not a naming mismatch. See docs/DECISIONS.md. */
export async function voidMomoTransaction(momoTransactionId: string): Promise<MomoTransaction> {
  if (USE_MOCK_API) return mockDelay(store.voidMomoTransaction(momoTransactionId));
  return notSupportedByBackend(`Voiding MoMo transaction ${momoTransactionId}`);
}

/**
 * No standalone "request a MoMo payment" endpoint exists outside a pay
 * link — the only real request-payment path is `POST
 * /api/pay/{token}/request-payment` (pay.ts), which is deliberately
 * public/token-scoped (docs/DECISIONS.md "Pay-link tokens are signed
 * JWTs") for an unauthenticated customer to act on, a genuinely different
 * security model from an authenticated cashier requesting a push against
 * an arbitrary customer+amount from inside the Debt Book. Silently
 * chaining "create a pay link, then hit its request-payment route" here
 * would reuse a public capability outside the flow it was designed for
 * without confirming that's actually the intended UX — flagged as a real,
 * disclosed gap rather than invented. See docs/DECISIONS.md.
 */
export async function requestMomoPayment(customerId: string, amountMinor: MinorUnits, phone: string): Promise<{ requestId: string }> {
  if (USE_MOCK_API) return mockDelay(store.requestMomoPayment(customerId, amountMinor, phone));
  return notSupportedByBackend(`Requesting a standalone MoMo payment for customer ${customerId} (phone ${phone})`);
}

// --- Back Office: provider connection (D.7, "Connect now" against the sandbox) ---

/**
 * There is no `GET` for provider-connection status — only `POST /connect`
 * and `POST /disconnect`, both returning `MomoConnectOut` at the moment of
 * the call (verified: momo.py has no other read of
 * `MomoProviderCredential`, and neither `MoneyLocationOut`/`BalanceCardOut`
 * carry it — cashbox's `connection_status` is a wholly separate concept
 * per-money-location, unrelated to `MomoProviderCredential`). This module
 * remembers the last known state from `connectMomo`/`disconnectMomo` within
 * the browser session; a fresh page load with no prior connect/disconnect
 * call in this session has no way to ask the backend "are we connected?"
 * and conservatively reports `not_connected` rather than guessing
 * `connected`. See docs/DECISIONS.md.
 */
let lastKnownConnection: MomoProviderConnection | null = null;

export async function getMomoConnection(): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.getMomoConnection());
  return lastKnownConnection ?? { provider: "mtn", status: "not_connected", merchantCode: null };
}

export async function connectMomo(merchantCode: string): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.setMomoConnection("connected", merchantCode));
  const raw = await apiRequest<unknown>("POST", "/api/v1/momo/connect", {
    body: { merchant_ref: merchantCode },
    idempotencyKey: newIdempotencyKey(),
  });
  const result = schemas.MomoConnectOut.parse(raw);
  const connection: MomoProviderConnection = {
    provider: (result.provider as MomoProviderConnection["provider"] | undefined) ?? "mtn",
    status: result.status === "connected" ? "connected" : "not_connected",
    merchantCode,
  };
  lastKnownConnection = connection;
  return connection;
}

export async function disconnectMomo(): Promise<MomoProviderConnection> {
  if (USE_MOCK_API) return mockDelay(store.setMomoConnection("not_connected"));
  const raw = await apiRequest<unknown>("POST", "/api/v1/momo/disconnect", { idempotencyKey: newIdempotencyKey() });
  const result = schemas.MomoConnectOut.parse(raw);
  const connection: MomoProviderConnection = {
    provider: (result.provider as MomoProviderConnection["provider"] | undefined) ?? "mtn",
    status: "not_connected",
    merchantCode: null,
  };
  lastKnownConnection = connection;
  return connection;
}
