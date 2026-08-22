import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minorUnits } from "@operatoros/shared";

// See default-location.test.ts -- USE_MOCK_API is a module-scope const, so
// the env var has to be set before the module is first evaluated.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { openDay } = await import("./day");
const { resetDefaultLocationId, USE_MOCK_API } = await import("./config");

const LOCATION = "01a0258e-0a9a-7f6e-9c34-9228358dde73";

const OPEN_SESSION = {
  id: "01a0258e-1111-7f6e-9c34-000000000001",
  business_date: "2026-08-22",
  location_id: LOCATION,
  status: "open",
  opened_at: "2026-08-22T06:12:00Z",
  closed_at: null,
  opening_counted_amount_minor: 8_700_000,
  opening_expected_amount_minor: 0,
  opening_variance_minor: 8_700_000,
  closing_counted_amount_minor: null,
  closing_expected_amount_minor: null,
  closing_variance_minor: null,
  transaction_count: 0,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Routes by URL so one mock can serve /users/me, /day/open and /day/status. */
function backend(handlers: { open: () => unknown; status?: () => unknown }) {
  return vi.fn(async (url: string) => {
    if (url.includes("/users/me")) return jsonResponse(200, { location_ids: [LOCATION] });
    if (url.includes("/day/open")) return handlers.open();
    if (url.includes("/day/status")) return (handlers.status ?? (() => jsonResponse(200, null)))();
    throw new Error(`unexpected request to ${url}`);
  });
}

describe("openDay when the shop is already open", () => {
  beforeEach(() => resetDefaultLocationId());
  afterEach(() => vi.unstubAllGlobals());

  it("is actually exercising the real-backend branch", () => {
    expect(USE_MOCK_API).toBe(false);
  });

  // The regression: a 409 here was a dead end. Nothing in the app can clear
  // an open day except closing it, so a shopkeeper who hit this -- second
  // tab, second device, double-submit -- got an error they could not act on
  // and no way forward.
  it("adopts the session the server already has instead of failing", async () => {
    vi.stubGlobal(
      "fetch",
      backend({
        open: () => jsonResponse(409, { detail: "The shop is already open at this location." }),
        status: () => jsonResponse(200, OPEN_SESSION),
      }),
    );

    const session = await openDay({ countedMinor: minorUnits(8_700_000) });
    expect(session.status).toBe("open");
    expect(session.id).toBe(OPEN_SESSION.id);
  });

  // The endpoint's other 409 -- an Idempotency-Key reused for a different
  // body -- has no open day to adopt, and swallowing it would hide a real
  // client bug behind a success.
  it("still raises a 409 that has no open day behind it", async () => {
    vi.stubGlobal(
      "fetch",
      backend({
        open: () =>
          jsonResponse(409, { detail: "This Idempotency-Key was already used for a different request." }),
        status: () => jsonResponse(200, null),
      }),
    );

    await expect(openDay({ countedMinor: minorUnits(8_700_000) })).rejects.toThrow(/Idempotency-Key/);
  });

  it("does not swallow other failures", async () => {
    vi.stubGlobal(
      "fetch",
      backend({ open: () => jsonResponse(422, { detail: "The till doesn't match yesterday's close." }) }),
    );

    await expect(openDay({ countedMinor: minorUnits(8_700_000) })).rejects.toThrow(/till doesn't match/);
  });
});
