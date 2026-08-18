import crypto from "node:crypto";
import { optionalEnv, requireEnv } from "../env";

/**
 * MTN Mobile Money — Collections API (Request to Pay).
 * Docs: https://momodeveloper.mtn.com
 *
 * Sandbox setup (manual, one-time, done by you — not automatable from here):
 *   1. Create an account at momodeveloper.mtn.com and subscribe to the
 *      "Collection" product to get an Ocp-Apim-Subscription-Key.
 *   2. Create a sandbox API user + API key (see MTN's "Sandbox User Provisioning"
 *      guide) — these become MOMO_API_USER / MOMO_API_KEY below.
 */

const TARGET_ENVIRONMENT = optionalEnv("MOMO_ENVIRONMENT", "sandbox");
const DEFAULT_BASE_URL =
  TARGET_ENVIRONMENT === "production" ? "https://momodeveloper.mtn.com" : "https://sandbox.momodeveloper.mtn.com";
const BASE_URL = optionalEnv("MOMO_BASE_URL", DEFAULT_BASE_URL);

let cachedToken: { value: string; expiresAt: number } | null = null;

function authHeaders() {
  return {
    "Ocp-Apim-Subscription-Key": requireEnv("MOMO_SUBSCRIPTION_KEY"),
    "X-Target-Environment": TARGET_ENVIRONMENT,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5_000) {
    return cachedToken.value;
  }

  const apiUser = requireEnv("MOMO_API_USER");
  const apiKey = requireEnv("MOMO_API_KEY");
  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");

  const res = await fetch(`${BASE_URL}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      ...authHeaders(),
    },
  });

  if (!res.ok) {
    throw new Error(`MoMo token request failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/** Strips everything but digits so `+233 24 118 4402` becomes `233241184402`. */
function toMsisdn(phone: string): string {
  return phone.replace(/\D/g, "");
}

export interface RequestToPayInput {
  amount: number;
  currency?: string;
  payerPhone: string;
  externalId: string;
  payerMessage: string;
  payeeNote: string;
  /**
   * Pre-generated reference id, so a caller can build a callback URL that
   * embeds it before making this call. Generated internally if omitted.
   */
  referenceId?: string;
  /**
   * Where MTN POSTs the outcome. Callers should embed the referenceId (and
   * a shared secret) as query params — MTN's callback body doesn't include
   * the referenceId, and callbacks aren't signed, so that's how we match
   * the notification back to a payment and confirm it's genuinely from us.
   */
  callbackUrl?: string;
}

/**
 * Initiates a Request to Pay. MTN responds 202 Accepted with no body — the
 * `referenceId` (generated here, or supplied via `input.referenceId`) is
 * what both sides use to track the transaction afterwards (poll
 * `getTransactionStatus`, or wait for the callback at `input.callbackUrl`
 * if one is configured).
 */
export async function requestToPay(input: RequestToPayInput): Promise<{ referenceId: string }> {
  const token = await getAccessToken();
  const referenceId = input.referenceId ?? crypto.randomUUID();

  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": referenceId,
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(input.callbackUrl ? { "X-Callback-Url": input.callbackUrl } : {}),
    },
    body: JSON.stringify({
      amount: String(input.amount),
      // Caller supplies the store's real currency (MOMO_CURRENCY, default GHS).
      // Note: MTN's *sandbox* only accepts "EUR" — set MOMO_CURRENCY=EUR there.
      currency: input.currency ?? "GHS",
      externalId: input.externalId,
      payer: { partyIdType: "MSISDN", partyId: toMsisdn(input.payerPhone) },
      payerMessage: input.payerMessage,
      payeeNote: input.payeeNote,
    }),
  });

  if (res.status !== 202) {
    throw new Error(`MoMo requestToPay failed (${res.status}): ${await res.text()}`);
  }

  return { referenceId };
}

export type MomoTransactionStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface MomoTransaction {
  status: MomoTransactionStatus;
  amount: string;
  currency: string;
  financialTransactionId?: string;
  reason?: string;
}

export async function getTransactionStatus(referenceId: string): Promise<MomoTransaction> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...authHeaders(),
    },
  });

  if (!res.ok) {
    throw new Error(`MoMo status check failed (${res.status}): ${await res.text()}`);
  }

  return (await res.json()) as MomoTransaction;
}
