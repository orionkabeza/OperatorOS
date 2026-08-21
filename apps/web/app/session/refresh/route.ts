import { NextRequest, NextResponse } from "next/server";
import {
  BUSINESS_ID_COOKIE,
  INTERNAL_BACKEND_URL,
  REFRESH_TOKEN_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from "@/lib/session-cookies";

/**
 * Rotates the access/refresh token pair (POST /api/v1/auth/refresh).
 * Reads the refresh token from its own httpOnly cookie -- never sent by
 * the browser as a request body, since client-side JS can't read it
 * either. `lib/api/config.ts::apiRequest` calls this once, silently, on
 * a 401 from any real API call and retries the original request; if
 * this itself 401s, the session is really over and the caller should
 * sign out.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const businessId = request.cookies.get(BUSINESS_ID_COOKIE)?.value;

  if (!refreshToken || !businessId) {
    return NextResponse.json({ detail: "No session to refresh." }, { status: 401 });
  }

  const backendRes = await fetch(`${INTERNAL_BACKEND_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_id: businessId, refresh_token: refreshToken }),
  });

  if (!backendRes.ok) {
    const response = NextResponse.json({ detail: "Session invalidated. Please sign in again." }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const body = await backendRes.json();
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, body);
  return response;
}
