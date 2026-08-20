"use client";

import { minorUnits, type MinorUnits } from "@operatoros/shared";
import clsx from "clsx";
import { useState } from "react";
import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { Select } from "../onboarding/Select";
import { DenominationBreakdown } from "./DenominationBreakdown";
import { useCloseDay, useDayCloseChecklist, useDaySummary, useDayStatus } from "@/lib/queries/day";
import type { VarianceReason } from "@/lib/api/types";

const REASONS: { value: VarianceReason; label: string }[] = [
  { value: "miscount_at_close", label: "Miscount at close" },
  { value: "cash_taken_overnight", label: "Cash taken overnight" },
  { value: "float_added", label: "Float added" },
  { value: "theft_suspected", label: "Theft suspected" },
  { value: "other", label: "Other" },
];

const METHOD_LABEL: Record<string, string> = { cash: "Cash", momo: "MoMo", airtel: "Airtel", bank: "Bank", card: "Card", credit: "Credit" };

/**
 * D.11 — Close the Shop: full-screen, stepped. 1) open-business check,
 * 2) count the till (same denomination pattern as D.3), 3) the day summary,
 * 4) close (shutter-lower micro-animation on the confirm action), 5) the
 * dispatch (WhatsApp send — stubbed per phase-1 plan §0.4, same seam as the
 * receipt channels).
 */
export function CloseShopFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [countedInput, setCountedInput] = useState("");
  const [reason, setReason] = useState<VarianceReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [closing, setClosing] = useState(false);

  const { data: checklist } = useDayCloseChecklist();
  const { data: day } = useDayStatus();
  const { data: summary } = useDaySummary(step >= 3);
  const closeDay = useCloseDay();

  const countedMinor: MinorUnits | null = countedInput.trim() === "" ? null : minorUnits(Math.round((Number.parseFloat(countedInput) || 0) * 100));
  const expectedMinor = day?.status === "open" ? (day.countedMinor ?? minorUnits(0)) : minorUnits(0);
  const varianceMinor = countedMinor != null ? minorUnits(countedMinor - expectedMinor) : null;
  const needsReason = varianceMinor != null && varianceMinor !== 0;
  const canProceedFromCount = countedMinor != null && (!needsReason || reason !== "");

  async function handleClose() {
    if (countedMinor == null) return;
    setClosing(true);
    await closeDay.mutateAsync({ countedMinor, reason: needsReason && reason !== "" ? reason : undefined, reasonNote: reasonNote || undefined });
    setStep(4);
    window.setTimeout(() => setStep(5), 500);
  }

  return (
    <div className="motion-safe:animate-shutter-fade fixed inset-0 z-50 flex flex-col overflow-y-auto bg-steel-deep p-16 md:p-48">
      <div className="mx-auto flex w-full max-w-form flex-1 flex-col gap-24 text-white">
        <div className="flex items-center justify-between">
          <h1 className="type-expanded font-display text-section-head font-bold">Close the shop</h1>
          <button type="button" onClick={onDone} className="text-body text-white/70 underline underline-offset-2 hover:text-white">
            Back to the floor
          </button>
        </div>

        {step === 1 ? (
          <div className="flex flex-col gap-16 rounded border border-white/20 bg-steel p-24">
            <h2 className="text-card-title font-semibold">Before we close — anything open?</h2>
            <ul className="flex flex-col gap-8">
              <li className="flex items-center justify-between">
                <span>Parked sales</span>
                <span className={clsx(checklist && checklist.parkedSales > 0 ? "text-watch-dark" : "text-in-dark")}>
                  {checklist?.parkedSales ?? 0}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Unsent quotes</span>
                <span className={clsx(checklist && checklist.unsentQuotes > 0 ? "text-watch-dark" : "text-in-dark")}>
                  {checklist?.unsentQuotes ?? 0}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Unreconciled MoMo</span>
                <span className="text-in-dark">{checklist?.unreconciledMomo ?? 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Unposted stock-takes</span>
                <span className={clsx(checklist && checklist.unpostedStocktakes > 0 ? "text-watch-dark" : "text-in-dark")}>
                  {checklist?.unpostedStocktakes ?? 0}
                </span>
              </li>
            </ul>
            <p className="text-meta text-white/60">
              Nothing here blocks closing — deal with items now from their rooms, or leave them for tomorrow.
            </p>
            <Button variant="primary" type="button" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-16 rounded border border-white/20 bg-steel p-24">
            <h2 className="text-card-title font-semibold">Count the till</h2>
            <p className="text-body text-white/70">
              Expected <Money amount={expectedMinor} surface="dark" />
            </p>
            <div className="flex flex-col gap-4">
              <label htmlFor="close-shop-count" className="text-micro font-semibold uppercase tracking-tracked text-white/60">
                Counted amount
              </label>
              <input
                id="close-shop-count"
                autoFocus
                inputMode="decimal"
                value={countedInput}
                onChange={(e) => setCountedInput(e.target.value)}
                className="h-control-lg rounded border border-white/20 bg-steel-deep px-12 text-right font-mono text-card-title text-white"
              />
            </div>
            <DenominationBreakdown onTotalChange={(t) => setCountedInput(String(t / 100))} />
            {countedMinor != null ? (
              <p className={clsx("text-body font-semibold", varianceMinor === 0 ? "text-in-dark" : varianceMinor! > 0 ? "text-watch-dark" : "text-out-dark")}>
                {varianceMinor === 0
                  ? "Matches expected"
                  : varianceMinor! > 0
                    ? <>Over by <Money amount={minorUnits(varianceMinor!)} surface="dark" /></>
                    : <>Short by <Money amount={minorUnits(Math.abs(varianceMinor!))} surface="dark" /></>}
              </p>
            ) : null}
            {needsReason ? (
              <div className="rounded border border-white/20 bg-steel-deep p-12">
                <Select label="Why the difference?" value={reason} onChange={(v) => setReason(v as VarianceReason)} options={REASONS} placeholder="Choose a reason" />
                {reason === "other" ? (
                  <textarea
                    aria-label="Reason details"
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    className="mt-8 h-control-lg w-full rounded border border-white/20 bg-steel-deep p-8 text-body text-white"
                  />
                ) : null}
              </div>
            ) : null}
            <Button variant="primary" type="button" disabled={!canProceedFromCount} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === 3 && summary ? (
          <div className="flex flex-col gap-16 rounded border border-white/20 bg-steel p-24">
            <h2 className="text-card-title font-semibold">The day</h2>
            <div className="grid grid-cols-2 gap-16">
              <div>
                <p className="text-micro uppercase tracking-tracked text-white/60">Taken</p>
                <Money amount={summary.takenMinor} surface="dark" size="card-title" />
              </div>
              <div>
                <p className="text-micro uppercase tracking-tracked text-white/60">On credit</p>
                <Money amount={summary.onCreditMinor} surface="dark" size="card-title" />
              </div>
              <div>
                <p className="text-micro uppercase tracking-tracked text-white/60">Net</p>
                <Money amount={summary.netMinor} surface="dark" size="card-title" />
              </div>
              <div>
                <p className="text-micro uppercase tracking-tracked text-white/60">Transactions</p>
                <p className="font-mono text-card-title">{summary.transactionCount}</p>
              </div>
            </div>
            <div>
              <p className="mb-4 text-micro uppercase tracking-tracked text-white/60">By payment method</p>
              <ul className="flex flex-col gap-4">
                {summary.byMethod.map((m) => (
                  <li key={m.method} className="flex items-center justify-between text-body">
                    <span>{METHOD_LABEL[m.method] ?? m.method}</span>
                    <Money amount={m.amountMinor} surface="dark" />
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-body text-white/70">Top product: {summary.topProductName ?? "—"}</p>
            {summary.shrinkageMinor != null ? (
              <p className="text-body text-out-dark">
                Shrinkage this day: <Money amount={minorUnits(Math.abs(summary.shrinkageMinor))} surface="dark" />
              </p>
            ) : null}
            <Button variant="primary" type="button" disabled={closing} onClick={() => void handleClose()}>
              {closing ? "Closing…" : "Close the shop"}
            </Button>
          </div>
        ) : null}

        {step === 4 ? (
          <div
            aria-hidden
            className="shutter-slats motion-safe:animate-shutter-lower motion-reduce:animate-shutter-fade fixed inset-0 z-10 flex items-center justify-center bg-steel-deep"
          >
            <p className="type-expanded font-display text-card-title font-bold text-white/80">Lowering the shutter…</p>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-16 rounded border border-white/20 bg-steel p-24">
            <h2 className="text-card-title font-semibold">Sent to the owner</h2>
            <p className="text-body text-white/70">
              The day&apos;s summary has been sent on WhatsApp (stub — real delivery lands in Phase 5, D.12). The Counter is now read-only until
              tomorrow&apos;s day open.
            </p>
            <Button variant="primary" type="button" onClick={onDone}>
              Back to the floor
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
