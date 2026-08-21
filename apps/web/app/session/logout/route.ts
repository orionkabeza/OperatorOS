import { NextRequest, NextResponse } from "next/server";
import {
  BUSINESS_ID_COOKIE,
  INTERNAL_BACKEND_URL,
  REFRESH_TOKEN_COOKIE,
  clearSessionCookies,
} from "@/lib/session-cookies";

/** Revokes the refresh token family server-side (best-effort) and
 * always clears the session cookies regardless of whether the backend
 * call succeeds -- a network hiccup here must never leave the browser
 * looking signed-in when it isn't. */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const businessId = request.cookies.get(BUSINESS_ID_COOKIE)?.value;

  if (refreshToken && businessId) {
    await fetch(`${INTERNAL_BACKEND_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, refresh_token: refreshToken }),
    }).catch(() => undefined);
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}
