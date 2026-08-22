import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// See default-location.test.ts -- USE_MOCK_API is a module-scope const.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { getIdentity, initialsOf } = await import("./identity");
const { resetDefaultLocationId, USE_MOCK_API } = await import("./config");
const { BUSINESS_NAME, LOCATION_NAME } = await import("../mock/seed");

const LOCATION_A = "01a0258e-0a9a-7f6e-9c34-9228358dde73";
const LOCATION_B = "01a0258e-0a9a-7f6e-9c34-000000000002";

const ME = {
  id: "01a0258e-1111-7f6e-9c34-000000000009",
  business_id: "01a0258e-2222-7f6e-9c34-000000000009",
  business_name: "Kagarama Hardware",
  display_name: "Orion Kabeza",
  role_key: "owner",
  location_ids: [LOCATION_A, LOCATION_B],
  locations: [
    { id: LOCATION_A, name: "Kagarama main" },
    { id: LOCATION_B, name: "Remera depot" },
  ],
};

function backendReturning(me: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => me,
    text: async () => JSON.stringify(me),
  }));
}

describe("getIdentity against a real backend", () => {
  beforeEach(() => resetDefaultLocationId());
  afterEach(() => vi.unstubAllGlobals());

  it("is actually exercising the real-backend branch", () => {
    expect(USE_MOCK_API).toBe(false);
  });

  // The regression: TopNav had no source for any of this and shipped the
  // fixture's values as literals, so every real tenant in production saw
  // "Kigali Hardware Supplies" and "Nyabugogo branch" above their own till.
  it("names the signed-in tenant, not the demo fixture", async () => {
    vi.stubGlobal("fetch", backendReturning(ME));
    const identity = await getIdentity();

    expect(identity.businessName).toBe("Kagarama Hardware");
    expect(identity.businessName).not.toBe(BUSINESS_NAME);
    expect(identity.locationName).not.toBe(LOCATION_NAME);
  });

  it("names the branch the user is actually working at", async () => {
    vi.stubGlobal("fetch", backendReturning(ME));
    const identity = await getIdentity();

    // getDefaultLocationId resolves location_ids[0].
    expect(identity.locationId).toBe(LOCATION_A);
    expect(identity.locationName).toBe("Kagarama main");
  });

  it("derives avatar initials from the real display name", async () => {
    vi.stubGlobal("fetch", backendReturning(ME));
    expect((await getIdentity()).initials).toBe("OK");
  });

  // Inventing a readable branch name for an id with no row behind it would
  // repeat the exact mistake this module exists to end.
  it("does not invent a branch name when there is none", async () => {
    vi.stubGlobal("fetch", backendReturning({ ...ME, locations: [] }));
    expect((await getIdentity()).locationName).toBe("—");
  });
});

describe("initialsOf", () => {
  it("takes first and last for a full name", () => expect(initialsOf("Orion Kabeza")).toBe("OK"));
  it("takes first and last across middle names", () =>
    expect(initialsOf("Aline Marie Mukamana")).toBe("AM"));
  it("handles a single name", () => expect(initialsOf("Eric")).toBe("E"));
  it("handles ragged whitespace", () => expect(initialsOf("  eric   mugisha ")).toBe("EM"));
  it("never renders empty", () => expect(initialsOf("   ")).toBe("?"));
});
