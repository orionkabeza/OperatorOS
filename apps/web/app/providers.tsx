"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setNonce } from "get-nonce";
import { useEffect, useState } from "react";
import { ToastViewport } from "@/components/design/Toast";
import { ApiError } from "@/lib/api/config";
import { describeApiError } from "@/lib/api/error-message";
import { useToastStore } from "@/lib/toast-store";

/**
 * Every failed request in this app used to fail silently. React Query
 * captures the rejection into per-hook `isError` state, almost nothing
 * rendered that state, and so a 500 and a successful no-op looked
 * identical on screen — "Open the shop" appeared to be an inert button
 * for hours in production while the server was returning a foreign-key
 * error on every click. Each of the bugs found so far needed devtools
 * open to see at all.
 *
 * Handled here, once, on the cache rather than in each of the ~40
 * mutation hooks: a global handler cannot be forgotten at a new call
 * site, which is precisely how this kept happening.
 */
function reportError(error: unknown) {
  useToastStore.getState().push({ message: describeApiError(error), durationMs: 8000 });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // A mutation is always something the user just did, so a failure
        // must always be visible.
        mutationCache: new MutationCache({ onError: reportError }),
        queryCache: new QueryCache({
          onError: (error) => {
            // 501 is `notSupportedByBackend` — a disclosed gap whose
            // screens already render their own explanation (transfers,
            // stocktake lists). Toasting it on every page load would be
            // noise, and noise is what gets error surfacing switched off.
            if (error instanceof ApiError && error.status === 501) return;
            reportError(error);
          },
        }),
        defaultOptions: {
          queries: {
            // Don't sit retrying a request that cannot start succeeding.
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

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
