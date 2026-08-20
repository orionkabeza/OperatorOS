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
