"use client";

import clsx from "clsx";
import { useState } from "react";
import { Money } from "@/components/design/Money";
import { Table, type TableColumn } from "@/components/design/Table";
import { useMoneyLocations, useMoneyMovements } from "@/lib/queries/cashbox";
import type { MoneyMovement, MoneyMovementType } from "@/lib/api/types";

const TYPE_LABELS: Record<MoneyMovementType, string> = {
  sale: "Sale",
  payment_received: "Payment received",
  expense: "Expense",
  transfer: "Transfer",
  manual_adjustment: "Manual adjustment",
};

/** D.7.2 — money movements table, filterable by date/type/location/user. */
export function MovementsTab() {
  const { data: locations } = useMoneyLocations();
  const [accountKey, setAccountKey] = useState("");
  const [type, setType] = useState<MoneyMovementType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: movements } = useMoneyMovements({
    accountKey: accountKey || undefined,
    type: type || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const users = Array.from(new Map((movements ?? []).map((m) => [m.userId, m.userName])).entries());
  const [userId, setUserId] = useState("");
  const rows = (movements ?? []).filter((m) => !userId || m.userId === userId);

  const columns: TableColumn<MoneyMovement>[] = [
    { key: "date", label: "Date", render: (m) => new Date(m.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
    { key: "account", label: "Account", render: (m) => m.accountDisplayName },
    { key: "type", label: "Type", render: (m) => TYPE_LABELS[m.type] },
    {
      key: "amount",
      label: "Amount",
      numeric: true,
      render: (m) => <Money amount={m.amountMinor} emphasis={m.amountMinor < 0 ? "out" : m.amountMinor > 0 ? "in" : undefined} />,
      sortValue: (m) => m.amountMinor,
    },
    { key: "balanceAfter", label: "Balance after", numeric: true, render: (m) => <Money amount={m.balanceAfterMinor} />, sortValue: (m) => m.balanceAfterMinor },
    { key: "user", label: "User", render: (m) => m.userName },
    { key: "reference", label: "Reference", render: (m) => <span className={clsx("text-meta text-ink-soft")}>{m.reference ?? "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center gap-8">
        <select aria-label="Filter by location" value={accountKey} onChange={(e) => setAccountKey(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink">
          <option value="">All locations</option>
          {(locations ?? []).map((l) => (
            <option key={l.accountKey} value={l.accountKey}>
              {l.displayName}
            </option>
          ))}
        </select>
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as MoneyMovementType | "")} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by user" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink">
          <option value="">All users</option>
          {users.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-4 text-meta text-ink-soft">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink" />
        </label>
        <label className="flex items-center gap-4 text-meta text-ink-soft">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-control rounded border border-rule bg-paper px-8 text-table text-ink" />
        </label>
      </div>

      <Table columns={columns} rows={rows.map((m) => ({ ...m }))} emptyMessage="No money movements match these filters." />
    </div>
  );
}
