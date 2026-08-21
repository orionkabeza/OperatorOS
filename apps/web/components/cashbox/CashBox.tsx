"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { BalancesTab } from "./BalancesTab";
import { ExpensesTab } from "./ExpensesTab";
import { MomoReconciliationTab } from "./MomoReconciliationTab";
import { MovementsTab } from "./MovementsTab";
import { useUnmatchedMomoTotal } from "@/lib/queries/momo";

/** D.7.1–D.7.5 — the Cash Box room: balances, money movements, MoMo reconciliation, expenses. */
export function CashBox() {
  const [tab, setTab] = useState<"balances" | "movements" | "momo" | "expenses">("balances");
  const { data: unmatched } = useUnmatchedMomoTotal();

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <Tabs.List aria-label="Cash Box sections" className="flex gap-4 border-b border-rule">
        <Tabs.Trigger value="balances" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          Balances
        </Tabs.Trigger>
        <Tabs.Trigger value="movements" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          Money movements
        </Tabs.Trigger>
        <Tabs.Trigger value="momo" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          MoMo reconciliation{unmatched && unmatched.count > 0 ? ` (${unmatched.count})` : ""}
        </Tabs.Trigger>
        <Tabs.Trigger value="expenses" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          Expenses
        </Tabs.Trigger>
      </Tabs.List>

      <div className="pt-16">
        <Tabs.Content value="balances">
          <BalancesTab />
        </Tabs.Content>
        <Tabs.Content value="movements">
          <MovementsTab />
        </Tabs.Content>
        <Tabs.Content value="momo">
          <MomoReconciliationTab />
        </Tabs.Content>
        <Tabs.Content value="expenses">
          <ExpensesTab />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
