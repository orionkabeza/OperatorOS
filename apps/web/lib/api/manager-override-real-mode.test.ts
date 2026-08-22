import { describe, expect, it } from "vitest";

// Must be set before config.ts is first evaluated -- USE_MOCK_API is a
// module-scope const derived from it.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { verifyManagerOverridePin } = await import("./manager-override");
const { DEMO_MANAGER_PIN } = await import("../mock/seed");

describe("verifyManagerOverridePin against a real backend", () => {
  // The regression: components compared the typed PIN to DEMO_MANAGER_PIN
  // themselves, so "9999" showed approval and the sale then came back 422 --
  // apps/api verifies the PIN against a specific manager's stored hash, and
  // sales.ts sent manager_override_user_id: null.
  it("never approves on the demo PIN alone", () => {
    expect(verifyManagerOverridePin(DEMO_MANAGER_PIN).approved).toBe(false);
  });

  it("requires an approving manager to be named", () => {
    const outcome = verifyManagerOverridePin("1234");
    if (outcome.approved) throw new Error("expected refusal");
    expect(outcome.message).toMatch(/which manager/i);
  });

  it("requires a PIN once a manager is chosen", () => {
    const outcome = verifyManagerOverridePin("   ", "user-manager-1");
    if (outcome.approved) throw new Error("expected refusal");
    expect(outcome.message).toMatch(/PIN/i);
  });

  // The PIN is deliberately NOT checked here: the hash lives in the
  // database and the check is rate-limited server-side. The client's job is
  // to carry both halves so _verify_manager_override can do its work; a
  // wrong PIN surfaces as the sale request's own error.
  it("passes the manager id through once both halves are present", () => {
    const outcome = verifyManagerOverridePin("4321", "user-manager-1");
    if (!outcome.approved) throw new Error("expected approval to proceed");
    expect(outcome.managerUserId).toBe("user-manager-1");
  });
});
