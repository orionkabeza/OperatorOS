"use client";

import { minorUnits } from "@operatoros/shared";
import clsx from "clsx";
import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Card } from "@/components/design/Card";
import { Input } from "@/components/design/Input";
import { Money } from "@/components/design/Money";
import { useMoneyLocations } from "@/lib/queries/cashbox";
import {
  useApprovalThreshold,
  useApproveExpense,
  useCreateRecurringExpense,
  useExpenses,
  useRecordExpense,
  useRecurringExpenses,
  useRejectExpense,
  useToggleRecurringExpense,
} from "@/lib/queries/expenses";
import { useToastStore } from "@/lib/toast-store";
import type { Expense, ExpenseCategory } from "@/lib/api/types";

const CATEGORIES: ExpenseCategory[] = ["rent", "utilities", "transport", "supplies", "salaries", "maintenance", "other"];

const STATUS_CLASS: Record<Expense["status"], string> = {
  draft: "border border-rule text-ink-soft",
  pending_approval: "bg-watch text-white",
  approved: "bg-in text-white",
  posted: "bg-in text-white",
  rejected: "bg-out text-white",
};

/** D.7.4 — expense quick-record, the approval queue (pending above threshold visibly gated), and recurring-expense scheduler. */
export function ExpensesTab() {
  const { data: locations } = useMoneyLocations();
  const { data: expenses } = useExpenses();
  const { data: recurring } = useRecurringExpenses();
  const { data: threshold } = useApprovalThreshold();
  const recordExpense = useRecordExpense();
  const approve = useApproveExpense();
  const reject = useRejectExpense();
  const createRecurring = useCreateRecurringExpense();
  const toggleRecurring = useToggleRecurringExpense();
  const pushToast = useToastStore((s) => s.push);

  const [amountMajor, setAmountMajor] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [locationKey, setLocationKey] = useState("till");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");

  const amountMinor = minorUnits(Math.round((Number.parseFloat(amountMajor) || 0) * 100));
  const willNeedApproval = threshold !== undefined && amountMinor >= threshold;

  const pending = (expenses ?? []).filter((e) => e.status === "pending_approval");
  const others = (expenses ?? []).filter((e) => e.status !== "pending_approval");

  function submit() {
    recordExpense.mutate(
      { amountMinor, category, moneyLocationAccountKey: locationKey, payee, date: new Date().toISOString().slice(0, 10), note: note || undefined },
      {
        onSuccess: (expense) =>
          pushToast({
            message: expense.status === "pending_approval" ? `Expense of RWF ${(amountMinor / 100).toLocaleString()} sent for approval.` : `Expense of RWF ${(amountMinor / 100).toLocaleString()} posted.`,
          }),
      },
    );
    setAmountMajor("");
    setPayee("");
    setNote("");
  }

  return (
    <div className="flex flex-col gap-24">
      <Card eyebrow="Quick record" title="Record an expense">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Amount" money inputMode="decimal" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} />
          <label className="flex flex-col gap-4">
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="h-control rounded border border-rule bg-paper px-8 text-table capitalize text-ink">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-4">
            <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Paid from</span>
            <select value={locationKey} onChange={(e) => setLocationKey(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink">
              {(locations ?? []).map((l) => (
                <option key={l.accountKey} value={l.accountKey}>
                  {l.displayName}
                </option>
              ))}
            </select>
          </label>
          <Input label="Payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
        </div>
        <label className="mt-8 flex flex-col gap-4">
          <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="h-control rounded border border-rule bg-paper px-12 text-body text-ink" />
        </label>
        {willNeedApproval ? (
          <p className="mt-8 text-meta text-watch">This is above the RWF {((threshold ?? 0) / 100).toLocaleString()} approval threshold and will need manager sign-off before it posts.</p>
        ) : null}
        <Button variant="primary" className="mt-8" disabled={amountMinor <= 0 || !payee.trim()} disabledReason="Enter an amount and payee first." onClick={submit}>
          {willNeedApproval ? "Send for approval" : "Record expense"}
        </Button>
      </Card>

      {pending.length > 0 ? (
        <Card eyebrow="Approval queue" title={`${pending.length} pending approval`}>
          <div className="flex flex-col gap-8">
            {pending.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded border border-watch p-12">
                <div>
                  <p className="text-table font-semibold text-ink">
                    {e.payee} · <span className="capitalize">{e.category}</span>
                  </p>
                  <p className="text-meta text-ink-soft">
                    {e.date} · {e.createdBy} · {e.note}
                  </p>
                </div>
                <div className="flex items-center gap-8">
                  <Money amount={e.amountMinor} emphasis="watch" />
                  <Button variant="secondary" onClick={() => approve.mutate(e.id, { onSuccess: () => pushToast({ message: "Expense approved and posted." }) })}>
                    Approve
                  </Button>
                  <Button variant="ghost" onClick={() => reject.mutate({ id: e.id }, { onSuccess: () => pushToast({ message: "Expense rejected." }) })}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card eyebrow="Expenses" title="Recent">
        <div className="flex flex-col gap-4">
          {others.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded border border-rule p-12">
              <div>
                <p className="text-table text-ink">
                  {e.payee} · <span className="capitalize">{e.category}</span>
                </p>
                <p className="text-meta text-ink-soft">
                  {e.date} · {e.createdBy}
                </p>
              </div>
              <div className="flex items-center gap-8">
                <Money amount={e.amountMinor} />
                <span className={clsx("rounded px-8 py-4 text-micro font-bold uppercase tracking-tracked", STATUS_CLASS[e.status])}>{e.status.replace("_", " ")}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card eyebrow="Recurring" title="Recurring expenses">
        <div className="flex flex-col gap-8">
          {(recurring ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border border-rule p-12">
              <div>
                <p className="text-table text-ink">
                  {r.template.payee} · <span className="capitalize">{r.template.category}</span> · {r.interval}
                </p>
                <p className="text-meta text-ink-soft">Next run {r.nextRunDate}</p>
              </div>
              <div className="flex items-center gap-8">
                <Money amount={r.template.amountMinor} />
                <label className="flex items-center gap-4 text-meta text-ink-soft">
                  <input type="checkbox" checked={r.active} onChange={(e) => toggleRecurring.mutate({ id: r.id, active: e.target.checked })} />
                  Active
                </label>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              createRecurring.mutate({ template: { amountMinor: minorUnits(0), category: "other", moneyLocationAccountKey: "till", payee: "New recurring expense", date: "" }, interval: "monthly" });
            }}
          >
            + Add a recurring expense
          </Button>
        </div>
      </Card>
    </div>
  );
}
