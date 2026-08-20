import { NextRequest, NextResponse } from "next/server";

/**
 * Nonce-based CSP with no `unsafe-inline` anywhere (spec G.1: "a strict
 * Content-Security-Policy with no `unsafe-inline`"). A prior version of this
 * product (see legacy/) settled for `script-src 'self' 'unsafe-inline'`
 * because its pages were statically prerendered and a per-request nonce
 * can't be stamped into static HTML. This app avoids that trade-off instead
 * of repeating it: the nonce goes on the request via `x-nonce`, the root
 * layout reads it with `headers()`, and reading a dynamic API in a Server
 * Component automatically opts that route out of static rendering in the
 * Next.js App Router — so the nonce is genuinely per-request, not baked in
 * at build time. Every component must reach the page through Tailwind
 * classes, never inline `style={{...}}` or `dangerouslySetInnerHTML` in
 * *our own* code — that discipline keeps `script-src` free of
 * `unsafe-inline` entirely, and keeps `style-src-elem` (actual
 * `<style>`/`<link>` tags) locked to `'self'` with no exception at all.
 *
 * `style-src-attr 'unsafe-inline'` below is a narrow, deliberate exception —
 * not the same as a blanket `style-src 'unsafe-inline'`. It exists because
 * Radix UI primitives (required by the stack) set genuine inline
 * `style=""` attributes internally — e.g. Checkbox's visually-hidden
 * native input, or a `pointer-events` toggle during an animation —
 * confirmed via `securitypolicyviolation` events, not guessed. CSP Level 3
 * splits inline style *attributes* from style *elements* precisely for
 * this: an attacker who can inject `style=""` onto an existing element can
 * cause visual mischief but not script execution — a categorically smaller
 * risk than inline `<style>`/`<script>`. See docs/DECISIONS.md.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
