import { create } from "zustand";
import { API_BASE_URL, resetDefaultLocationId, USE_MOCK_API } from "@/lib/api/config";

/**
 * Real auth, replacing the deleted lib/demo-auth-store.ts (D.1, plan
 * §0.4) -- backed by app/session/*\/route.ts, which hold the actual
 * tokens as httpOnly cookies this store never sees. Same shape the demo
 * store had (signedIn/shutterState/attemptsRemaining/lockedUntil/
 * signIn/submitTwoFactor/signOut) so Shutter/TopNav/page.tsx needed
 * minimal rewiring, not a rewrite -- see docs/DECISIONS.md.
 *
 * Branches on USE_MOCK_API the same way every lib/api/*.ts function
 * does -- the mock branch keeps the exact fixed phone/PIN/code and
 * always-2FA behavior e2e/helpers.ts's signIn() already exercises, so
 * the e2e suite runs against no real backend, unchanged.
 */

export type ShutterState = "idle" | "submitting" | "wrong-credentials" | "locked-out" | "two-factor";

const BUSINESS_SLUG_KEY = "operatoros_last_business_slug";
const MOCK_PHONE = "788402219";
const MOCK_PIN = "142857";
const MOCK_CODE = "000000";

function readLastBusinessSlug(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(BUSINESS_SLUG_KEY) ?? "";
}

function rememberBusinessSlug(slug: string): void {
  if (typeof window !== "undefined" && slug) window.localStorage.setItem(BUSINESS_SLUG_KEY, slug);
}

/**
 * Which business anything stored in this browser belongs to. Returns "" in
 * mock mode, where the Shutter has no business field at all and there is
 * only ever one tenant -- callers scope by slug when there is one and fall
 * back to an unscoped key when there isn't.
 */
export function currentBusinessSlug(): string {
  const { businessSlug, rememberedSlug } = useAuthStore.getState();
  return businessSlug || rememberedSlug || readLastBusinessSlug();
}

interface AuthState {
  signedIn: boolean;
  shutterState: ShutterState;
  attemptsRemaining: number;
  lockedUntil: number | null;
  /** What will actually be submitted -- freely editable by the user. */
  businessSlug: string;
  /**
   * The last *confirmed* slug (restored from localStorage, or set after a
   * successful sign-in). Display-only. Deliberately separate from
   * `businessSlug`: anything driven off the live editable value re-renders
   * on every keystroke, which is how the backdrop once ended up showing a
   * single letter as the business name.
   */
  rememberedSlug: string;
  setBusinessSlug: (slug: string) => void;
  /**
   * Must run in an effect, never at module scope: this store is created
   * during SSR too, where `readLastBusinessSlug()` can only return "".
   * Seeding the initial state from localStorage therefore makes the
   * server's HTML and the client's first render disagree for any returning
   * user -- a hydration mismatch. Reading it after mount instead means both
   * passes start from "" and agree.
   */
  hydrateBusinessSlug: () => void;
  /**
   * False until we've asked the server whether the httpOnly session cookies
   * from a previous page load are still valid. The Shutter waits for it
   * rather than flashing a login form at someone who is already signed in.
   */
  sessionChecked: boolean;
  /**
   * `signedIn` lives in memory only, so every refresh dropped a working
   * session on the floor and sent the shopkeeper back to the Shutter --
   * mid-day, with valid cookies still in the jar. The tokens are httpOnly
   * and unreadable from JS, so the only way to know is to ask: any
   * authenticated endpoint that answers 200 proves the session is live.
   *
   * Fails closed. A 401, a network error, or mock mode all leave
   * `signedIn` false, which is exactly today's behaviour -- this can only
   * ever restore a session the server itself vouches for.
   */
  restoreSession: () => Promise<void>;
  signIn: (phone: string, pin: string, deviceId: string, remember: boolean) => Promise<void>;
  submitTwoFactor: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reset: () => void;
}

let pendingChallengeToken: string | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  signedIn: false,
  shutterState: "idle",
  attemptsRemaining: 3,
  lockedUntil: null,
  businessSlug: "",
  rememberedSlug: "",
  setBusinessSlug: (slug) => set({ businessSlug: slug }),
  hydrateBusinessSlug: () => {
    const remembered = readLastBusinessSlug();
    if (!remembered) return;
    // Prefill only -- never overwrite something the user has already typed
    // (the effect can run after they've started filling the form in).
    set((s) => ({ rememberedSlug: remembered, businessSlug: s.businessSlug || remembered }));
  },

  // Mock mode has no cookies to restore, so there is nothing to wait for.
  sessionChecked: USE_MOCK_API,
  restoreSession: async () => {
    if (USE_MOCK_API || get().sessionChecked) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/me`, { credentials: "include" });
      if (res.ok) set({ signedIn: true, shutterState: "idle", rememberedSlug: readLastBusinessSlug() });
    } catch {
      // Offline or unreachable -- the Shutter is the honest answer.
    }
    set({ sessionChecked: true });
  },

  signIn: async (phone, pin, deviceId, remember) => {
    const { lockedUntil, businessSlug } = get();
    if (lockedUntil && Date.now() < lockedUntil) {
      set({ shutterState: "locked-out" });
      return;
    }
    // Any location cached for a previous session belongs to a different
    // business -- clear before the new session can read it.
    resetDefaultLocationId();
    set({ shutterState: "submitting" });

    if (USE_MOCK_API) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const normalizedPhone = phone.replace(/\D/g, "").slice(-9);
      if (normalizedPhone === MOCK_PHONE && pin === MOCK_PIN) {
        set({ shutterState: "two-factor" });
        return;
      }
      const remaining = get().attemptsRemaining - 1;
      if (remaining <= 0) {
        set({ shutterState: "locked-out", lockedUntil: Date.now() + 15 * 60_000, attemptsRemaining: 0 });
      } else {
        set({ shutterState: "wrong-credentials", attemptsRemaining: remaining });
      }
      return;
    }

    try {
      const res = await fetch("/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessSlug, phone, pin, deviceId, remember }),
      });

      if (res.status === 423) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? 900);
        set({ shutterState: "locked-out", lockedUntil: Date.now() + retryAfter * 1000 });
        return;
      }
      if (!res.ok) {
        const remainingHeader = res.headers.get("X-Remaining-Attempts");
        const remaining = remainingHeader !== null ? Number(remainingHeader) : get().attemptsRemaining - 1;
        if (remaining <= 0) {
          set({ shutterState: "locked-out", lockedUntil: Date.now() + 15 * 60_000, attemptsRemaining: 0 });
        } else {
          set({ shutterState: "wrong-credentials", attemptsRemaining: remaining });
        }
        return;
      }

      const body = await res.json();
      if (body.totpRequired) {
        pendingChallengeToken = body.challengeToken;
        set({ shutterState: "two-factor" });
        return;
      }

      rememberBusinessSlug(businessSlug);
      set({
        signedIn: true,
        shutterState: "idle",
        attemptsRemaining: 3,
        lockedUntil: null,
        rememberedSlug: businessSlug,
      });
    } catch {
      // Network failure -- honest as "try again", not a false
      // wrong-credentials verdict the user might act on (e.g. resetting
      // a PIN that was actually fine).
      set({ shutterState: "idle" });
    }
  },

  submitTwoFactor: async (code) => {
    if (USE_MOCK_API) {
      if (code === MOCK_CODE) {
        rememberBusinessSlug(get().businessSlug);
        set({ signedIn: true, shutterState: "idle", rememberedSlug: get().businessSlug });
      } else {
        set({ shutterState: "wrong-credentials" });
      }
      return;
    }

    if (!pendingChallengeToken) {
      set({ shutterState: "wrong-credentials" });
      return;
    }
    try {
      const res = await fetch("/session/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: pendingChallengeToken, code }),
      });
      if (!res.ok) {
        set({ shutterState: "wrong-credentials" });
        return;
      }
      pendingChallengeToken = null;
      rememberBusinessSlug(get().businessSlug);
      set({ signedIn: true, shutterState: "idle", rememberedSlug: get().businessSlug });
    } catch {
      set({ shutterState: "wrong-credentials" });
    }
  },

  signOut: async () => {
    if (!USE_MOCK_API) {
      await fetch("/session/logout", { method: "POST" }).catch(() => undefined);
    }
    pendingChallengeToken = null;
    resetDefaultLocationId();
    set({ signedIn: false, shutterState: "idle" });
  },

  reset: () => set({ shutterState: "idle", attemptsRemaining: 3, lockedUntil: null }),
}));
