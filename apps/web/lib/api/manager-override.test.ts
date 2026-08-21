import { describe, expect, it } from "vitest";
import { verifyManagerOverridePin } from "./manager-override";
import { DEMO_MANAGER_PIN } from "../mock/seed";

// USE_MOCK_API is derived from NEXT_PUBLIC_API_BASE_URL at module scope and
// is unset under vitest, so this file exercises the mock branch. The real
// branch is covered in manager-override-real-mode.test.ts, which sets the
// env var before importing.
describe("verifyManagerOverridePin (mock mode)", () => {
  it("approves the demo PIN", () => {
    expect(verifyManagerOverridePin(DEMO_MANAGER_PIN)).toEqual({ approved: true });
  });

  it("rejects anything else with a readable message", () => {
    const outcome = verifyManagerOverridePin("0000");
    expect(outcome.approved).toBe(false);
    if (!outcome.approved) expect(outcome.message).toBe("Wrong PIN.");
  });
});
