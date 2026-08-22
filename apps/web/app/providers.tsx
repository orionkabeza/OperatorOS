"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { setNonce } from "get-nonce";
import { useEffect, useState } from "react";
import { ToastViewport } from "@/components/design/Toast";
import { createQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  // Error surfacing lives in createQueryClient() -- see lib/query-client.ts
  // for why it's on the cache rather than in each mutation hook, and
  // lib/query-client.test.ts for the tests that hold it in place.
  const [client] = useState(createQueryClient);

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

  return (
    <QueryClientProvider client={client}>
      {children}
      {/* Mounted here rather than per-page so an error raised anywhere has
          somewhere to appear — including on routes that never thought to
          render a viewport of their own. */}
      <ToastViewport />
    </QueryClientProvider>
  );
}
