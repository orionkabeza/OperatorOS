import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, verifyOwnerPassword } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const LOGIN_LIMIT = 8; // attempts
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // per 15 minutes per IP

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limit = rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  let ok: boolean;
  try {
    ok = await verifyOwnerPassword(password);
  } catch {
    // Don't leak which env var is missing over HTTP.
    console.error("[auth] login failed: auth is not configured (AUTH_SECRET/OWNER_PASSWORD)");
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!ok) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
