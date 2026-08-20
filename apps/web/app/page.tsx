"use client";

import { ToastViewport } from "@/components/design/Toast";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { Shutter } from "@/components/shell/Shutter";
import { ShopFloor } from "@/components/shell/ShopFloor";
import { useDemoAuthStore } from "@/lib/demo-auth-store";
import { useOnboardingState } from "@/lib/queries/onboarding";

export default function Home() {
  const signedIn = useDemoAuthStore((s) => s.signedIn);
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
