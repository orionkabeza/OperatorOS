import type { NextResponse } from "next/server";

/**
 * The httpOnly cookies backing real auth (see docs/DECISIONS.md "Real
 * frontend auth: httpOnly-cookie session"). Client-side JS never sees
 * a raw token -- app/session/*\/route.ts (server-side Next.js code) is
 * the only thing that reads or sets these; every other request just
 * carries them along automatically because they're same-origin cookies.
 */
export const ACCESS_TOKEN_COOKIE = "operatoros_access_token";
export const REFRESH_TOKEN_COOKIE = "operatoros_refresh_token";
export const BUSINESS_ID_COOKIE = "operatoros_business_id";

// Access tokens are short-lived (apps/api's own access_token_ttl_minutes
// default is 15) -- the cookie's own maxAge is set a little longer than
// that so an about-to-expire-but-not-yet-refreshed token is still sent
// (the backend rejects it as expired regardless; this just avoids the
// cookie itself vanishing a few seconds early and turning an "expired,
// please refresh" case into a confusing "not authenticated at all" one).
const ACCESS_TOKEN_MAX_AGE_SECONDS = 20 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Decodes a JWT payload without verifying the signature -- safe here
 * because these route handlers only ever call this on a token they just
 * received directly from apps/api over an internal, same-box request;
 * this never makes an authorization decision, only extracts the
 * business_id claim for the separate cookie /session/refresh and
 * /session/logout need to build their own backend request bodies. */
export function decodeJwtPayloadUnverified(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  const json = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function setSessionCookies(
  response: NextResponse,
  tokens: { access_token: string; refresh_token: string },
): void {
  const claims = decodeJwtPayloadUnverified(tokens.access_token);
  const businessId = typeof claims.business_id === "string" ? claims.business_id : "";

  // SameSite=Strict, not Lax: this app has no legitimate flow that needs
  // the cookie sent on a cross-site navigation (the pay-link flow is
  // unauthenticated/token-in-URL, not cookie-based), so Strict closes
  // off CSRF entirely rather than relying on Lax's narrower guarantees.
  const common = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };

  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    ...common,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
    ...common,
    // Scoped narrower than the other two -- only /session/refresh and
    // /session/logout ever need it, and it's the longest-lived,
    // highest-value token of the three.
    path: "/session",
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
  response.cookies.set(BUSINESS_ID_COOKIE, businessId, {
    ...common,
    path: "/session",
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", { path: "/session", maxAge: 0 });
  response.cookies.set(BUSINESS_ID_COOKIE, "", { path: "/session", maxAge: 0 });
}

export const INTERNAL_BACKEND_URL = process.env.OPERATOROS_INTERNAL_API_URL ?? "http://127.0.0.1:8000";
