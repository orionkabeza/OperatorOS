import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api/config";
import { describeApiError } from "./api/error-message";
import { useToastStore } from "./toast-store";

/**
 * Every failed request in this app used to fail silently. React Query
 * captured the rejection into per-hook `isError` state, almost nothing
 * rendered that state, and so a 500 and a successful no-op looked
 * identical on screen — "Open the shop" appeared to be an inert button
 * for hours in production while the server returned a foreign-key error
 * on every click.
 *
 * Wired on the cache rather than in each of the ~40 mutation hooks: a
 * global handler cannot be forgotten at a new call site, which is exactly
 * how this kept happening. Built here rather than inline in providers.tsx
 * so the behaviour is directly testable — the whole point is that it
 * cannot be allowed to silently stop working.
 */
export function reportError(error: unknown): void {
  useToastStore.getState().push({ message: describeApiError(error), durationMs: 8000 });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // A mutation is always something the user just did, so a failure must
    // always be visible.
    mutationCache: new MutationCache({ onError: reportError }),
    queryCache: new QueryCache({
      onError: (error) => {
        // 501 is `notSupportedByBackend` — a disclosed gap whose screens
        // already render their own explanation (transfers, stocktake
        // lists). Toasting it on every page load would be noise, and
        // noise is what gets error surfacing switched off.
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
  });
}
