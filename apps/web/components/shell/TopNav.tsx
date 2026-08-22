"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { useIdentity } from "@/lib/queries/identity";
import { useTillSession } from "@/lib/queries/till";
import { useTillUiStore } from "@/lib/stores/till-ui-store";
import type { DaySession } from "@/lib/api/types";

function elapsedSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

/**
 * C.2 — top nav: business + location switcher, global search / ⌘K, day
 * status, notifications, avatar.
 *
 * The business name, branch and avatar initials come from the signed-in
 * session (lib/api/identity.ts). They used to be literals: `businessName`
 * defaulted to "Kigali Hardware Supplies" and `ShopFloor` never passed one,
 * the branch button read "Nyabugogo branch", and the avatar read "AM" —
 * all three straight out of the mock fixture, so in production every real
 * tenant had another shop's name and a branch they don't own printed above
 * their own till.
 */
export function TopNav({ dayStatus }: { dayStatus?: DaySession | undefined }) {
  const signOut = useAuthStore((s) => s.signOut);
  const { data: identity } = useIdentity();
  const { data: tillSession } = useTillSession();
  const requestCloseTill = useTillUiStore((s) => s.requestClose);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") setCmdOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-rail items-center justify-between gap-16 bg-steel px-24">
      <div className="flex min-w-0 items-center gap-12">
        <span className="type-expanded truncate font-display text-table font-bold text-white">
          {identity?.businessName ?? ""}
        </span>
        {identity ? (
          <button
            type="button"
            className="rounded border border-white/20 px-8 py-4 text-meta text-white/70 hover:border-white/40 hover:text-white"
          >
            {identity.locationName} ▾
          </button>
        ) : null}
      </div>

      <div className="hidden flex-1 justify-center md:flex">
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          className="flex h-control w-full max-w-md items-center justify-between rounded border border-white/20 bg-steel-deep px-12 text-meta text-white/60 hover:border-white/40"
        >
          <span>Search products, customers, receipts…</span>
          <kbd className="rounded border border-white/20 px-4 font-mono text-micro">⌘K</kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-16">
        <span className="hidden items-center gap-8 text-meta text-white/70 sm:flex">
          <span aria-hidden className={`h-8 w-8 rounded-full ${dayStatus?.status === "open" ? "bg-in" : "bg-out"}`} />
          {dayStatus?.status === "open" && dayStatus.openedAt
            ? `Shop open — ${elapsedSince(dayStatus.openedAt)}`
            : "Shop closed"}
        </span>
        {tillSession ? (
          <button
            type="button"
            onClick={requestCloseTill}
            className="hidden rounded border border-white/20 px-8 py-4 text-meta text-white/70 hover:border-white/40 hover:text-white sm:block"
          >
            Close my till
          </button>
        ) : null}
        <button type="button" aria-label="Notifications" className="text-white/70 hover:text-white">
          🔔
        </button>
        <button
          type="button"
          onClick={signOut}
          className="flex h-control-lg w-control-lg items-center justify-center rounded bg-tape text-table font-bold text-ink"
          title={identity ? `Sign out — ${identity.displayName}` : "Sign out"}
        >
          {identity?.initials ?? "…"}
        </button>
      </div>

      {cmdOpen ? (
        <div
          role="dialog"
          aria-label="Search"
          className="fixed inset-0 z-40 flex items-start justify-center bg-steel-deep/40 pt-96"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-drawer max-w-full rounded border border-rule bg-paper p-16 shadow-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              placeholder="Search products, customers, receipts…"
              className="h-control w-full rounded border border-rule bg-paper px-12 text-body focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
            />
            <p className="mt-12 text-meta text-ink-soft">
              Command palette scaffold — real search lands with Counter/Stock Room (Phase 1).
            </p>
          </div>
        </div>
      ) : null}
    </header>
  );
}
