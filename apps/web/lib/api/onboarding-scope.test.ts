import { beforeEach, describe, expect, it } from "vitest";

// The scoping only applies where there is a business slug to scope by, which
// is the real-backend branch. See default-location.test.ts for why this has
// to precede the import.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test";

const { getOnboardingState, saveOnboardingState, EMPTY_ONBOARDING_STATE } = await import("./onboarding");
const { useAuthStore } = await import("../auth-store");

const LEGACY_KEY = "operatoros.onboarding.v1";

function signInAs(slug: string) {
  useAuthStore.setState({ signedIn: true, businessSlug: slug, rememberedSlug: slug });
}

const FINISHED = { ...EMPTY_ONBOARDING_STATE, step: 6 as const, completed: true };

describe("onboarding state is per business, not per browser", () => {
  beforeEach(() => window.localStorage.clear());

  // The mirror image of the lockout: one flat key meant signing into a
  // brand-new business on a device that had already set one up inherited the
  // finished wizard and skipped setup entirely -- no products, no staff, no
  // opening balances, straight to a shop floor with nothing in it.
  it("does not hand a new business the previous one's finished setup", async () => {
    signInAs("kagarama-hardware");
    await saveOnboardingState(FINISHED);

    signInAs("brand-new-shop");
    expect((await getOnboardingState()).completed).toBe(false);
  });

  it("keeps each business's progress separate", async () => {
    signInAs("shop-a");
    await saveOnboardingState({ ...EMPTY_ONBOARDING_STATE, step: 4 });

    signInAs("shop-b");
    await saveOnboardingState({ ...EMPTY_ONBOARDING_STATE, step: 2 });

    signInAs("shop-a");
    expect((await getOnboardingState()).step).toBe(4);
  });

  it("migrates a pre-scoping wizard to the first business that asks for it", async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(FINISHED));

    signInAs("kagarama-hardware");
    expect((await getOnboardingState()).completed).toBe(true);
    // Retired, so the next business doesn't inherit it too.
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe(null);

    signInAs("brand-new-shop");
    expect((await getOnboardingState()).completed).toBe(false);
  });
});
