"use client";

import { minorUnits } from "@operatoros/shared";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { AccountDrawer } from "./AccountDrawer";
import { AdjustLimitDrawer } from "./AdjustLimitDrawer";
import { TakePaymentDrawer } from "./TakePaymentDrawer";
import { WriteOffDialog } from "./WriteOffDialog";
import { AgeingBar } from "@/components/design/AgeingBar";
import { Money } from "@/components/design/Money";
import { Table, type TableColumn } from "@/components/design/Table";
import { ageingBucket, creditLimitUsagePercent, type AgeingBucket } from "@/lib/debt-math";
import { useDebtAccounts, useDebtBookHeader, useLogContact, useSnoozeCustomer } from "@/lib/queries/debt";
import { useSetCustomerHold } from "@/lib/queries/customers";
import { useToastStore } from "@/lib/toast-store";
import type { DebtAccountSummary } from "@/lib/api/types";

const STATUS_LABEL: Record<DebtAccountSummary["status"], string> = {
  current: "CURRENT",
  due_this_week: "DUE THIS WEEK",
  overdue: "OVERDUE",
  over_limit: "OVER LIMIT",
};

const STATUS_CHIP_CLASS: Record<DebtAccountSummary["status"], string> = {
  current: "bg-in text-white",
  due_this_week: "bg-watch text-white",
  overdue: "border border-out text-out",
  over_limit: "bg-out text-white",
};

const QUICK_FILTERS: { id: DebtAccountSummary["status"] | "all"; label: string }[] = [
  { id: "all", label: "All accounts" },
  { id: "overdue", label: "Overdue" },
  { id: "due_this_week", label: "Due this week" },
  { id: "over_limit", label: "Over limit" },
  { id: "current", label: "Current" },
];

export function AccountsTab() {
  const { data: header } = useDebtBookHeader();
  const { data: accounts } = useDebtAccounts();
  const [statusFilter, setStatusFilter] = useState<DebtAccountSummary["status"] | "all">("all");
  const [bucketFilter, setBucketFilter] = useState<AgeingBucket | null>(null);
  const [search, setSearch] = useState("");

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [paymentFor, setPaymentFor] = useState<DebtAccountSummary | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<DebtAccountSummary | null>(null);
  const [adjustLimitFor, setAdjustLimitFor] = useState<DebtAccountSummary | null>(null);

  const setHold = useSetCustomerHold();
  const logContact = useLogContact();
  const snooze = useSnoozeCustomer();
  const pushToast = useToastStore((s) => s.push);

  const filtered = useMemo(() => {
    let rows = accounts ?? [];
    if (statusFilter !== "all") rows = rows.filter((a) => a.status === statusFilter);
    if (bucketFilter) rows = rows.filter((a) => a.oldestDaysOverdue !== null && ageingBucket(a.oldestDaysOverdue) === bucketFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((a) => a.customer.name.toLowerCase().includes(q) || a.customer.phone.includes(search) || (a.customer.trade ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [accounts, statusFilter, bucketFilter, search]);

  const columns: TableColumn<DebtAccountSummary & { id: string }>[] = [
    {
      key: "customer",
      label: "Customer",
      render: (a) => (
        <div>
          <p className="text-table font-semibold text-ink">
            {a.customer.name}
            {a.hasWriteOff ? <span className="ml-8 rounded bg-rule px-4 py-2 text-micro font-bold uppercase tracking-tracked text-ink-soft">Written off</span> : null}
          </p>
          {a.customer.trade && a.customer.trade !== a.customer.name ? <p className="text-meta text-ink-soft">{a.customer.trade}</p> : null}
        </div>
      ),
      sortValue: (a) => a.customer.name,
    },
    { key: "phone", label: "Phone", render: (a) => <span className="font-mono text-ink-soft">{a.customer.phone}</span> },
    {
      key: "balance",
      label: "Balance",
      numeric: true,
      render: (a) => <Money amount={a.customer.balanceMinor} emphasis={a.customer.balanceMinor > 0 ? "out" : undefined} />,
      sortValue: (a) => a.customer.balanceMinor,
    },
    {
      key: "oldest",
      label: "Oldest unpaid",
      numeric: true,
      render: (a) =>
        a.oldestDaysOverdue === null ? (
          <span className="text-ink-soft">—</span>
        ) : (
          <span className={clsx("font-mono", a.oldestDaysOverdue > 60 ? "text-out" : a.oldestDaysOverdue > 30 ? "text-watch" : "text-ink-soft")}>
            {a.oldestDaysOverdue > 0 ? `${a.oldestDaysOverdue}d overdue` : `due in ${Math.abs(a.oldestDaysOverdue)}d`}
          </span>
        ),
      sortValue: (a) => a.oldestDaysOverdue ?? -9999,
    },
    {
      key: "limit",
      label: "Credit limit",
      render: (a) => {
        const pct = creditLimitUsagePercent(a.customer.balanceMinor, a.customer.creditLimitMinor);
        return (
          <div className="w-full">
            <div className="h-8 w-full overflow-hidden rounded bg-rule">
              <div className={clsx("h-full", pct >= 100 ? "bg-out" : pct >= 75 ? "bg-watch" : "bg-in")} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p className="mt-2 text-micro font-mono text-ink-soft">
              RWF {(a.customer.balanceMinor / 100).toLocaleString()} / {(a.customer.creditLimitMinor / 100).toLocaleString()} · {pct}%
            </p>
          </div>
        );
      },
      sortValue: (a) => creditLimitUsagePercent(a.customer.balanceMinor, a.customer.creditLimitMinor),
    },
    {
      key: "status",
      label: "Status",
      render: (a) => <span className={clsx("rounded px-8 py-4 text-micro font-bold uppercase tracking-tracked", STATUS_CHIP_CLASS[a.status])}>{STATUS_LABEL[a.status]}</span>,
    },
    {
      key: "actions",
      label: "Actions",
      render: (a) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${a.customer.name}`}
              onClick={(e) => e.stopPropagation()}
              className="flex h-control w-control items-center justify-center rounded text-ink-soft hover:text-ink"
            >
              ⋮
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" onClick={(e) => e.stopPropagation()} className="z-40 w-categories rounded border border-rule bg-paper p-4 shadow-shelf">
              <DropdownMenu.Item onSelect={() => setPaymentFor(a)} className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor">
                Take payment
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  logContact.mutate({ customerId: a.customer.id, note: "Reminder sent manually from the account row." });
                  pushToast({ message: `Reminder sent to ${a.customer.name}.` });
                }}
                className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
              >
                Send reminder
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setSelectedAccountId(a.customer.id)} className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor">
                Statement
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  setHold.mutate({ id: a.customer.id, onHold: !a.customer.onHold });
                  pushToast({ message: a.customer.onHold ? `${a.customer.name} taken off hold.` : `${a.customer.name} put on hold.` });
                }}
                className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
              >
                {a.customer.onHold ? "Take off hold" : "Put on hold"}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setAdjustLimitFor(a)} className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor">
                Adjust limit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  snooze.mutate({ customerId: a.customer.id, untilIso: new Date(Date.now() + 7 * 86_400_000).toISOString() });
                  pushToast({ message: `${a.customer.name} snoozed for 7 days.` });
                }}
                className="cursor-pointer rounded px-12 py-8 text-table text-ink outline-none hover:bg-floor"
              >
                Snooze 7 days
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setWriteOffFor(a)} className="cursor-pointer rounded px-12 py-8 text-table text-out outline-none hover:bg-floor">
                Write off debt
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ),
    },
  ];

  const rows = filtered.map((a) => ({ ...a, id: a.customer.id }));

  return (
    <div className="flex flex-col gap-16">
      <div className="rounded border border-rule bg-steel p-24">
        <div className="grid grid-cols-1 gap-24 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Owed to you</p>
            <div className="type-expanded font-display">
              <Money amount={header?.owedToYouMinor ?? minorUnits(0)} size="tally" surface="dark" />
            </div>
            <p className="text-meta text-white/60">across {header?.owedToYouAccountCount ?? 0} accounts</p>
          </div>
          <div>
            <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Overdue</p>
            <div className="type-expanded font-display">
              <Money amount={header?.overdueMinor ?? minorUnits(0)} size="tally" surface="dark" emphasis="out" />
            </div>
            <p className="text-meta text-white/60">
              {header?.overdueAccountCount ?? 0} accounts · oldest {header?.overdueOldestDays ?? 0} days
            </p>
          </div>
          <div>
            <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Due this week</p>
            <div className="type-expanded font-display">
              <Money amount={header?.dueThisWeekMinor ?? minorUnits(0)} size="tally" surface="dark" emphasis="watch" />
            </div>
            <p className="text-meta text-white/60">{header?.dueThisWeekInvoiceCount ?? 0} invoices</p>
          </div>
          <div>
            <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Collected this month</p>
            <div className="type-expanded font-display">
              <Money amount={header?.collectedThisMonthMinor ?? minorUnits(0)} size="tally" surface="dark" emphasis="in" />
            </div>
            <p className="text-meta text-white/60">{header?.collectedThisMonthPercentOfCredit ?? 0}% of the month&apos;s credit sales</p>
          </div>
        </div>

        <div className="mt-24 border-t border-white/10 pt-16">
          <div className="mb-8 flex items-center justify-between">
            <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Ageing of what you&apos;re owed</p>
            <p className="text-micro text-white/60">by days since invoice date</p>
          </div>
          {header ? <AgeingBar totals={header.ageing} selected={bucketFilter} onSelect={setBucketFilter} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-8">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            aria-pressed={statusFilter === f.id}
            className={clsx(
              "h-control shrink-0 rounded border px-12 text-meta font-semibold",
              statusFilter === f.id ? "border-tape-deep bg-tape text-ink" : "border-rule text-ink-soft hover:border-steel",
            )}
          >
            {f.label}
          </button>
        ))}
        <input
          aria-label="Search customer or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or phone…"
          className="ml-auto h-control rounded border border-rule bg-paper px-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
        />
      </div>

      <Table
        columns={columns}
        rows={rows}
        onRowClick={(a) => setSelectedAccountId(a.customer.id)}
        emptyMessage="No accounts match these filters."
        onExportCsv={() => pushToast({ message: "Ageing exported to CSV." })}
      />

      <AccountDrawer customerId={selectedAccountId} onClose={() => setSelectedAccountId(null)} onTakePayment={(a) => setPaymentFor(a)} onWriteOff={(a) => setWriteOffFor(a)} />
      <TakePaymentDrawer account={paymentFor} onClose={() => setPaymentFor(null)} />
      <WriteOffDialog account={writeOffFor} onClose={() => setWriteOffFor(null)} />
      <AdjustLimitDrawer account={adjustLimitFor} onClose={() => setAdjustLimitFor(null)} />
    </div>
  );
}

