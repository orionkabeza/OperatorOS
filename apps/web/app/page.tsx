"use client";

import dynamic from "next/dynamic";
import { ToastViewport } from "@/components/design/Toast";
import { Shutter } from "@/components/shell/Shutter";
import { useAuthStore } from "@/lib/auth-store";
import { useOnboardingState } from "@/lib/queries/onboarding";

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
  const { data: onboarding } = useOnboardingState();

  return (
    <>
      {signedIn ? (
        onboarding && !onboarding.completed ? (
          <Onboarding onFinish={() => undefined} />
        ) : (
          <ShopFloor />
        )
      ) : null}
      <Shutter />
      <ToastViewport />
    </>
  );
}
