"use client";

import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/design/Button";
import { Drawer } from "@/components/design/Drawer";
import { Input } from "@/components/design/Input";
import { Money } from "@/components/design/Money";
import { verifyManagerOverridePin } from "@/lib/api/manager-override";
import { autoAllocate, validateManualAllocation, type AllocatableInvoice } from "@/lib/debt-math";
import type { DebtAccountSummary, PaymentMethod } from "@/lib/api/types";
import { useMoneyLocations } from "@/lib/queries/cashbox";
import { useInvoices, useTakePayment } from "@/lib/queries/debt";
import { useRequestMomoPayment } from "@/lib/queries/momo";
import { useToastStore } from "@/lib/toast-store";

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "momo", label: "MoMo" },
  { id: "airtel", label: "Airtel" },
  { id: "bank", label: "Bank" },
  { id: "cheque", label: "Cheque" },
];

/** D.6.4 — the take-payment drawer: auto-oldest-first default, manual per-invoice option, back-dating with a permission-gated reason field. */
export function TakePaymentDrawer({ account, onClose }: { account: DebtAccountSummary | null; onClose: () => void }) {
  const customerId = account?.customer.id ?? null;
  const { data: invoices } = useInvoices(customerId);
  const { data: moneyLocations } = useMoneyLocations();
  const takePayment = useTakePayment();
  const requestMomoPayment = useRequestMomoPayment();
  const pushToast = useToastStore((s) => s.push);

  // D.6.5/docs/DECISIONS.md §0.3 — pushing a request to the sandbox MoMo
  // provider is a genuinely separate sub-flow from manual entry: it
  // completes the whole payment on its own once the customer approves (the
  // store's own takePayment call happens inside the settlement, not here),
  // so the regular amount/allocation form below is disabled while a
  // request is in flight to avoid double-recording the same payment.
  const [requestPhone, setRequestPhone] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "waiting">("idle");

  useEffect(() => {
    if (account) setRequestPhone(account.customer.phone);
  }, [account]);

  const [amountMajor, setAmountMajor] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [transactionRef, setTransactionRef] = useState("");
  const [locationKey, setLocationKey] = useState("till");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [manualLines, setManualLines] = useState<Record<string, string>>({});
  const [backdating, setBackdating] = useState(false);
  const [backdatePin, setBackdatePin] = useState("");
  const [backdateUnlocked, setBackdateUnlocked] = useState(false);
  const [backdateDate, setBackdateDate] = useState("");
  const [backdateReason, setBackdateReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountMinor: MinorUnits = minorUnits(Math.round((Number.parseFloat(amountMajor) || 0) * 100));
  const openInvoices: AllocatableInvoice[] = (invoices ?? []).filter((i) => i.remainingMinor > 0).map((i) => ({ id: i.id, remainingMinor: i.remainingMinor, dueDateAt: i.dueDateAt }));

  const autoPreview = useMemo(() => autoAllocate(amountMinor, openInvoices), [amountMinor, openInvoices]);

  const manualAllocations = useMemo(
    () => openInvoices.map((inv) => ({ invoiceId: inv.id, amountMinor: minorUnits(Math.round((Number.parseFloat(manualLines[inv.id] ?? "0") || 0) * 100)) })),
    [openInvoices, manualLines],
  );
  const manualValidation = useMemo(() => validateManualAllocation(amountMinor, manualAllocations, openInvoices), [amountMinor, manualAllocations, openInvoices]);

  const canSubmit =
    requestState === "idle" &&
    amountMinor > 0 &&
    (mode === "auto" ? true : manualValidation.valid) &&
    (!backdating || (backdateUnlocked && backdateDate && backdateReason.trim()));

  function reset() {
    setAmountMajor("");
    setMethod("cash");
    setTransactionRef("");
    setLocationKey("till");
    setMode("auto");
    setManualLines({});
    setBackdating(false);
    setBackdatePin("");
    setBackdateUnlocked(false);
    setBackdateDate("");
    setBackdateReason("");
    setRequestPhone("");
    setRequestState("idle");
  }

  async function handleRequestMomoPayment() {
    if (!customerId || !account) return;
    setRequestState("waiting");
    try {
      await requestMomoPayment.mutateAsync({ customerId, amountMinor, phone: requestPhone || account.customer.phone });
      pushToast({ message: `Payment request sent to ${requestPhone || account.customer.phone}. Waiting for approval…` });
      // The sandbox settlement (lib/mock/store.ts's requestMomoPayment) lands
      // and auto-matches ~3s after the request — this mirrors that timing
      // to close the loop in the UI rather than leaving the drawer stuck on
      // "waiting" with no further signal (a real webhook-driven UI would
      // instead subscribe/poll; the mock has no push channel to the client).
      setTimeout(() => {
        pushToast({ message: `Payment of RWF ${(amountMinor / 100).toLocaleString()} received from ${account.customer.name} via MoMo.` });
        reset();
        onClose();
      }, 3_500);
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : "Could not send the payment request." });
      setRequestState("idle");
    }
  }

  async function handleSubmit() {
    if (!customerId) return;
    setSubmitting(true);
    try {
      await takePayment.mutateAsync({
        customerId,
        amountMinor,
        method,
        transactionRef: transactionRef || undefined,
        moneyLocationAccountKey: locationKey,
        allocationMode: mode,
        manualAllocations: mode === "manual" ? manualAllocations : undefined,
        backdatedTo: backdating && backdateDate ? new Date(backdateDate).toISOString() : undefined,
        backdateReason: backdating ? backdateReason : undefined,
      });
      pushToast({ message: `Payment of RWF ${(amountMinor / 100).toLocaleString()} recorded for ${account?.customer.name}.` });
      reset();
      onClose();
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : "Could not record the payment." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={Boolean(account)}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title={account ? `Take payment — ${account.customer.name}` : "Take payment"}
      size="detail"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit || submitting}
            disabledReason={
              requestState !== "idle"
                ? "A sandbox payment request is in progress — it will complete on its own."
                : "Enter a valid amount and complete the allocation before recording the payment."
            }
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Recording…" : "Record payment"}
          </Button>
        </>
      }
    >
      {account ? (
        <div className="flex flex-col gap-16">
          <div className="flex items-center justify-between text-body">
            <span className="text-ink-soft">Current balance</span>
            <Money amount={account.customer.balanceMinor} emphasis={account.customer.balanceMinor > 0 ? "out" : undefined} />
          </div>

          <Input label="Amount" money inputMode="decimal" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} placeholder="0" />

          <label className="flex flex-col gap-4">
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Payment method</span>
            <div className="grid grid-cols-3 gap-8">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  aria-pressed={method === m.id}
                  className={`h-control rounded border text-meta font-semibold ${method === m.id ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </label>

          {method === "momo" || method === "airtel" ? (
            <div className="flex flex-col gap-8 rounded border border-rule p-12">
              <p className="text-meta text-ink-soft">
                Push a payment request to the customer&apos;s phone via the sandbox {method === "momo" ? "MTN MoMo" : "Airtel Money"} provider — settles automatically once approved (see docs/DECISIONS.md&apos;s sandbox seam entry).
              </p>
              <label className="flex flex-col gap-4">
                <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Customer phone</span>
                <input
                  value={requestPhone}
                  onChange={(e) => setRequestPhone(e.target.value)}
                  disabled={requestState !== "idle"}
                  className="h-control rounded border border-rule bg-paper px-8 text-table text-ink disabled:text-ink-soft"
                />
              </label>
              <Button
                variant="secondary"
                disabled={amountMinor <= 0 || requestState !== "idle"}
                disabledReason={amountMinor <= 0 ? "Enter an amount first." : "A request is already in progress."}
                onClick={() => void handleRequestMomoPayment()}
              >
                {requestState === "waiting" ? "Waiting for approval…" : "Request payment (sandbox)"}
              </Button>
              {requestState === "waiting" ? (
                <p role="status" className="text-meta text-ink-soft">
                  This will complete on its own once the customer approves — no need to also record it manually below.
                </p>
              ) : null}
            </div>
          ) : null}

          {method !== "cash" ? (
            <label className="flex flex-col gap-4">
              <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
                {method === "momo" || method === "airtel" ? "Transaction reference (only if not using the request above)" : "Transaction reference"}
              </span>
              <input
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                disabled={requestState !== "idle"}
                className="h-control rounded border border-rule bg-paper px-8 font-mono text-table text-ink disabled:text-ink-soft"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-4">
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Money goes into</span>
            <select value={locationKey} onChange={(e) => setLocationKey(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink">
              {(moneyLocations ?? []).map((l) => (
                <option key={l.accountKey} value={l.accountKey}>
                  {l.displayName}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Allocation</span>
            <div className="mt-4 grid grid-cols-2 gap-8">
              <button
                type="button"
                onClick={() => setMode("auto")}
                aria-pressed={mode === "auto"}
                className={`h-control rounded border text-meta font-semibold ${mode === "auto" ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
              >
                Auto (oldest first)
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                aria-pressed={mode === "manual"}
                className={`h-control rounded border text-meta font-semibold ${mode === "manual" ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
              >
                Manual per invoice
              </button>
            </div>
          </div>

          {openInvoices.length === 0 ? (
            <p className="text-meta text-ink-soft">No open invoices — this payment will be held as unallocated credit.</p>
          ) : mode === "auto" ? (
            <table className="w-full border-collapse text-table" aria-label="Auto allocation preview">
              <thead>
                <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                  <th className="py-4">Invoice</th>
                  <th className="py-4 text-right">Outstanding</th>
                  <th className="py-4 text-right">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {(invoices ?? [])
                  .filter((i) => i.remainingMinor > 0)
                  .map((inv) => {
                    const alloc = autoPreview.allocations.find((a) => a.invoiceId === inv.id);
                    return (
                      <tr key={inv.id} className="border-t border-rule">
                        <td className="py-4 font-mono">{inv.invoiceNumber}</td>
                        <td className="py-4 text-right font-mono">{(inv.remainingMinor / 100).toLocaleString()}</td>
                        <td className="py-4 text-right font-mono">{alloc ? (alloc.amountMinor / 100).toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col gap-8">
              <table className="w-full border-collapse text-table" aria-label="Manual allocation">
                <thead>
                  <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                    <th className="py-4">Invoice</th>
                    <th className="py-4 text-right">Outstanding</th>
                    <th className="py-4 text-right">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoices ?? [])
                    .filter((i) => i.remainingMinor > 0)
                    .map((inv) => (
                      <tr key={inv.id} className="border-t border-rule">
                        <td className="py-4 font-mono">{inv.invoiceNumber}</td>
                        <td className="py-4 text-right font-mono">{(inv.remainingMinor / 100).toLocaleString()}</td>
                        <td className="py-4 text-right">
                          <input
                            aria-label={`Allocate to ${inv.invoiceNumber}`}
                            inputMode="decimal"
                            value={manualLines[inv.id] ?? ""}
                            onChange={(e) => setManualLines((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                            className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!manualValidation.valid && manualAllocations.some((a) => a.amountMinor > 0) ? (
                <ul role="alert" className="text-meta text-out">
                  {manualValidation.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <div className="border-t border-rule pt-16">
            <label className="flex items-center gap-8 text-table text-ink">
              <input type="checkbox" checked={backdating} onChange={(e) => setBackdating(e.target.checked)} />
              Back-date this payment
            </label>
            {backdating ? (
              <div className="mt-8 flex flex-col gap-8">
                {!backdateUnlocked ? (
                  <div className="flex flex-col gap-8 rounded border border-rule p-12">
                    <p className="text-meta text-ink-soft">Back-dating requires a manager PIN.</p>
                    <input
                      aria-label="Manager PIN"
                      type="password"
                      inputMode="numeric"
                      value={backdatePin}
                      onChange={(e) => setBackdatePin(e.target.value)}
                      placeholder="Manager PIN"
                      className="h-control rounded border border-rule bg-paper px-8 font-mono text-table text-ink"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const outcome = verifyManagerOverridePin(backdatePin);
                        if (outcome.approved) setBackdateUnlocked(true);
                        else pushToast({ message: outcome.message });
                      }}
                    >
                      Unlock back-dating
                    </Button>
                  </div>
                ) : (
                  <>
                    <label className="flex flex-col gap-4">
                      <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Payment date</span>
                      <input type="date" value={backdateDate} onChange={(e) => setBackdateDate(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink" />
                    </label>
                    <label className="flex flex-col gap-4">
                      <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Reason (required)</span>
                      <input
                        value={backdateReason}
                        onChange={(e) => setBackdateReason(e.target.value)}
                        placeholder="e.g. Payment made in person on this date, entered late"
                        className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
                      />
                    </label>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
