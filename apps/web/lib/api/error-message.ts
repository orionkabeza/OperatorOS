import { ApiError } from "./config";

/**
 * Turns whatever a failed request threw into one sentence a shopkeeper can
 * act on.
 *
 * `apiRequest` throws `ApiError(rawResponseBody, status)`, and the raw body
 * from FastAPI is JSON — `{"detail": "..."}` for a deliberate rejection, or
 * `{"detail": [{loc, msg, ...}]}` for a validation failure. Showing that to
 * a user is barely better than showing nothing, which is what we did
 * before: every mutation failure in this app was silent, so a 500 and a
 * successful no-op looked identical on screen. Opening the shop was broken
 * in production for hours behind exactly that.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = extractDetail(error.message);

    switch (error.status) {
      case 401:
        return "Your session has expired. Sign in again to continue.";
      case 403:
        return detail ?? "You don't have permission to do that. Ask an owner.";
      case 404:
        return detail ?? "That item no longer exists — someone may have removed it.";
      case 409:
        return detail ?? "Someone else changed this while you were working. Reload and try again.";
      case 423:
        return detail ?? "Too many tries. This is locked for a while.";
      case 429:
        return "Too many requests just now. Wait a moment and try again.";
      case 501:
        // notSupportedByBackend -- a disclosed gap, phrased for a user
        // rather than leaking the internal note about docs/DECISIONS.md.
        return detail?.split("—")[0]?.trim() || "That isn't available in this version yet.";
      default:
        break;
    }

    if (error.status >= 500) {
      return "Something went wrong on our end. Nothing was saved — try again in a moment.";
    }
    return detail ?? "That didn't work. Check the details and try again.";
  }

  // fetch() rejects (rather than resolving with a status) only when the
  // request never completed -- offline, DNS, connection dropped.
  if (error instanceof TypeError) {
    return "Couldn't reach the server. Check your connection — nothing was saved.";
  }

  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Nothing was saved.";
}

function extractDetail(raw: string): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON -- a proxy error page or a plain string. Only pass it
    // through if it reads like a sentence, never raw HTML.
    return raw.trimStart().startsWith("<") ? null : raw;
  }

  if (typeof parsed === "string") return parsed;
  if (parsed && typeof parsed === "object" && "detail" in parsed) {
    const detail = (parsed as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors: [{ loc: [...], msg: "...", type: "..." }]
    if (Array.isArray(detail)) {
      const messages = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
        .filter((m): m is string => Boolean(m));
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return null;
}
