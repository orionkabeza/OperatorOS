import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { applyMomoStatus, syncMomoPayment } from "@/lib/services/payments";

/**
 * MTN posts the request-to-pay outcome here. MTN doesn't sign callbacks, so
 * the URL we register with them (see `buildMomoCallbackUrl` in
 * lib/services/payments.ts) embeds the reference id and a shared secret.
 *
 * Security posture:
 *  - Fails CLOSED: with no MOMO_CALLBACK_SECRET configured the endpoint is
 *    disabled (503), never open. An unauthenticated caller must not be able
 *    to move an order's payment state.
 *  - The POST body is NOT trusted. The callback is only a trigger; the real
 *    status is fetched from MTN over the authenticated Collections API
 *    (`syncMomoPayment`), so a forged body can't mark an order paid. If that
 *    re-verification can't run, we fall back to the body but only after the
 *    shared-secret check has passed.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.MOMO_CALLBACK_SECRET;
  if (!expectedSecret) {
    console.error("[momo] webhook hit but MOMO_CALLBACK_SECRET is unset — endpoint disabled");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const ref = request.nextUrl.searchParams.get("ref");
  const secret = request.nextUrl.searchParams.get("secret") ?? "";

  if (!timingSafeEqualStr(secret, expectedSecret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  if (!ref) {
    return NextResponse.json({ error: "Missing ref" }, { status: 400 });
  }

  // Preferred path: ignore the body, ask MTN directly what happened.
  try {
    await syncMomoPayment(ref);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[momo] re-verification failed, falling back to callback body:", err);
  }

  // Fallback (secret already verified above): trust the body's status.
  const body = await request.json().catch(() => ({}));
  const status = body.status as "PENDING" | "SUCCESSFUL" | "FAILED" | undefined;
  if (status !== "SUCCESSFUL" && status !== "FAILED" && status !== "PENDING") {
    return NextResponse.json({ error: "Missing or invalid status" }, { status: 400 });
  }

  await applyMomoStatus(ref, status, body);
  return NextResponse.json({ received: true });
}
