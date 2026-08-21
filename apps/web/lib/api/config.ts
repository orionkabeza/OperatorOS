/**
 * The one switch between the mock service layer (lib/mock/) and a real
 * apps/api call. Every function in lib/api/*.ts branches on this constant
 * and nothing else — swapping to the real backend later means implementing
 * the `else` branch of each function (already stubbed with `apiRequest`
 * calls below) and flipping this, not touching any component or React
 * Query hook. See docs/DECISIONS.md for why this shape was chosen over MSW.
 */
export const USE_MOCK_API = !process.env.NEXT_PUBLIC_API_BASE_URL;

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The mock seed's only location (lib/mock/seed.ts's `LOCATION_ID`). Valid
 * ONLY in mock mode — a real business's locations have server-generated
 * UUIDs and no row with this id exists. Use `getDefaultLocationId()`, which
 * picks the right one for the current mode; this is exported for the mock
 * layer and tests, not for building real requests.
 */
export const DEFAULT_LOCATION_ID = "loc-nyabugogo";

let defaultLocationIdCache: string | null = null;

/**
 * The `location_id` every real day/till/sales/stock/cashbox/expense call
 * requires. The frontend still has no location-switcher UI, so "default"
 * means the first location assigned to the signed-in user.
 *
 * This used to be the `DEFAULT_LOCATION_ID` constant at every real call
 * site, which meant production sent the *mock* location id to the real API
 * — no such row exists, so `POST /api/v1/day/open` died on
 * `day_sessions_location_id_fkey` and came back 500. Opening the shop was
 * impossible, and with it everything gated behind an open day. Resolved
 * from `GET /api/v1/users/me`'s `location_ids` instead, cached per session
 * because it cannot change without signing in as someone else.
 */
export async function getDefaultLocationId(): Promise<string> {
  if (USE_MOCK_API) return DEFAULT_LOCATION_ID;
  if (defaultLocationIdCache) return defaultLocationIdCache;
  const me = await apiRequest<{ location_ids?: string[] }>("GET", "/api/v1/users/me");
  const locationId = me.location_ids?.[0];
  if (!locationId) {
    // Honest failure rather than falling back to a constant that is
    // guaranteed to violate a foreign key further down.
    throw new ApiError(
      "This account isn't assigned to a shop location yet. An owner needs to assign one before you can open the shop.",
      409,
    );
  }
  defaultLocationIdCache = locationId;
  return locationId;
}

/** Must run on sign-out/sign-in — a cached location from a previous session
 *  belongs to a different business and would leak across tenants. */
export function resetDefaultLocationId(): void {
  defaultLocationIdCache = null;
}

/**
 * For a frontend capability with genuinely no backend counterpart (verified
 * against apps/api/openapi.json, not guessed) — used by the real-API branch
 * of a handful of lib/api/*.ts functions instead of either (a) calling an
 * endpoint that doesn't exist, or (b) silently pretending success. Throwing
 * a clear, typed error is the honest outcome for a genuine gap: see each
 * call site's comment and docs/DECISIONS.md's "known gaps" entries for why
 * that specific capability has no real-API path yet.
 */
export function notSupportedByBackend(feature: string): never {
  throw new ApiError(
    `${feature} isn't implemented against the real backend yet — see docs/DECISIONS.md's known-gaps entries.`,
    501,
  );
}

/**
 * The real HTTP path. Not exercised in Phase 1 (no live apps/api yet — see
 * task brief), but written for real so the swap-over is "delete the mock
 * branch," not "write the real one from scratch."
 */
export async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options?: { body?: unknown; query?: Record<string, string | undefined>; idempotencyKey?: string },
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: "include",
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(text || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
