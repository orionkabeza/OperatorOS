import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_BACKEND_URL, setSessionCookies } from "@/lib/session-cookies";

/**
 * Server-side proxy for POST /api/v1/auth/login (see
 * docs/DECISIONS.md "Real frontend auth: httpOnly-cookie session").
 * Never called directly from client-side JS against apps/api -- this is
 * the ONLY place that ever sees a raw access/refresh token; on success
 * it sets them as httpOnly cookies and returns nothing but a boolean to
 * the browser. Calls apps/api over the internal 127.0.0.1 hop, not the
 * public domain -- same box, no reason to round-trip through nginx/HAProxy.
 */
export async function POST(request: NextRequest) {
  const { businessSlug, phone, pin, deviceId, remember } = await request.json();

  const backendRes = await fetch(`${INTERNAL_BACKEND_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      business_slug: businessSlug,
      identifier: phone,
      secret: pin,
      device_id: deviceId,
      remember_device: remember,
    }),
  });

  const body = await backendRes.json().catch(() => ({}));

  if (!backendRes.ok) {
    const retryAfter = backendRes.headers.get("retry-after");
    const remaining = backendRes.headers.get("x-remaining-attempts");
    return NextResponse.json(
      { detail: body.detail ?? "Sign-in failed." },
      {
        status: backendRes.status,
        headers: {
          ...(retryAfter ? { "Retry-After": retryAfter } : {}),
          ...(remaining ? { "X-Remaining-Attempts": remaining } : {}),
        },
      },
    );
  }

  if (body.totp_required) {
    return NextResponse.json({ totpRequired: true, challengeToken: body.challenge_token });
  }

  const response = NextResponse.json({ totpRequired: false });
  setSessionCookies(response, body);
  return response;
}
