"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Money } from "@/components/design/Money";
import { usePayLink, usePayLinkStatusPoll, useSubmitPayLink } from "@/lib/queries/pay";

/**
 * D.6.5/docs/DECISIONS.md §0.5 — the pay link. Deliberately its own
 * top-level route (not a Shop Floor room): no top nav, no room rail, no
 * sign-in — the signed token in the URL *is* the auth, scoped to one
 * customer/amount. Mobile-first since this is what a customer opens on
 * their own phone from a WhatsApp/SMS reminder, never from inside the shop.
 */
export default function PayLinkPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { data: link, isLoading } = usePayLink(token);
  const submit = useSubmitPayLink(token);
  const [method, setMethod] = useState<"momo" | "airtel">("momo");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { data: polledStatus } = usePayLinkStatusPoll(token, submitted);

  const status = polledStatus ?? link?.status;

  return (
    <main className="flex min-h-screen items-center justify-center bg-floor p-16">
      <div className="w-full max-w-sm rounded border border-rule bg-paper p-24 shadow-shelf">
        {isLoading ? (
          <p className="text-body text-ink-soft">Loading…</p>
        ) : !link || status === "invalid" ? (
          <div className="flex flex-col items-center gap-8 text-center">
            <p className="type-expanded font-display text-card-title font-bold text-ink">Link not found</p>
            <p className="text-body text-ink-soft">This payment link doesn&apos;t exist or has already been used up.</p>
          </div>
        ) : status === "expired" ? (
          <div className="flex flex-col items-center gap-8 text-center">
            <p className="type-expanded font-display text-card-title font-bold text-ink">This link has expired</p>
            <p className="text-body text-ink-soft">Ask {link.businessName} to send you a new payment link.</p>
          </div>
        ) : status === "paid" ? (
          <div className="flex flex-col items-center gap-8 text-center">
            <p className="type-expanded font-display text-card-title font-bold text-ink">Payment received</p>
            <Money amount={link.amountMinor} size="screen-title" />
            <p className="text-body text-ink-soft">Thank you, {link.customerName}. {link.businessName} has been notified.</p>
          </div>
        ) : submitted ? (
          <div className="flex flex-col items-center gap-16 text-center">
            <p className="type-expanded font-display text-card-title font-bold text-ink">Check your phone</p>
            <p className="text-body text-ink-soft">Approve the {method === "momo" ? "MTN MoMo" : "Airtel Money"} prompt on {phone || "your phone"} to complete the payment.</p>
            <div role="status" aria-live="polite" className="text-meta text-ink-soft">
              Waiting for confirmation…
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-16">
            <div className="text-center">
              <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">{link.businessName}</p>
              <p className="mt-4 text-body text-ink">Payment request for {link.customerName}</p>
              {link.invoiceRef ? <p className="text-meta text-ink-soft">Invoice {link.invoiceRef}</p> : null}
            </div>

            <div className="rounded bg-steel py-24 text-center">
              <Money amount={link.amountMinor} size="tally" surface="dark" />
            </div>

            <div role="group" aria-label="Payment method" className="grid grid-cols-2 gap-8">
              <button
                type="button"
                onClick={() => setMethod("momo")}
                aria-pressed={method === "momo"}
                className={`h-control-lg rounded border text-table font-semibold ${method === "momo" ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
              >
                MTN MoMo
              </button>
              <button
                type="button"
                onClick={() => setMethod("airtel")}
                aria-pressed={method === "airtel"}
                className={`h-control-lg rounded border text-table font-semibold ${method === "airtel" ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft"}`}
              >
                Airtel Money
              </button>
            </div>

            <label className="flex flex-col gap-4">
              <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Your phone number</span>
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                className="h-control-lg rounded border border-rule bg-paper px-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
              />
            </label>

            <Button
              variant="primary"
              className="w-full"
              disabled={phone.trim().length < 9}
              disabledReason="Enter your phone number to continue."
              onClick={async () => {
                await submit.mutateAsync({ method, phone });
                setSubmitted(true);
              }}
            >
              Pay <Money amount={link.amountMinor} className="ml-8" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
