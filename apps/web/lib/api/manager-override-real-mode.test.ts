import { describe, expect, it } from "vitest";

// Must be set before config.ts is first evaluated -- USE_MOCK_API is a
// module-scope const derived from it.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { verifyManagerOverridePin } = await import("./manager-override");
const { DEMO_MANAGER_PIN } = await import("../mock/seed");

describe("verifyManagerOverridePin against a real backend", () => {
  // The regression: components compared the typed PIN to DEMO_MANAGER_PIN
  // themselves, so "9999" showed approval and the sale then came back 422 --
  // apps/api requires a manager user id alongside the PIN, and sales.ts
  // always sends null. A local yes the server turns into a no is worse than
  // an honest no.
  it("never approves the demo PIN", () => {
    const outcome = verifyManagerOverridePin(DEMO_MANAGER_PIN);
    expect(outcome.approved).toBe(false);
  });

  it("explains why instead of just saying the PIN was wrong", () => {
    const outcome = verifyManagerOverridePin(DEMO_MANAGER_PIN);
    if (outcome.approved) throw new Error("expected refusal");
    expect(outcome.message).not.toBe("Wrong PIN.");
    expect(outcome.message).toMatch(/isn't available yet/i);
  });

  it("refuses any other PIN too", () => {
    expect(verifyManagerOverridePin("1234").approved).toBe(false);
  });
});
