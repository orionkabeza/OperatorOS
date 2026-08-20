"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { Select } from "../onboarding/Select";
import { DenominationBreakdown } from "./DenominationBreakdown";
import { useDayStatus, useOpenDay } from "@/lib/queries/day";
import type { VarianceReason } from "@/lib/api/types";

const REASONS: { value: VarianceReason; label: string }[] = [
  { value: "miscount_at_close", label: "Miscount at close" },
  { value: "cash_taken_overnight", label: "Cash taken overnight" },
  { value: "float_added", label: "Float added" },
  { value: "theft_suspected", label: "Theft suspected" },
  { value: "other", label: "Other" },
];

function todayLabel() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * D.3 — Open the Shop. "Cannot be dismissed without a choice": Radix's
 * outside-click/Escape dismissal is deliberately suppressed
 * (onInteractOutside/onEscapeKeyDown preventDefault) so the only two exits
 * are the explicit buttons, matching the spec's "Open the shop" / "Not yet"
 * pair — clicking off the modal must not silently leave the day unopened
 * with no record of a decision either way.
 */
export function OpenShopModal({ open, onDeferred }: { open: boolean; onDeferred: () => void }) {
  const { data: day } = useDayStatus();
  const openDayMutation = useOpenDay();
  const [countedInput, setCountedInput] = useState("");
  const [reason, setReason] = useState<VarianceReason | "">("");
  const [reasonNote, setReasonNote] = useState("");

  const countedMinor: MinorUnits | null =
    countedInput.trim() === "" ? null : minorUnits(Math.round((Number.parseFloat(countedInput) || 0) * 100));
  const expectedMinor = day?.expectedMinor ?? minorUnits(0);
  const varianceMinor = countedMinor != null ? minorUnits(countedMinor - expectedMinor) : null;
  const needsReason = varianceMinor != null && varianceMinor !== 0;
  const canSubmit = countedMinor != null && (!needsReason || reason !== "");

  function handleDenominationTotal(total: MinorUnits) {
    setCountedInput(String(total / 100));
  }

  function submit() {
    if (countedMinor == null) return;
    openDayMutation.mutate({
      countedMinor,
      reason: needsReason && reason !== "" ? reason : undefined,
      reasonNote: reasonNote || undefined,
    });
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-steel-deep/40" />
        <Dialog.Content
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-screen w-modal max-w-full -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded border-t-4 border-tape bg-paper p-32 shadow-shelf"
        >
          <Dialog.Title className="type-expanded font-display text-section-head font-bold text-ink">
            Open the shop — {todayLabel()}
          </Dialog.Title>
          <Dialog.Description className="mt-8 text-body text-ink-soft">
            Closed yesterday with <Money amount={expectedMinor} /> in the till.
          </Dialog.Description>

          <div className="mt-24 flex flex-col gap-4">
            <label htmlFor="open-shop-count" className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
              Count the till now
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-8 text-meta text-ink-soft">RWF</span>
              <input
                id="open-shop-count"
                autoFocus
                inputMode="decimal"
                value={countedInput}
                onChange={(e) => setCountedInput(e.target.value)}
                className="h-control-lg w-full rounded border border-rule bg-paper py-8 pl-32 pr-12 text-right font-mono text-card-title text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
              />
            </div>
          </div>

          <div className="mt-16">
            <DenominationBreakdown onTotalChange={handleDenominationTotal} />
          </div>

          {countedMinor != null ? (
            <p role="status" className={`mt-16 text-body font-semibold ${varianceMinor === 0 ? "text-in" : varianceMinor! > 0 ? "text-watch" : "text-out"}`}>
              {varianceMinor === 0
                ? "Matches yesterday's close"
                : varianceMinor! > 0
                  ? <>Over by <Money amount={minorUnits(varianceMinor!)} /></>
                  : <>Short by <Money amount={minorUnits(Math.abs(varianceMinor!))} /></>}
            </p>
          ) : null}

          {needsReason ? (
            <div className="mt-16 flex flex-col gap-8">
              <Select
                label="Why the difference?"
                value={reason}
                onChange={(v) => setReason(v as VarianceReason)}
                options={REASONS}
                placeholder="Choose a reason"
              />
              {reason === "other" ? (
                <textarea
                  aria-label="Reason details"
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="What happened?"
                  className="h-control-lg w-full rounded border border-rule bg-paper p-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
                />
              ) : null}
            </div>
          ) : null}

          <div className="mt-24 flex justify-end gap-8">
            <Button variant="ghost" type="button" onClick={onDeferred}>
              Not yet
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!canSubmit || openDayMutation.isPending}
              disabledReason={!canSubmit ? "Enter a till count (and a reason, if it doesn't match yesterday's close)." : undefined}
              onClick={submit}
            >
              {openDayMutation.isPending ? "Opening…" : "Open the shop"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
