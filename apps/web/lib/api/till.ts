import type { MinorUnits } from "@operatoros/shared";
import { apiRequest, DEFAULT_LOCATION_ID, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { schemas } from "./generated/client";
import type { z } from "zod";
import type { CloseTillInput, OpenTillInput, TillSession } from "./types";

function mapTillSessionOut(t: z.infer<typeof schemas.TillSessionOut>): TillSession {
  return {
    id: t.id,
    daySessionId: t.day_session_id,
    cashierId: t.cashier_user_id,
    cashierName: "", // TillSessionOut carries no display name, only the user id
    status: t.status as TillSession["status"],
    openedAt: t.opened_at,
    openingFloatMinor: t.opening_float_minor as MinorUnits,
    closedAt: t.closed_at,
    expectedMinor: t.closing_expected_amount_minor as MinorUnits | null,
    countedMinor: t.closing_counted_amount_minor as MinorUnits | null,
    varianceMinor: t.closing_variance_minor as MinorUnits | null,
    // TillSessionOut has no variance-reason fields at all (unlike
    // DaySessionOut's request bodies, till close doesn't accept one) —
    // genuinely absent, not dropped by this mapping.
    reason: null,
    reasonNote: null,
  };
}

/**
 * There is no `GET .../till/open-session` (or any single-till-session
 * lookup) endpoint at all — confirmed against till.py's full route list
 * (`POST /open`, `POST /{id}/close` only). This can only report what THIS
 * browser session cached from a prior `openTillSession()` call in the same
 * session (see the module-level `currentTillSession` below); a fresh page
 * load with no such call yet has no way to ask the backend "is a till open
 * right now?" and conservatively reports `null` (no open session) rather
 * than guessing. See docs/DECISIONS.md.
 */
let currentTillSession: TillSession | null = null;

export async function getOpenTillSession(): Promise<TillSession | null> {
  if (USE_MOCK_API) return mockDelay(store.getOpenTillSession());
  return currentTillSession;
}

export async function openTillSession(input: OpenTillInput): Promise<TillSession> {
  if (USE_MOCK_API) return mockDelay(store.openTill(input));
  const raw = await apiRequest<unknown>("POST", "/api/v1/till/open", {
    body: { location_id: DEFAULT_LOCATION_ID, opening_float_minor: input.openingFloatMinor },
    idempotencyKey: newIdempotencyKey(),
  });
  const session = mapTillSessionOut(schemas.TillSessionOut.parse(raw));
  currentTillSession = session;
  return session;
}

/** Real path is `POST /api/v1/till/{till_session_id}/close` — the id comes from the session cached by `openTillSession`/`getOpenTillSession` above (there's no other way to recover it), not from `CloseTillInput` (which never carried one). */
export async function closeTillSession(input: CloseTillInput): Promise<TillSession> {
  if (USE_MOCK_API) return mockDelay(store.closeTill(input));
  if (!currentTillSession) {
    return notSupportedByBackend(
      "Closing a till session whose id isn't known in this browser session (no GET .../till/open-session exists to recover it after a reload)",
    );
  }
  const raw = await apiRequest<unknown>("POST", `/api/v1/till/${currentTillSession.id}/close`, {
    body: { counted_amount_minor: input.countedMinor },
    idempotencyKey: newIdempotencyKey(),
  });
  const session = mapTillSessionOut(schemas.TillSessionOut.parse(raw));
  currentTillSession = null;
  return session;
}
