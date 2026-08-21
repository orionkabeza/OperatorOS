import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_BACKEND_URL, setSessionCookies } from "@/lib/session-cookies";

/** Server-side proxy for POST /api/v1/auth/totp/verify -- the second
 * step of login when the signed-in role has 2FA enabled. Same
 * httpOnly-cookie handoff as /session/login; see that route's comment. */
export async function POST(request: NextRequest) {
  const { challengeToken, code } = await request.json();

  const backendRes = await fetch(`${INTERNAL_BACKEND_URL}/api/v1/auth/totp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_token: challengeToken, code }),
  });

  const body = await backendRes.json().catch(() => ({}));

  if (!backendRes.ok) {
    return NextResponse.json({ detail: body.detail ?? "That code is wrong or has expired." }, { status: backendRes.status });
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, body);
  return response;
}
