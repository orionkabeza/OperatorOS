import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Restoring only means anything against a real backend -- mock mode has no
// cookies. See default-location.test.ts for why this precedes the import.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { useAuthStore } = await import("./auth-store");

function fetchReturning(status: number) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }));
}

const HINT = "operatoros_session_hint";

describe("restoring a session after a page refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Set by a successful sign-in. Without it there is nothing to restore.
    window.localStorage.setItem(HINT, "1");
    useAuthStore.setState({ signedIn: false, sessionChecked: false, rememberedSlug: "" });
  });
  afterEach(() => vi.unstubAllGlobals());

  // The regression: signedIn is in-memory only, so every refresh sent a
  // shopkeeper back to the Shutter mid-day with valid cookies still in the
  // jar -- phone, PIN and a TOTP code to get back to where they were.
  it("signs the user back in when the server still honours the cookies", async () => {
    vi.stubGlobal("fetch", fetchReturning(200));
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().signedIn).toBe(true);
    expect(useAuthStore.getState().sessionChecked).toBe(true);
  });

  it("stays signed out on a 401 -- the cookies are gone or expired", async () => {
    vi.stubGlobal("fetch", fetchReturning(401));
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().signedIn).toBe(false);
    expect(useAuthStore.getState().sessionChecked).toBe(true);
    // And stops asking, so an expired session doesn't 401 on every load.
    expect(window.localStorage.getItem(HINT)).toBe(null);
  });

  // A first-time visitor has no session to restore, and the request would be
  // a guaranteed 401 that the browser logs as a console error on the login
  // page of every single first visit.
  it("does not ask at all when nobody has ever signed in here", async () => {
    window.localStorage.removeItem(HINT);
    const fetchMock = fetchReturning(200);
    vi.stubGlobal("fetch", fetchMock);
    await useAuthStore.getState().restoreSession();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().signedIn).toBe(false);
    expect(useAuthStore.getState().sessionChecked).toBe(true);
  });

  // Losing the marker on a blip would sign the shopkeeper out for good.
  it("keeps the marker when the request throws, so the next load retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await useAuthStore.getState().restoreSession();

    expect(window.localStorage.getItem(HINT)).toBe("1");
  });

  // Fails closed: an unreachable server must never be read as "signed in".
  it("stays signed out when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().signedIn).toBe(false);
    expect(useAuthStore.getState().sessionChecked).toBe(true);
  });

  it("asks once, not on every render", async () => {
    const fetchMock = fetchReturning(200);
    vi.stubGlobal("fetch", fetchMock);
    await useAuthStore.getState().restoreSession();
    await useAuthStore.getState().restoreSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restores the remembered tenant so per-business storage stays scoped", async () => {
    window.localStorage.setItem("operatoros_last_business_slug", "demo-c6ed09");
    vi.stubGlobal("fetch", fetchReturning(200));
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().rememberedSlug).toBe("demo-c6ed09");
  });
});
