"use client";

import dynamic from "next/dynamic";
import { Shutter } from "@/components/shell/Shutter";
import { useAuthStore } from "@/lib/auth-store";
import { useOnboardingGate } from "@/lib/queries/onboarding";

// Everything behind the Shutter (Onboarding's whole wizard including the
// CSV/XLSX importer, and the full Shop Floor with all seven rooms) is
// irrelevant to an unauthenticated first paint — split it out of the
// initial bundle rather than shipping it before sign-in. Spec G: bundle
// budget < 250KB gzipped for the initial route; see docs/DECISIONS.md.
const Onboarding = dynamic(
  () => import("@/components/onboarding/Onboarding").then((m) => m.Onboarding),
  { ssr: false },
);
const ShopFloor = dynamic(
  () => import("@/components/shell/ShopFloor").then((m) => m.ShopFloor),
  { ssr: false },
);

export default function Home() {
  const signedIn = useAuthStore((s) => s.signedIn);
  // Setup-vs-shop-floor is decided against the server, not against whatever
  // this browser remembers -- see useOnboardingGate for the lockout that
  // trusting the browser alone produced.
  const { decided, fittedOut } = useOnboardingGate();

  return (
    <>
      {signedIn ? (
        !decided ? (
          <p className="p-32 text-body text-ink-soft">Loading…</p>
        ) : fittedOut ? (
          <ShopFloor />
        ) : (
          <Onboarding />
        )
      ) : null}
      <Shutter />
    </>
  );
}
