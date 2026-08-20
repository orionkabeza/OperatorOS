import { apiRequest, USE_MOCK_API } from "./config";
import { mockDelay } from "../mock/store";
import type { OnboardingState } from "./types";

const STORAGE_KEY = "operatoros.onboarding.v1";

/**
 * Spec D.2: "Onboarding state is stored server-side so it resumes on any
 * device." The mock stands that in with localStorage — genuinely persists
 * across a reload in this browser (closer to the real behaviour than an
 * in-memory-only store would be), clearly not the real cross-device story.
 * Swap point for the real backend: replace both functions' mock branch with
 * a GET/PUT against a real `/api/v1/onboarding` resource.
 */
function readLocal(): OnboardingState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return null;
  }
}

function writeLocal(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  return apiRequest<OnboardingState>("GET", "/api/v1/onboarding");
}

export async function saveOnboardingState(state: OnboardingState): Promise<OnboardingState> {
  if (USE_MOCK_API) {
    writeLocal(state);
    return mockDelay(state, 60);
  }
  return apiRequest<OnboardingState>("PUT", "/api/v1/onboarding", { body: state });
}

export function resetOnboardingLocal() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
