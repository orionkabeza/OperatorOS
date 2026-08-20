import { create } from "zustand";

/**
 * DEMO ONLY — not real authentication. This exists purely so the Shutter's
 * states (D.1: idle/submitting/wrong-credentials/locked-out/2FA) and the
 * Shop Floor shell behind it are visible and testable before apps/api's
 * real auth (Argon2id, rotating refresh tokens, TOTP) exists and is wired
 * up. No cookie is set, nothing here is HttpOnly/Secure, and this module
 * must be deleted — not extended — once the real login endpoint lands.
 * See docs/plans/phase-0.md §0.4 and docs/DECISIONS.md.
 */

export type ShutterState = "idle" | "submitting" | "wrong-credentials" | "locked-out" | "two-factor";

const DEMO_PHONE = "788402219";
const DEMO_PIN = "142857";

interface DemoAuthState {
  signedIn: boolean;
  shutterState: ShutterState;
  attemptsRemaining: number;
  lockedUntil: number | null;
  signIn: (phone: string, pin: string) => void;
  submitTwoFactor: (code: string) => void;
  signOut: () => void;
  reset: () => void;
}

export const useDemoAuthStore = create<DemoAuthState>((set, get) => ({
  signedIn: false,
  shutterState: "idle",
  attemptsRemaining: 3,
  lockedUntil: null,
  signIn: (phone, pin) => {
    const { lockedUntil } = get();
    if (lockedUntil && Date.now() < lockedUntil) {
      set({ shutterState: "locked-out" });
      return;
    }
    set({ shutterState: "submitting" });
    window.setTimeout(() => {
      const normalizedPhone = phone.replace(/\D/g, "").slice(-9);
      if (normalizedPhone === DEMO_PHONE && pin === DEMO_PIN) {
        set({ shutterState: "two-factor" });
        return;
      }
      const remaining = get().attemptsRemaining - 1;
      if (remaining <= 0) {
        set({
          shutterState: "locked-out",
          lockedUntil: Date.now() + 15 * 60_000,
          attemptsRemaining: 0,
        });
      } else {
        set({ shutterState: "wrong-credentials", attemptsRemaining: remaining });
      }
    }, 500);
  },
  submitTwoFactor: (code) => {
    if (code === "000000") {
      set({ signedIn: true, shutterState: "idle" });
    } else {
      set({ shutterState: "wrong-credentials" });
    }
  },
  signOut: () => set({ signedIn: false, shutterState: "idle" }),
  reset: () => set({ shutterState: "idle", attemptsRemaining: 3, lockedUntil: null }),
}));
