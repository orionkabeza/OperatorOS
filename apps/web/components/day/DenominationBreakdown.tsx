"use client";

import { useState } from "react";
import { Money } from "../design/Money";
import { minorUnits } from "@operatoros/shared";
import type { DenominationCount } from "@/lib/api/types";

const DENOMINATIONS: { value: number; isCoin: boolean; label: string }[] = [
  { value: 5000, isCoin: false, label: "RWF 5,000 note" },
  { value: 2000, isCoin: false, label: "RWF 2,000 note" },
  { value: 1000, isCoin: false, label: "RWF 1,000 note" },
  { value: 500, isCoin: false, label: "RWF 500 note" },
  { value: 100, isCoin: true, label: "RWF 100 coin" },
  { value: 50, isCoin: true, label: "RWF 50 coin" },
];

export function denominationTotalMinor(counts: DenominationCount[]) {
  const majorTotal = counts.reduce((sum, c) => sum + c.value * c.count, 0);
  return minorUnits(Math.round(majorTotal * 100));
}

/**
 * D.3/D.7.5/D.11 — the shared "count the till" expander. Reused verbatim
 * (not re-implemented) across Open the Shop, Close the Shop, and Till
 * open/close, per phase-1 plan §4's "Till sessions... reuses the D.3/D.11
 * denomination-count pattern."
 */
export function DenominationBreakdown({ onTotalChange }: { onTotalChange: (totalMinor: ReturnType<typeof minorUnits>) => void }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<DenominationCount[]>(
    DENOMINATIONS.map((d) => ({ value: d.value, isCoin: d.isCoin, count: 0 })),
  );

  function updateCount(value: number, count: number) {
    const next = counts.map((c) => (c.value === value ? { ...c, count: Math.max(0, count) } : c));
    setCounts(next);
    onTotalChange(denominationTotalMinor(next));
  }

  const total = denominationTotalMinor(counts);

  return (
    <div className="rounded border border-rule">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-control w-full items-center justify-between px-16 text-table font-semibold text-ink"
      >
        <span>Count by denomination (optional, stronger audit trail)</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-rule p-16">
          <table className="w-full border-collapse text-table">
            <thead>
              <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                <th className="pb-8">Denomination</th>
                <th className="pb-8 text-right">Count</th>
                <th className="pb-8 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {DENOMINATIONS.map((d) => {
                const count = counts.find((c) => c.value === d.value)?.count ?? 0;
                return (
                  <tr key={d.value}>
                    <td className="py-4">{d.label}</td>
                    <td className="py-4 text-right">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`Count of ${d.label}`}
                        value={count || ""}
                        onChange={(e) => updateCount(d.value, Number.parseInt(e.target.value, 10) || 0)}
                        className="h-control w-64 rounded border border-rule bg-paper px-8 text-right font-mono text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
                      />
                    </td>
                    <td className="py-4 text-right">
                      <Money amount={minorUnits(d.value * count * 100)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-rule font-semibold">
                <td className="py-8">Denomination total</td>
                <td />
                <td className="py-8 text-right">
                  <Money amount={total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
}
