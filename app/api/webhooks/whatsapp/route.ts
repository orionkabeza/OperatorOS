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
  } catch (err) {
    const message = err instanceof Error ? err.message : "WhatsApp is not configured";
    return NextResponse.json({ error: message }, { status: 501 });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "WhatsApp is not configured";
    return NextResponse.json({ error: message }, { status: 501 });
  }

  const payload = JSON.parse(rawBody);
  const { messages } = parseInboundWebhook(payload);

  for (const message of messages) {
    await recordInboundWhatsAppMessage(message);
  }

  // Meta requires a fast 200 ack regardless of downstream processing outcome.
  return NextResponse.json({ received: true });
}
