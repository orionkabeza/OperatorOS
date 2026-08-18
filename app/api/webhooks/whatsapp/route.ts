import { NextRequest, NextResponse } from "next/server";
import { parseInboundWebhook, verifySubscriptionChallenge, verifyWebhookSignature } from "@/lib/integrations/whatsapp";
import { recordInboundWhatsAppMessage } from "@/lib/services/messages";

/** Meta's one-time subscription verification handshake when you register this URL. */
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  try {
    const result = verifySubscriptionChallenge(mode, token, challenge);
    if (result) {
      return new NextResponse(result, { status: 200 });
    }
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  } catch {
    // Don't disclose which env var is unset to an unauthenticated caller.
    console.error("[whatsapp] verification hit but WHATSAPP_VERIFY_TOKEN is unset");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
}

/** Inbound messages + delivery status updates land here. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  try {
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch {
    console.error("[whatsapp] webhook hit but WHATSAPP_APP_SECRET is unset");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages } = parseInboundWebhook(payload as Parameters<typeof parseInboundWebhook>[0]);

  // Persist each message independently: one bad/duplicate row must not drop
  // the rest of the batch. Meta redelivers on non-200 and batches multiple
  // messages per delivery, so we always ack 200 and swallow per-message errors
  // (duplicate whatsappMessageId is expected on redelivery).
  for (const message of messages) {
    try {
      await recordInboundWhatsAppMessage(message);
    } catch (err) {
      console.error("[whatsapp] failed to record message", message.whatsappMessageId, err);
    }
  }

  return NextResponse.json({ received: true });
}
