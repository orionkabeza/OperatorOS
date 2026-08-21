"use client";

import clsx from "clsx";
import { useState } from "react";
import { Button } from "@/components/design/Button";
import { EmptyState } from "@/components/design/EmptyState";
import { Money } from "@/components/design/Money";
import { Table, type TableColumn } from "@/components/design/Table";
import { useChaseQueue, useLogContact, useSendReminders, useSnoozeCustomer } from "@/lib/queries/debt";
import type { ChaseQueueItem } from "@/lib/api/types";

/** D.6 — "who to chase today": a prioritized work queue, worst-overdue first, with Call / Send reminder / Snooze row actions. */
export function ChaseTodayTab() {
  const { data: queue } = useChaseQueue();
  const logContact = useLogContact();
  const sendReminders = useSendReminders();
  const snooze = useSnoozeCustomer();
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");

  if (queue && queue.length === 0) {
    return <EmptyState statement="Nobody needs chasing today — every overdue account has either been contacted or snoozed." />;
  }

  const columns: TableColumn<ChaseQueueItem & { id: string }>[] = [
    { key: "customer", label: "Customer", render: (i) => <span className="font-semibold text-ink">{i.customer.name}</span>, sortValue: (i) => i.customer.name },
    { key: "phone", label: "Phone", render: (i) => <span className="font-mono text-ink-soft">{i.customer.phone}</span> },
    { key: "balance", label: "Balance", numeric: true, render: (i) => <Money amount={i.balanceMinor} emphasis="out" />, sortValue: (i) => i.balanceMinor },
    {
      key: "days",
      label: "Days overdue",
      numeric: true,
      render: (i) => <span className={clsx("font-mono", i.daysOverdue > 60 ? "text-out" : "text-watch")}>{i.daysOverdue}d</span>,
      sortValue: (i) => i.daysOverdue,
    },
    { key: "next", label: "Next reminder step", render: (i) => <span className="text-table text-ink-soft">{i.nextReminderStep ?? "—"}</span> },
    {
      key: "lastContact",
      label: "Last contact",
      render: (i) => (i.lastContactAt ? new Date(i.lastContactAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "Never"),
    },
    {
      key: "actions",
      label: "Actions",
      render: (i) => (
        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            onClick={() => {
              logContact.mutate({ customerId: i.customer.id, note: "Called about the outstanding balance." });
            }}
          >
            Call
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              sendReminders.mutate([i.customer.id]);
            }}
          >
            Send reminder
          </Button>
          <Button variant="ghost" onClick={() => setSnoozingId(snoozingId === i.customer.id ? null : i.customer.id)}>
            Snooze
          </Button>
        </div>
      ),
    },
  ];

  const rows = (queue ?? []).map((i) => ({ ...i, id: i.customer.id }));

  return (
    <div className="flex flex-col gap-16">
      <Table columns={columns} rows={rows} emptyMessage="Nobody needs chasing today." />
      {snoozingId ? (
        <div className="flex items-center gap-8 rounded border border-rule bg-paper p-12">
          <label className="flex items-center gap-8 text-table text-ink">
            Snooze to
            <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink" />
          </label>
          <Button
            variant="primary"
            disabled={!snoozeDate}
            disabledReason="Pick a date to snooze to."
            onClick={() => {
              snooze.mutate({ customerId: snoozingId, untilIso: new Date(snoozeDate).toISOString() });
              setSnoozingId(null);
              setSnoozeDate("");
            }}
          >
            Confirm snooze
          </Button>
          <Button variant="ghost" onClick={() => setSnoozingId(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
