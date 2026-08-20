import { useEffect, useState } from "react";

/**
 * Real breakpoint-driven conditional rendering, not just CSS `hidden`. Used
 * where mounting two copies of a stateful component (data-fetching basket,
 * live totals) for "desktop column" vs "mobile bottom sheet" would create
 * duplicate DOM nodes with the same ARIA landmark/label — a real
 * accessibility and testability bug found via Playwright at 375px width
 * (two elements both matched `getByLabel("Basket")`, one merely
 * CSS-hidden rather than absent). Returns `false` during SSR/first paint
 * (matches spec's mobile-first `sm` breakpoint at 375px, so `false` here
 * never causes a desktop-only flash at real mobile widths in practice).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * lg breakpoint per tailwind.config.ts (1280px) — spec D.4 is explicit:
 * "Layout — three columns on desktop (≥1280px)." Originally wired to the
 * `md` (768px) breakpoint instead, which a real Playwright run at 768px
 * caught as a genuine layout bug: a 420px fixed-width basket column plus
 * the category rail left the product grid squeezed into ~50px of usable
 * width (clipped by `<main>`'s `overflow-x-hidden`), effectively
 * invisible. Below 1280px there's no room for a true third column, so the
 * basket uses the bottom-sheet pattern all the way from 375 to 1279px —
 * matching the spec's own stated threshold, not just working around the bug.
 */
export function useIsDesktopBasket(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}
