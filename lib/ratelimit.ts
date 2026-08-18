/**
 * Minimal in-process fixed-window rate limiter for the login endpoint.
 *
 * This is per-process, so with two load-balanced servers an attacker gets up
 * to 2× the limit — still a decisive cut from the unbounded brute-force the
 * endpoint had before. A stricter, shared limit (HAProxy stick-table, or a
 * DB/Redis-backed counter) is the recommended follow-up if the threat model
 * warrants it; this covers the common case with zero infra dependencies.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow without bound under a
// distributed attack rotating source IPs.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP from HAProxy's X-Forwarded-For (leftmost = original client). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
