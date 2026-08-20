"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { Select } from "../onboarding/Select";
import { DenominationBreakdown } from "./DenominationBreakdown";
import { useCloseTill, useOpenTill, useTillSession } from "@/lib/queries/till";
import { useDayStatus } from "@/lib/queries/day";
import { useTillUiStore } from "@/lib/stores/till-ui-store";
import type { VarianceReason } from "@/lib/api/types";

const REASONS: { value: VarianceReason; label: string }[] = [
  { value: "miscount_at_close", label: "Miscount at close" },
  { value: "cash_taken_overnight", label: "Cash taken overnight" },
  { value: "float_added", label: "Float added" },
  { value: "theft_suspected", label: "Theft suspected" },
  { value: "other", label: "Other" },
];

/**
 * D.7.5 — till open/close, reusing the D.3/D.11 denomination pattern
 * (DenominationBreakdown is shared verbatim). Opens automatically once the
 * day is open and this cashier has no active till session; a "Close my
 * till" action (TopNav) opens it again in close mode. Deliberately not a
 * hard gate on the Counter — see docs/DECISIONS.md: only the day session
 * blocks selling this phase, matching the spec's D.4 gate ("Disabled...
 * when... the day isn't open") which names the day, not the till.
 */
export function TillSessionModal() {
  const { data: day } = useDayStatus();
  const { data: tillSession } = useTillSession();
  const openTill = useOpenTill();
  const closeTill = useCloseTill();
  const [deferred, setDeferred] = useState(false);
  const closeRequested = useTillUiStore((s) => s.closeRequested);
  const cancelClose = useTillUiStore((s) => s.cancelClose);
  const [floatInput, setFloatInput] = useState("");
  const [countInput, setCountInput] = useState("");
  const [reason, setReason] = useState<VarianceReason | "">("");

  const shouldOfferOpen = day?.status === "open" && !tillSession && !deferred;
  const shouldOfferClose = closeRequested && Boolean(tillSession);
  const open = shouldOfferOpen || shouldOfferClose;

  if (!open) {
    // Exposes the "Close my till" trigger to TopNav via a global custom
    // event would be over-engineering for this scope — instead TopNav reads
    // tillSession directly and calls a shared setter through this module.
    return null;
  }

  if (shouldOfferClose && tillSession) {
    const floatMinor = tillSession.openingFloatMinor;
    const countedMinor: MinorUnits | null = countInput.trim() === "" ? null : minorUnits(Math.round((Number.parseFloat(countInput) || 0) * 100));
    return (
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-steel-deep/40" />
          <Dialog.Content
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            className="fixed left-1/2 top-1/2 z-50 w-modal max-w-full -translate-x-1/2 -translate-y-1/2 rounded border-t-4 border-tape bg-paper p-32 shadow-shelf"
          >
            <Dialog.Title className="type-expanded font-display text-section-head font-bold text-ink">Close your till</Dialog.Title>
            <Dialog.Description className="mt-8 text-body text-ink-soft">
              Opened with <Money amount={floatMinor} /> float.
            </Dialog.Description>
            <div className="mt-16 flex flex-col gap-4">
              <label htmlFor="close-till-count" className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
                Count your till now
              </label>
              <input
                id="close-till-count"
                autoFocus
                inputMode="decimal"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
                className="h-control-lg w-full rounded border border-rule bg-paper px-12 text-right font-mono text-card-title text-ink"
              />
            </div>
            <div className="mt-16">
              <DenominationBreakdown onTotalChange={(t) => setCountInput(String(t / 100))} />
            </div>
            <div className="mt-16 flex flex-col gap-8">
              <Select label="If different, why?" value={reason} onChange={(v) => setReason(v as VarianceReason)} options={REASONS} placeholder="Choose a reason" />
            </div>
            <div className="mt-24 flex justify-end gap-8">
              <Button variant="ghost" type="button" onClick={() => cancelClose()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={countedMinor == null}
                onClick={() => {
                  if (countedMinor == null) return;
                  void closeTill.mutateAsync({ countedMinor, reason: reason || undefined }).then(() => {
                    cancelClose();
                    setCountInput("");
                  });
                }}
              >
                Close my till
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const openingFloatMinor: MinorUnits | null = floatInput.trim() === "" ? null : minorUnits(Math.round((Number.parseFloat(floatInput) || 0) * 100));

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-steel-deep/40" />
        <Dialog.Content
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-modal max-w-full -translate-x-1/2 -translate-y-1/2 rounded border-t-4 border-tape bg-paper p-32 shadow-shelf"
        >
          <Dialog.Title className="type-expanded font-display text-section-head font-bold text-ink">Open your till</Dialog.Title>
          <Dialog.Description className="mt-8 text-body text-ink-soft">Declare your starting float for this shift.</Dialog.Description>
          <div className="mt-16 flex flex-col gap-4">
            <label htmlFor="open-till-float" className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
              Opening float
            </label>
            <input
              id="open-till-float"
              autoFocus
              inputMode="decimal"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              className="h-control-lg w-full rounded border border-rule bg-paper px-12 text-right font-mono text-card-title text-ink"
            />
          </div>
          <div className="mt-16">
            <DenominationBreakdown onTotalChange={(t) => setFloatInput(String(t / 100))} />
          </div>
          <div className="mt-24 flex justify-end gap-8">
            <Button variant="ghost" type="button" onClick={() => setDeferred(true)}>
              Not yet
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={openingFloatMinor == null}
              onClick={() => {
                if (openingFloatMinor == null) return;
                void openTill.mutateAsync({ openingFloatMinor }).then(() => setFloatInput(""));
              }}
            >
              Open my till
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
