import crypto from "node:crypto";
import { optionalEnv, requireEnv } from "../env";

const GRAPH_API_VERSION = optionalEnv("WHATSAPP_API_VERSION", "v21.0");

interface SendTextMessageResult {
  id: string;
}

/**
 * Sends a plain-text WhatsApp message via the Cloud API.
 * Outside a customer's 24h session window, Meta requires a pre-approved
 * template message instead of free text — that's not implemented here.
 */
export async function sendWhatsAppTextMessage(to: string, body: string): Promise<SendTextMessageResult> {
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  const id = json.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp send succeeded but returned no message id");
  return { id };
}

/**
 * Verifies the `X-Hub-Signature-256` header Meta attaches to webhook
 * deliveries, using the app secret. Must run against the *raw* request body
 * (before JSON parsing) since the signature covers the exact bytes sent.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const appSecret = requireEnv("WHATSAPP_APP_SECRET");
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/** Handles Meta's webhook subscription verification handshake (the GET request). */
export function verifySubscriptionChallenge(mode: string | null, token: string | null, challenge: string | null) {
  const verifyToken = requireEnv("WHATSAPP_VERIFY_TOKEN");
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}

export interface InboundWhatsAppMessage {
  from: string;
  whatsappMessageId: string;
  timestamp: string;
  body: string;
  contactName?: string;
}

export interface InboundWhatsAppStatus {
  whatsappMessageId: string;
  status: string;
  recipientId: string;
  timestamp: string;
}

interface WebhookValue {
  contacts?: { profile?: { name?: string }; wa_id: string }[];
  messages?: { from: string; id: string; timestamp: string; type: string; text?: { body: string } }[];
  statuses?: { id: string; status: string; recipient_id: string; timestamp: string }[];
}

interface WebhookPayload {
  entry?: { changes?: { value: WebhookValue; field: string }[] }[];
}

/** Flattens a Cloud API webhook payload into inbound text messages + status updates. */
export function parseInboundWebhook(payload: WebhookPayload): {
  messages: InboundWhatsAppMessage[];
  statuses: InboundWhatsAppStatus[];
} {
  const messages: InboundWhatsAppMessage[] = [];
  const statuses: InboundWhatsAppStatus[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const nameByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

      for (const m of value.messages ?? []) {
        if (m.type !== "text" || !m.text) continue;
        messages.push({
          from: m.from,
          whatsappMessageId: m.id,
          timestamp: m.timestamp,
          body: m.text.body,
          contactName: nameByWaId.get(m.from),
        });
      }

      for (const s of value.statuses ?? []) {
        statuses.push({
          whatsappMessageId: s.id,
          status: s.status,
          recipientId: s.recipient_id,
          timestamp: s.timestamp,
        });
      }
    }
  }

  return { messages, statuses };
}
