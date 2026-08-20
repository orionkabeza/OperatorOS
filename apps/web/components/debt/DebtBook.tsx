"use client";

import * as Tabs from "@radix-ui/react-tabs";
import dynamic from "next/dynamic";
import { useState } from "react";
import { AccountsTab } from "./AccountsTab";
import { ChaseTodayTab } from "./ChaseTodayTab";
import { useChaseQueue } from "@/lib/queries/debt";

// The reminder schedule builder pulls in the merge-field live-preview editor
// — heavier than the everyday "look at my accounts" path, so it's split out
// the same way Phase 1 split Stock Room/CSV import (bundle-budget rule,
// docs/DECISIONS.md's "any new room or heavy, conditionally-used library").
const AllCustomersTab = dynamic(() => import("./AllCustomersTab").then((m) => m.AllCustomersTab), { ssr: false });
const ReminderScheduleTab = dynamic(() => import("./ReminderScheduleTab").then((m) => m.ReminderScheduleTab), { ssr: false });

/** D.6 — the Debt Book room. Ageing/account list, the "who to chase today" queue, all-customers + segments/broadcast, and the reminder schedule builder each get their own tab. */
export function DebtBook() {
  const [tab, setTab] = useState<"accounts" | "chase" | "all-customers" | "reminders">("accounts");
  const { data: chaseQueue } = useChaseQueue();

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <Tabs.List aria-label="Debt Book sections" className="flex gap-4 border-b border-rule">
        <Tabs.Trigger
          value="accounts"
          className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
        >
          Accounts
        </Tabs.Trigger>
        <Tabs.Trigger
          value="chase"
          className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
        >
          Chase today{chaseQueue && chaseQueue.length > 0 ? ` (${chaseQueue.length})` : ""}
        </Tabs.Trigger>
        <Tabs.Trigger
          value="all-customers"
          className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
        >
          All customers
        </Tabs.Trigger>
        <Tabs.Trigger
          value="reminders"
          className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
        >
          Reminder schedule
        </Tabs.Trigger>
      </Tabs.List>

      <div className="pt-16">
        <Tabs.Content value="accounts">
          <AccountsTab />
        </Tabs.Content>
        <Tabs.Content value="chase">
          <ChaseTodayTab />
        </Tabs.Content>
        <Tabs.Content value="all-customers">
          <AllCustomersTab />
        </Tabs.Content>
        <Tabs.Content value="reminders">
          <ReminderScheduleTab />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
