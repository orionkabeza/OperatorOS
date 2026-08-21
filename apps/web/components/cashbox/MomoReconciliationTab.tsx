"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Button } from "@/components/design/Button";
import { Money } from "@/components/design/Money";
import { useDebtAccounts } from "@/lib/queries/debt";
import { useMarkMomoAsCash, useMatchMomoTransaction, useMomoTransactions, useUnmatchedMomoTotal, useVoidMomoTransaction } from "@/lib/queries/momo";
import { useToastStore } from "@/lib/toast-store";
import type { DebtAccountSummary, MomoTransaction } from "@/lib/api/types";

type Confidence = "high" | "medium" | "low";

/** Amount + phone-tail match — the same signal spec D.7.3's auto-match engine describes (amount + phone + time window); phone-suffix match here since seed phone numbers are formatted inconsistently, same tolerance a real matcher needs. */
function confidenceFor(txn: MomoTransaction, account: DebtAccountSummary): Confidence {
  const phoneMatch = account.customer.phone && txn.phone.slice(-9) === account.customer.phone.slice(-9);
  const amountMatch = account.customer.balanceMinor > 0 && Math.abs(account.customer.balanceMinor - txn.amountMinor) < 1;
  if (phoneMatch && amountMatch) return "high";
  if (phoneMatch || amountMatch) return "medium";
  return "low";
}

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: "bg-in text-white",
  medium: "bg-watch text-white",
  low: "border border-rule text-ink-soft",
};

/** D.7.3 — the flagship reconciliation screen: API transactions on the left, expected/recorded accounts on the right, with a confidence indicator and match/chase/mark-cash/void actions. */
export function MomoReconciliationTab() {
  const { data: transactions } = useMomoTransactions();
  const { data: unmatchedTotal } = useUnmatchedMomoTotal();
  const { data: accounts } = useDebtAccounts();
  const match = useMatchMomoTransaction();
  const markCash = useMarkMomoAsCash();
  const voidTxn = useVoidMomoTransaction();
  const pushToast = useToastStore((s) => s.push);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const unmatched = (transactions ?? []).filter((t) => t.status === "unmatched");
  const matched = (transactions ?? []).filter((t) => t.status === "matched");
  const selected = unmatched.find((t) => t.id === selectedId) ?? null;

  const ranked = useMemo(() => {
    if (!selected || !accounts) return [];
    return [...accounts]
      .filter((a) => a.customer.balanceMinor > 0)
      .map((a) => ({ account: a, confidence: confidenceFor(selected, a) }))
      .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : b.confidence === "high" ? 1 : a.confidence === "medium" ? -1 : 1));
  }, [selected, accounts]);

  return (
    <div className="flex flex-col gap-16">
      <div className="rounded border-2 border-out bg-paper p-16">
        <p className="text-body font-semibold text-out">
          RWF {((unmatchedTotal?.totalMinor ?? 0) / 100).toLocaleString()} unmatched across {unmatchedTotal?.count ?? 0} transactions
        </p>
      </div>

      <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
        <div>
          <p className="mb-8 text-micro font-semibold uppercase tracking-tracked text-ink-soft">MoMo transactions (from the provider)</p>
          <div className="flex flex-col gap-8">
            {unmatched.length === 0 ? <p className="text-meta text-ink-soft">Nothing unmatched right now.</p> : null}
            {unmatched.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                className={clsx("flex flex-col gap-4 rounded border p-12 text-left", selectedId === t.id ? "border-tape-deep bg-tape/10" : "border-rule")}
              >
                <div className="flex items-center justify-between">
                  <Money amount={t.amountMinor} size="card-title" />
                  <span className="rounded bg-rule px-8 py-4 text-micro font-bold uppercase tracking-tracked text-ink-soft">Unmatched</span>
                </div>
                <p className="font-mono text-meta text-ink-soft">
                  {t.phone} · ref {t.externalId} · {t.provider.toUpperCase()}
                </p>
                <p className="text-meta text-ink-soft">{new Date(t.occurredAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                <div className="flex gap-8" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      markCash.mutate(t.id);
                      pushToast({ message: "Marked as a cash sale — removed from unmatched." });
                    }}
                  >
                    Mark as cash
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      voidTxn.mutate(t.id);
                      pushToast({ message: "Transaction voided." });
                    }}
                  >
                    Void
                  </Button>
                </div>
              </button>
            ))}
          </div>

          {matched.length > 0 ? (
            <div className="mt-16">
              <p className="mb-8 text-micro font-semibold uppercase tracking-tracked text-ink-soft">Matched</p>
              <div className="flex flex-col gap-4">
                {matched.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded border border-rule p-8 text-meta">
                    <span>
                      <Money amount={t.amountMinor} /> — {t.matchedCustomerName}
                    </span>
                    <span className="rounded bg-in px-8 py-4 text-micro font-bold uppercase tracking-tracked text-white">Matched</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <p className="mb-8 text-micro font-semibold uppercase tracking-tracked text-ink-soft">Expected / recorded (customer accounts)</p>
          {!selected ? (
            <p className="text-meta text-ink-soft">Select a transaction on the left to see suggested matches.</p>
          ) : ranked.length === 0 ? (
            <p className="text-meta text-ink-soft">No open accounts to match against.</p>
          ) : (
            <div className="flex flex-col gap-8">
              {ranked.map(({ account, confidence }) => (
                <div key={account.customer.id} className="flex items-center justify-between rounded border border-rule p-12">
                  <div>
                    <p className="text-table font-semibold text-ink">{account.customer.name}</p>
                    <p className="font-mono text-meta text-ink-soft">{account.customer.phone}</p>
                    <Money amount={account.customer.balanceMinor} size="body" />
                  </div>
                  <div className="flex items-center gap-8">
                    <span className={clsx("rounded px-8 py-4 text-micro font-bold uppercase tracking-tracked", CONFIDENCE_CLASS[confidence])}>{confidence}</span>
                    <Button
                      variant="primary"
                      onClick={() => {
                        match.mutate(
                          { momoTransactionId: selected.id, customerId: account.customer.id },
                          { onSuccess: () => pushToast({ message: `Matched RWF ${(selected.amountMinor / 100).toLocaleString()} to ${account.customer.name}.` }) },
                        );
                        setSelectedId(null);
                      }}
                    >
                      Match
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
