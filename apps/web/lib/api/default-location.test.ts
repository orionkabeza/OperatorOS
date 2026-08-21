import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// USE_MOCK_API is a module-level const derived from this env var, and
// getDefaultLocationId reads config.ts's OWN binding -- vi.mock() only
// rebinds what *importers* see, so it cannot flip the branch from outside.
// Setting the variable before the module is first evaluated is what
// actually puts config.ts into real-backend mode.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { getDefaultLocationId, resetDefaultLocationId, DEFAULT_LOCATION_ID, USE_MOCK_API } =
  await import("./config");

const REAL_LOCATION = "01a0258e-0a9a-7f6e-9c34-9228358dde73";

function fetchReturning(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("getDefaultLocationId against a real backend", () => {
  beforeEach(() => resetDefaultLocationId());
  afterEach(() => vi.unstubAllGlobals());

  it("is actually exercising the real-backend branch", () => {
    expect(USE_MOCK_API).toBe(false);
  });

  // The regression: every real call site used the mock constant, so
  // production sent a location_id with no row behind it and the API died on
  // day_sessions_location_id_fkey -- a 500 the UI surfaced as nothing at all.
  it("resolves the signed-in user's location instead of the mock constant", async () => {
    vi.stubGlobal("fetch", fetchReturning({ location_ids: [REAL_LOCATION] }));
    const id = await getDefaultLocationId();
    expect(id).toBe(REAL_LOCATION);
    expect(id).not.toBe(DEFAULT_LOCATION_ID);
  });

  it("caches so every call site doesn't refetch /users/me", async () => {
    const fetchMock = fetchReturning({ location_ids: [REAL_LOCATION] });
    vi.stubGlobal("fetch", fetchMock);
    await getDefaultLocationId();
    await getDefaultLocationId();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after a reset, so a location can't leak across sessions", async () => {
    vi.stubGlobal("fetch", fetchReturning({ location_ids: [REAL_LOCATION] }));
    await getDefaultLocationId();

    resetDefaultLocationId();
    vi.stubGlobal("fetch", fetchReturning({ location_ids: ["other-business-location"] }));
    expect(await getDefaultLocationId()).toBe("other-business-location");
  });

  // Falling back to a constant here would just move the failure to a foreign
  // key violation several calls later, with nothing pointing at the cause.
  it("fails with a readable error when the account has no location", async () => {
    vi.stubGlobal("fetch", fetchReturning({ location_ids: [] }));
    await expect(getDefaultLocationId()).rejects.toThrow(/isn't assigned to a shop location/);
  });
});
