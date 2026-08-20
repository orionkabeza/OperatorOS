"use client";

import { minorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import { Money } from "../design/Money";
import type { OnboardingOpeningBalances } from "@/lib/api/types";

function majorToMinor(v: string) {
  const n = Number.parseFloat(v);
  return minorUnits(Number.isFinite(n) ? Math.round(n * 100) : 0);
}

/** D.2 Step 5 — the highest-value migration step: opening cash, and critically, who already owes you. */
export function StepBooks({
  value,
  onChange,
}: {
  value: Partial<OnboardingOpeningBalances>;
  onChange: (next: Partial<OnboardingOpeningBalances>) => void;
}) {
  const debtors = value.debtors ?? [];
  const payables = value.payables ?? [];
  const [debtorName, setDebtorName] = useState("");
  const [debtorPhone, setDebtorPhone] = useState("");
  const [debtorAmount, setDebtorAmount] = useState("");
  const [debtorSince, setDebtorSince] = useState("");
  const [payableSupplier, setPayableSupplier] = useState("");
  const [payableAmount, setPayableAmount] = useState("");

  return (
    <div className="flex flex-col gap-24">
      <div className="grid grid-cols-2 gap-16">
        <Input
          label="Cash in the till"
          money
          inputMode="decimal"
          value={value.tillCashMinor != null ? String(value.tillCashMinor / 100) : ""}
          onChange={(e) => onChange({ tillCashMinor: majorToMinor(e.target.value) })}
        />
        <Input
          label="Cash in the bank"
          money
          inputMode="decimal"
          value={value.bankCashMinor != null ? String(value.bankCashMinor / 100) : ""}
          onChange={(e) => onChange({ bankCashMinor: majorToMinor(e.target.value) })}
        />
      </div>

      <div>
        <h4 className="mb-4 text-table font-bold text-ink">Who already owes you</h4>
        <p className="mb-12 text-meta text-ink-soft">
          This is the single highest-value step here — without it, the Debt Book starts empty on day one.
        </p>
        <div className="flex flex-wrap items-end gap-8">
          <Input label="Customer name" value={debtorName} onChange={(e) => setDebtorName(e.target.value)} />
          <Input label="Phone" value={debtorPhone} onChange={(e) => setDebtorPhone(e.target.value)} />
          <Input label="Amount owed" money inputMode="decimal" value={debtorAmount} onChange={(e) => setDebtorAmount(e.target.value)} />
          <Input label="Since" type="date" value={debtorSince} onChange={(e) => setDebtorSince(e.target.value)} />
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              if (!debtorName.trim()) return;
              onChange({
                debtors: [
                  ...debtors,
                  { customerName: debtorName.trim(), phone: debtorPhone.trim(), amountOwedMinor: majorToMinor(debtorAmount), since: debtorSince },
                ],
              });
              setDebtorName("");
              setDebtorPhone("");
              setDebtorAmount("");
              setDebtorSince("");
            }}
          >
            Add
          </Button>
        </div>
        {debtors.length > 0 ? (
          <table className="mt-12 w-full border-collapse text-table">
            <thead>
              <tr className="border-b border-rule text-left text-micro uppercase tracking-tracked text-ink-soft">
                <th className="py-4">Customer</th>
                <th className="py-4">Phone</th>
                <th className="py-4 text-right">Amount</th>
                <th className="py-4">Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {debtors.map((d, i) => (
                <tr key={i} className="border-b border-rule">
                  <td className="py-4">{d.customerName}</td>
                  <td className="py-4 font-mono">{d.phone}</td>
                  <td className="py-4 text-right">
                    <Money amount={d.amountOwedMinor} />
                  </td>
                  <td className="py-4">{d.since || "—"}</td>
                  <td className="py-4 text-right">
                    <Button variant="ghost" type="button" onClick={() => onChange({ debtors: debtors.filter((_, idx) => idx !== i) })}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div>
        <h4 className="mb-4 text-table font-bold text-ink">What you owe suppliers</h4>
        <div className="flex flex-wrap items-end gap-8">
          <Input label="Supplier name" value={payableSupplier} onChange={(e) => setPayableSupplier(e.target.value)} />
          <Input label="Amount owed" money inputMode="decimal" value={payableAmount} onChange={(e) => setPayableAmount(e.target.value)} />
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              if (!payableSupplier.trim()) return;
              onChange({ payables: [...payables, { supplierName: payableSupplier.trim(), amountOwedMinor: majorToMinor(payableAmount) }] });
              setPayableSupplier("");
              setPayableAmount("");
            }}
          >
            Add
          </Button>
        </div>
        {payables.length > 0 ? (
          <ul className="mt-12 flex flex-col gap-4">
            {payables.map((p, i) => (
              <li key={i} className="flex items-center justify-between rounded border border-rule bg-paper px-16 py-8">
                <span>{p.supplierName}</span>
                <Money amount={p.amountOwedMinor} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
