"use client";

import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { useMemo, useState } from "react";
import { Button } from "../design/Button";
import { Drawer } from "../design/Drawer";
import { Money } from "../design/Money";
import { changeDueMinor, paidSoFarMinor, remainingMinor } from "@/lib/basket-math";
import { DEMO_MANAGER_PIN } from "@/lib/constants";
import type { Customer, PaymentLineInput, PaymentMethod, ReceiptChannel } from "@/lib/api/types";
import { checkCreditLimit } from "@/lib/api/sales";
import { useQuery } from "@tanstack/react-query";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "MoMo",
  airtel: "Airtel",
  bank: "Bank",
  card: "Card",
  cheque: "Cheque",
  credit: "On credit",
};

const TILE_METHODS: PaymentMethod[] = ["cash", "momo", "airtel", "bank", "card", "credit"];

interface DraftPayment extends PaymentLineInput {
  clientId: string;
}

function CreditLine({
  payment,
  customer,
  onUpdate,
}: {
  payment: DraftPayment;
  customer: Customer | undefined;
  onUpdate: (patch: Partial<DraftPayment>) => void;
}) {
  const { data: check } = useQuery({
    queryKey: ["credit-check", customer?.id, payment.amountMinor],
    queryFn: () => checkCreditLimit(customer!.id, payment.amountMinor),
    enabled: Boolean(customer),
  });
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [pinError, setPinError] = useState(false);
  const blocked = check ? !check.allowed && !payment.managerPinOverride : false;

  if (!customer) {
    return <p className="text-meta text-out">Pick a customer before selling on credit.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-8 text-meta text-ink-soft">
        <span>Current balance</span>
        <Money amount={customer.balanceMinor} emphasis={customer.balanceMinor > 0 ? "out" : undefined} className="justify-self-end" />
        <span>Credit limit</span>
        <Money amount={customer.creditLimitMinor} className="justify-self-end" />
        <span>New balance after this sale</span>
        <Money amount={check?.newBalanceMinor ?? minorUnits(0)} emphasis={check && !check.allowed ? "out" : undefined} className="justify-self-end" />
      </div>
      <label className="flex flex-col gap-4">
        <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Due date</span>
        <input
          type="date"
          value={payment.dueDate ?? ""}
          onChange={(e) => onUpdate({ dueDate: e.target.value })}
          className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
        />
      </label>

      {check && !check.allowed ? (
        <div role="alert" className="flex flex-col gap-8 rounded border border-out bg-paper p-12">
          <p className="text-body text-out">
            This would put {customer.name} over their credit limit. A manager PIN and a reason are required to continue.
          </p>
          <input
            aria-label="Manager PIN"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Manager PIN"
            className="h-control rounded border border-rule bg-paper px-8 font-mono text-table text-ink"
          />
          <input
            aria-label="Override reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for the override"
            className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
          />
          {pinError ? (
            <p role="alert" className="text-meta text-out">
              Wrong PIN.
            </p>
          ) : null}
          <Button
            variant="secondary"
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              if (pin === DEMO_MANAGER_PIN) {
                onUpdate({ managerPinOverride: pin, overrideReason: reason });
                setPinError(false);
              } else {
                setPinError(true);
              }
            }}
          >
            Override and continue
          </Button>
        </div>
      ) : null}
      {blocked ? <p className="sr-only">Credit line blocked until overridden.</p> : null}
    </div>
  );
}

/** D.4 — "the most important drawer in the product." Multi-line payments, mixed methods, cash change, and the credit-limit block. */
export function TakePaymentDrawer({
  open,
  onClose,
  totalMinor,
  customer,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  totalMinor: MinorUnits;
  customer: Customer | undefined;
  onComplete: (payments: PaymentLineInput[], receiptChannel: ReceiptChannel) => Promise<void> | void;
}) {
  const [payments, setPayments] = useState<DraftPayment[]>([]);
  const [receiptChannel, setReceiptChannel] = useState<ReceiptChannel>("print");
  const [submitting, setSubmitting] = useState(false);
  const [showReceiptStep, setShowReceiptStep] = useState(false);

  const remaining = useMemo(() => remainingMinor(totalMinor, payments), [totalMinor, payments]);
  const paid = paidSoFarMinor(payments);

  function addPaymentTile(method: PaymentMethod) {
    const amount = minorUnits(Math.max(0, remaining));
    const draft: DraftPayment = {
      clientId: crypto.randomUUID(),
      method,
      amountMinor: amount,
      ...(method === "cash" ? { cashGivenMinor: amount } : {}),
      ...(customer?.phone && (method === "momo" || method === "airtel") ? { phone: customer.phone } : {}),
    };
    setPayments((prev) => [...prev, draft]);
  }

  function updatePayment(clientId: string, patch: Partial<DraftPayment>) {
    setPayments((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)));
  }

  function removePayment(clientId: string) {
    setPayments((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  const anyCreditBlocked = payments.some((p) => p.method === "credit" && !p.managerPinOverride);
  const canConfirm = remaining <= 0 && payments.length > 0 && !anyCreditBlocked;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onComplete(
        payments.map(({ clientId, ...rest }) => rest),
        receiptChannel,
      );
      setShowReceiptStep(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setPayments([]);
    setShowReceiptStep(false);
    onClose();
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !next && handleClose()} title={`Take payment — RWF ${(totalMinor / 100).toLocaleString()}`} size="detail">
      {showReceiptStep ? (
        <div className="flex flex-col gap-16">
          <p className="text-body text-ink">Sale saved. Send a receipt?</p>
          <div className="grid grid-cols-2 gap-8">
            {(["print", "whatsapp", "sms", "none"] as ReceiptChannel[]).map((c) => (
              <Button key={c} variant="secondary" type="button" onClick={handleClose}>
                {c === "print" ? "Print" : c === "whatsapp" ? "Send on WhatsApp" : c === "sms" ? "Send by SMS" : "No receipt"}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-16">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4" role="group" aria-label="Payment methods">
            {TILE_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => addPaymentTile(method)}
                className="flex h-control-lg items-center justify-center rounded border border-rule bg-paper text-table font-semibold text-ink hover:border-tape"
              >
                {METHOD_LABELS[method]}
              </button>
            ))}
          </div>

          <ul className="flex flex-col gap-16">
            {payments.map((payment) => (
              <li key={payment.clientId} className="rounded border border-rule bg-paper p-12">
                <div className="flex items-center justify-between gap-8">
                  <span className="text-table font-semibold text-ink">{METHOD_LABELS[payment.method]}</span>
                  <div className="flex items-center gap-8">
                    <input
                      aria-label={`Amount for ${METHOD_LABELS[payment.method]} payment`}
                      inputMode="decimal"
                      value={payment.amountMinor / 100}
                      onChange={(e) =>
                        updatePayment(payment.clientId, { amountMinor: minorUnits(Math.round((Number.parseFloat(e.target.value) || 0) * 100)) })
                      }
                      className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
                    />
                    <Button variant="ghost" type="button" onClick={() => removePayment(payment.clientId)}>
                      Remove
                    </Button>
                  </div>
                </div>

                {payment.method === "cash" ? (
                  <div className="mt-8 flex flex-col gap-8">
                    <label className="flex items-center justify-between gap-8">
                      <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Cash given</span>
                      <input
                        inputMode="decimal"
                        value={(payment.cashGivenMinor ?? 0) / 100}
                        onChange={(e) =>
                          updatePayment(payment.clientId, {
                            cashGivenMinor: minorUnits(Math.round((Number.parseFloat(e.target.value) || 0) * 100)),
                          })
                        }
                        className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
                      />
                    </label>
                    <div className="flex items-center justify-between">
                      <span className="text-body text-ink-soft">Change due</span>
                      <Money amount={changeDueMinor(payment.cashGivenMinor ?? minorUnits(0), payment.amountMinor)} size="screen-title" />
                    </div>
                  </div>
                ) : null}

                {payment.method === "momo" || payment.method === "airtel" ? (
                  <div className="mt-8 flex flex-col gap-8">
                    <label className="flex flex-col gap-4">
                      <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Customer phone</span>
                      <input
                        value={payment.phone ?? ""}
                        onChange={(e) => updatePayment(payment.clientId, { phone: e.target.value })}
                        className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      type="button"
                      disabled
                      disabledReason="Mobile-money push requests aren't live yet (Phase 2) — enter the transaction ID manually below."
                    >
                      Request payment
                    </Button>
                    <label className="flex flex-col gap-4">
                      <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Transaction ID</span>
                      <input
                        value={payment.transactionRef ?? ""}
                        onChange={(e) => updatePayment(payment.clientId, { transactionRef: e.target.value })}
                        className="h-control rounded border border-rule bg-paper px-8 font-mono text-table text-ink"
                      />
                    </label>
                  </div>
                ) : null}

                {payment.method === "bank" ? (
                  <label className="mt-8 flex flex-col gap-4">
                    <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Reference number</span>
                    <input
                      value={payment.transactionRef ?? ""}
                      onChange={(e) => updatePayment(payment.clientId, { transactionRef: e.target.value })}
                      className="h-control rounded border border-rule bg-paper px-8 font-mono text-table text-ink"
                    />
                  </label>
                ) : null}

                {payment.method === "credit" ? (
                  <div className="mt-8">
                    <CreditLine payment={payment} customer={customer} onUpdate={(patch) => updatePayment(payment.clientId, patch)} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-rule pt-16">
            <span className="text-body text-ink-soft">Paid so far</span>
            <Money amount={paid} />
          </div>
          <div role="status" className="flex items-center justify-between">
            <span className="text-body font-semibold text-ink">{remaining <= 0 ? "Remaining" : "Still owed"}</span>
            <Money amount={minorUnits(Math.abs(remaining))} emphasis={remaining > 0 ? "out" : undefined} size="screen-title" />
          </div>

          <div>
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Receipt</span>
            <div className="mt-4 grid grid-cols-2 gap-8 md:grid-cols-4">
              {(["print", "whatsapp", "sms", "none"] as ReceiptChannel[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setReceiptChannel(c)}
                  aria-pressed={receiptChannel === c}
                  className={`h-control rounded border text-meta font-semibold ${receiptChannel === c ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
                >
                  {c === "print" ? "Print" : c === "whatsapp" ? "WhatsApp" : c === "sms" ? "SMS" : "None"}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="primary"
            className="w-full"
            disabled={!canConfirm || submitting}
            disabledReason={!canConfirm ? "Payments must cover the full total before you can complete the sale." : undefined}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Completing…" : "Complete sale"}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
