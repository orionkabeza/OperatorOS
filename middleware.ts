import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/api/webhooks/"];

/**
 * Content-Security-Policy for HTML responses. This is the single authoritative
 * CSP (nginx's static CSP add_header is intentionally removed so the two can't
 * conflict).
 *
 * `script-src` allows 'unsafe-inline' because Next.js App Router emits inline
 * hydration/bootstrap scripts and these pages are statically prerendered — a
 * per-request nonce can't be stamped into static HTML, so a nonce-based policy
 * would block hydration and leave the page non-interactive. The residual risk
 * of 'unsafe-inline' is bounded here: the app has no HTML-injection/XSS sinks
 * (no dangerouslySetInnerHTML/eval; React escapes all rendered strings) and no
 * third-party script origins are allowed. Everything else stays locked to
 * 'self'. (Follow-up for a stricter policy: force dynamic rendering on the
 * page routes and switch this to a nonce.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'", // React sets style attributes inline
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

function withSecurityResponse(): NextResponse {
  const response = NextResponse.next();
  response.headers.set("content-security-policy", CSP);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return withSecurityResponse();
  }
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifySessionToken(token);

  if (authenticated) {
    return withSecurityResponse();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
