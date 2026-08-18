/**
 * Single-owner password gate. No user accounts, no roles — this app has one
 * operator. Uses Web Crypto (not node:crypto) so the same code runs in both
 * the Edge middleware and Node API routes without a runtime-specific branch.
 */

export const SESSION_COOKIE = "operatoros_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return bufferToHex(digest);
}

/**
 * Constant-time string comparison. Both inputs are SHA-256'd first so the
 * comparison always runs over equal-length (64-hex-char) digests — this
 * removes the length-based early return that would otherwise leak, via
 * timing, whether a guess had the correct length.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ah, bh] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  return diff === 0;
}

export async function verifyOwnerPassword(password: string): Promise<boolean> {
  return timingSafeEqual(password, getOwnerPassword());
}

/**
 * Session tokens bind to the current password (via a hash of it mixed into
 * the signature), so rotating OWNER_PASSWORD invalidates every existing
 * session — the intuitive "change the password to lock everyone out" works.
 */
async function passwordFingerprint(): Promise<string> {
  return sha256Hex(getOwnerPassword());
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const fp = await passwordFingerprint();
  const signature = await hmacHex(getAuthSecret(), `${expiresAt}.${fp}`);
  return `${expiresAt}.${signature}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAtStr, signature] = token.split(".");
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  try {
    const fp = await passwordFingerprint();
    const expected = await hmacHex(getAuthSecret(), `${expiresAtStr}.${fp}`);
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}
