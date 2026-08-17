/**
 * Single-owner password gate. No user accounts, no roles — this app has one
 * operator. Uses Web Crypto (not node:crypto) so the same code runs in both
 * the Edge middleware and Node API routes without a runtime-specific branch.
 */

export const SESSION_COOKIE = "operatoros_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and fill it in.");
  }
  return secret;
}

function getOwnerPassword(): string {
  const password = process.env.OWNER_PASSWORD;
  if (!password) {
    throw new Error("OWNER_PASSWORD is not set. Copy .env.example to .env and fill it in.");
  }
  return password;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bufferToHex(signature);
}

/** Manual constant-time comparison — Web Crypto has no timingSafeEqual. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyOwnerPassword(password: string): boolean {
  return timingSafeEqual(password, getOwnerPassword());
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmacHex(getAuthSecret(), String(expiresAt));
  return `${expiresAt}.${signature}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAtStr, signature] = token.split(".");
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  try {
    const expected = await hmacHex(getAuthSecret(), expiresAtStr);
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}
