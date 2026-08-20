"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setNonce } from "get-nonce";
import { useEffect, useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());

  // Real CSP violation found via Playwright's securitypolicyviolation
  // listener (not guessed): react-remove-scroll (a dependency of every
  // Radix Dialog/DropdownMenu/Popover-family primitive, used for body
  // scroll-locking) injects a genuine <style> element via
  // react-style-singleton, which style-src-elem 'self' correctly blocks —
  // this was a latent Phase 0 bug that just never got exercised by a test
  // asserting zero console errors after opening a Dialog. Fix: that
  // library already supports CSP nonces via the `get-nonce` package's
  // setNonce() — wire it to the same per-request nonce middleware.ts
  // generates (exposed via the <meta name="x-nonce"> tag in layout.tsx),
  // rather than weakening the CSP itself.
  useEffect(() => {
    const nonce = document.querySelector('meta[name="x-nonce"]')?.getAttribute("content");
    if (nonce) setNonce(nonce);
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
