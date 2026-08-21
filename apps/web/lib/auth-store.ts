import { create } from "zustand";
import { USE_MOCK_API } from "@/lib/api/config";

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
  businessSlug: string;
  setBusinessSlug: (slug: string) => void;
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
  businessSlug: readLastBusinessSlug(),
  setBusinessSlug: (slug) => set({ businessSlug: slug }),

  signIn: async (phone, pin, deviceId, remember) => {
    const { lockedUntil, businessSlug } = get();
    if (lockedUntil && Date.now() < lockedUntil) {
      set({ shutterState: "locked-out" });
      return;
    }
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
      set({ signedIn: true, shutterState: "idle", attemptsRemaining: 3, lockedUntil: null });
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
        set({ signedIn: true, shutterState: "idle" });
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
      set({ signedIn: true, shutterState: "idle" });
    } catch {
      set({ shutterState: "wrong-credentials" });
    }
  },

  signOut: async () => {
    if (!USE_MOCK_API) {
      await fetch("/session/logout", { method: "POST" }).catch(() => undefined);
    }
    pendingChallengeToken = null;
    set({ signedIn: false, shutterState: "idle" });
  },

  reset: () => set({ shutterState: "idle", attemptsRemaining: 3, lockedUntil: null }),
}));
