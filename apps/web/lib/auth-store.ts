import { create } from "zustand";
import { resetDefaultLocationId, USE_MOCK_API } from "@/lib/api/config";

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
