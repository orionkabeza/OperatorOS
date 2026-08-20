"use client";

import { ToastViewport } from "@/components/design/Toast";
import { Shutter } from "@/components/shell/Shutter";
import { ShopFloor } from "@/components/shell/ShopFloor";
import { useDemoAuthStore } from "@/lib/demo-auth-store";

export default function Home() {
  const signedIn = useDemoAuthStore((s) => s.signedIn);

  return (
    <>
      {signedIn ? <ShopFloor /> : null}
      <Shutter />
      <ToastViewport />
    </>
  );
}
