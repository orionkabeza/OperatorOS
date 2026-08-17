import { NextRequest, NextResponse } from "next/server";
import { applyMomoStatus } from "@/lib/services/payments";

/**
 * MTN posts the request-to-pay outcome here. MTN doesn't sign callbacks, so
 * the URL we register with them (see `buildMomoCallbackUrl` in
 * lib/services/payments.ts) embeds the reference id and a shared secret —
 * both are checked before touching the database.
 */
export async function POST(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  const secret = request.nextUrl.searchParams.get("secret");

  if (!ref) {
    return NextResponse.json({ error: "Missing ref" }, { status: 400 });
  }

  const expectedSecret = process.env.MOMO_CALLBACK_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const status = body.status as "PENDING" | "SUCCESSFUL" | "FAILED" | undefined;

  if (status !== "SUCCESSFUL" && status !== "FAILED" && status !== "PENDING") {
    return NextResponse.json({ error: "Missing or invalid status" }, { status: 400 });
  }

  await applyMomoStatus(ref, status);
  return NextResponse.json({ received: true });
}
