"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { Overview } from "./Overview";
import { SettingsTab } from "./SettingsTab";

/** Back Office room shell — Phase 1's Overview (analytics) plus Phase 2's Settings additions (MoMo connect, expense approval threshold, reminder-schedule pointer). */
export function BackOffice() {
  const [tab, setTab] = useState<"analytics" | "settings">("analytics");

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <Tabs.List aria-label="Back Office sections" className="flex gap-4 border-b border-rule">
        <Tabs.Trigger value="analytics" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          Analytics
        </Tabs.Trigger>
        <Tabs.Trigger value="settings" className="border-b-2 border-transparent px-16 py-8 text-table font-semibold text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink">
          Settings
        </Tabs.Trigger>
      </Tabs.List>
      <div className="pt-16">
        <Tabs.Content value="analytics">
          <Overview />
        </Tabs.Content>
        <Tabs.Content value="settings">
          <SettingsTab />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
