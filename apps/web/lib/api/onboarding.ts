import { USE_MOCK_API } from "./config";
import { currentBusinessSlug } from "../auth-store";
import { mockDelay } from "../mock/store";
import type { OnboardingState } from "./types";

/**
 * Scoped per business. This used to be one flat key shared by every tenant
 * signed into the device, which broke in both directions: signing into a
 * brand-new business inherited the previous one's finished wizard and
 * skipped setup entirely, and clearing it for one business restarted setup
 * for all of them. Mock mode has no business slug (single tenant, no field
 * on the Shutter) and keeps the unscoped key.
 */
const STORAGE_PREFIX = "operatoros.onboarding.v1";

function storageKey(): string {
  const slug = currentBusinessSlug();
  return slug ? `${STORAGE_PREFIX}.${slug}` : STORAGE_PREFIX;
}

/**
 * Spec D.2: "Onboarding state is stored server-side so it resumes on any
 * device." There is NO `/api/v1/onboarding` (or any onboarding-shaped)
 * route anywhere in apps/api — confirmed against the full 95-route
 * openapi.json surface, not just this file's old guess. This is a real,
 * disclosed Phase 0 gap that predates Phase 2, not something this pass
 * introduces. Since blocking the app's entire first-run flow behind a
 * real-API build that can never complete onboarding would be strictly
 * worse than same-browser persistence, the real-API branch below falls
 * back to the SAME localStorage mechanism the mock uses, rather than
 * throwing — clearly commented as a stand-in, not a real cross-device
 * implementation. See docs/DECISIONS.md.
 */
function readLocal(): OnboardingState | null {
  if (typeof window === "undefined") return null;
  const key = storageKey();
  let raw = window.localStorage.getItem(key);
  if (raw === null && key !== STORAGE_PREFIX) {
    // One-time migration off the pre-scoping key: the first business to ask
    // for it adopts it, then the shared key is retired so the next business
    // starts its own setup instead of inheriting this one's.
    raw = window.localStorage.getItem(STORAGE_PREFIX);
    if (raw !== null) {
      window.localStorage.setItem(key, raw);
      window.localStorage.removeItem(STORAGE_PREFIX);
    }
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return null;
  }
}

function writeLocal(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(), JSON.stringify(state));
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  step: 1,
  business: {},
  paymentMethods: {},
  stockPath: null,
  productsAdded: 0,
  staff: [],
  openingBalances: {},
  completed: false,
};

export async function getOnboardingState(): Promise<OnboardingState> {
  if (USE_MOCK_API) return mockDelay(readLocal() ?? EMPTY_ONBOARDING_STATE, 60);
  // No real endpoint exists (see top-of-file comment) — same localStorage
  // fallback as the mock branch, not a network call to a route that
  // doesn't exist.
  return readLocal() ?? EMPTY_ONBOARDING_STATE;
}

export async function saveOnboardingState(state: OnboardingState): Promise<OnboardingState> {
  if (USE_MOCK_API) {
    writeLocal(state);
    return mockDelay(state, 60);
  }
  writeLocal(state);
  return state;
}

export function resetOnboardingLocal() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey());
}
