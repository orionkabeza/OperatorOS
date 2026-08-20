"use client";

import { minorUnits } from "@operatoros/shared";
import * as Tabs from "@radix-ui/react-tabs";
import clsx from "clsx";
import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Drawer } from "@/components/design/Drawer";
import { Money } from "@/components/design/Money";
import { useCustomer } from "@/lib/queries/customers";
import { useContactLog, useDebtAccounts, useInvoices, useLogContact, useStatement } from "@/lib/queries/debt";
import type { DebtAccountSummary, Invoice } from "@/lib/api/types";

function invoiceChip(invoice: Invoice): { label: string; className: string } {
  if (invoice.status === "paid") return { label: "PAID", className: "bg-in text-white" };
  const days = Math.floor((Date.now() - new Date(invoice.dueDateAt).getTime()) / 86_400_000);
  if (days > 0) return { label: `OVERDUE ${days}D`, className: "bg-out text-white" };
  return { label: `DUE IN ${Math.abs(days)}D`, className: "bg-watch text-white" };
}

export function AccountDrawer({
  customerId,
  onClose,
  onTakePayment,
  onWriteOff,
}: {
  customerId: string | null;
  onClose: () => void;
  onTakePayment: (account: DebtAccountSummary) => void;
  onWriteOff: (account: DebtAccountSummary) => void;
}) {
  const [tab, setTab] = useState<"statement" | "invoices" | "contact" | "settings">("statement");
  const { data: customer } = useCustomer(customerId);
  const { data: accounts } = useDebtAccounts();
  const { data: statement } = useStatement(customerId);
  const { data: invoices } = useInvoices(customerId);
  const { data: contactLog } = useContactLog(customerId);
  const logContact = useLogContact();
  const [note, setNote] = useState("");

  const account = accounts?.find((a) => a.customer.id === customerId) ?? null;
  const overduePortion = invoices?.filter((i) => i.status !== "paid" && new Date(i.dueDateAt) < new Date()).reduce((s, i) => s + i.remainingMinor, 0) ?? 0;

  return (
    <Drawer open={Boolean(customerId)} onOpenChange={(next) => !next && onClose()} title={customer?.name ?? ""} size="detail">
      {customer && account ? (
        <div className="flex flex-col gap-16">
          <div className="rounded bg-steel p-16">
            <p className="text-body text-white">
              {customer.trade && customer.trade !== customer.name ? `${customer.trade} · ` : ""}
              {customer.phone}
            </p>
            <div className="mt-12 flex flex-wrap items-end justify-between gap-16">
              <div className="flex gap-24">
                <div>
                  <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Balance owing</p>
                  <Money amount={customer.balanceMinor} size="card-title" surface="dark" emphasis={customer.balanceMinor > 0 ? "out" : undefined} />
                </div>
                {overduePortion > 0 ? (
                  <div>
                    <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">Overdue portion</p>
                    <Money amount={minorUnits(overduePortion)} size="body" surface="dark" emphasis="out" />
                  </div>
                ) : null}
              </div>
              <div className="flex gap-8">
                <Button variant="secondary" onClick={() => onTakePayment(account)}>
                  Record payment
                </Button>
              </div>
            </div>
          </div>

          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <Tabs.List aria-label="Account detail sections" className="flex gap-4 border-b border-rule">
              {(["statement", "invoices", "contact", "settings"] as const).map((t) => (
                <Tabs.Trigger
                  key={t}
                  value={t}
                  className="border-b-2 border-transparent px-12 py-8 text-table font-semibold capitalize text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
                >
                  {t === "contact" ? "Contact history" : t}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="statement" className="flex flex-col gap-8 pt-16">
              <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Running statement</p>
              {!statement || statement.length === 0 ? (
                <p className="text-meta text-ink-soft">No activity yet.</p>
              ) : (
                <table className="w-full border-collapse text-table">
                  <thead>
                    <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                      <th className="py-4">Date</th>
                      <th className="py-4">Ref</th>
                      <th className="py-4">Detail</th>
                      <th className="py-4 text-right">Taken on credit</th>
                      <th className="py-4 text-right">Paid</th>
                      <th className="py-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.map((s) => (
                      <tr key={s.id} className="border-t border-rule">
                        <td className="py-4">{new Date(s.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                        <td className="py-4 font-mono text-meta text-ink-soft">{s.ref}</td>
                        <td className="py-4">{s.detail}</td>
                        <td className="py-4 text-right font-mono">{s.debitMinor > 0 ? <span className="text-out">{(s.debitMinor / 100).toLocaleString()}</span> : "—"}</td>
                        <td className="py-4 text-right font-mono">{s.creditMinor > 0 ? <span className="text-in">{(s.creditMinor / 100).toLocaleString()}</span> : "—"}</td>
                        <td className="py-4 text-right font-mono">{(s.runningBalanceMinor / 100).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-8 text-meta text-ink-soft">Signed for at the counter by the buyer each time — the paper book stays in the drawer as backup.</p>
            </Tabs.Content>

            <Tabs.Content value="invoices" className="flex flex-col gap-8 pt-16">
              {!invoices || invoices.length === 0 ? (
                <p className="text-meta text-ink-soft">No invoices on this account.</p>
              ) : (
                <table className="w-full border-collapse text-table">
                  <thead>
                    <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                      <th className="py-4">Invoice</th>
                      <th className="py-4">Issued</th>
                      <th className="py-4">Due</th>
                      <th className="py-4 text-right">Total</th>
                      <th className="py-4 text-right">Outstanding</th>
                      <th className="py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const chip = invoiceChip(inv);
                      return (
                        <tr key={inv.id} className="border-t border-rule">
                          <td className="py-4 font-mono">{inv.invoiceNumber}</td>
                          <td className="py-4">{new Date(inv.issuedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                          <td className="py-4">{new Date(inv.dueDateAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                          <td className="py-4 text-right font-mono">{(inv.totalMinor / 100).toLocaleString()}</td>
                          <td className="py-4 text-right font-mono">{inv.remainingMinor > 0 ? (inv.remainingMinor / 100).toLocaleString() : "—"}</td>
                          <td className="py-4">
                            <span className={clsx("rounded px-8 py-4 text-micro font-bold uppercase tracking-tracked", chip.className)}>{chip.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Tabs.Content>

            <Tabs.Content value="contact" className="flex flex-col gap-12 pt-16">
              <div className="flex gap-8">
                <input
                  aria-label="Log a call or note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Log a call or note…"
                  className="h-control flex-1 rounded border border-rule bg-paper px-12 text-body text-ink"
                />
                <Button
                  variant="secondary"
                  disabled={!note.trim()}
                  disabledReason="Write a note before logging it."
                  onClick={() => {
                    if (!customerId) return;
                    logContact.mutate({ customerId, note });
                    setNote("");
                  }}
                >
                  Log
                </Button>
              </div>
              {!contactLog || contactLog.length === 0 ? (
                <p className="text-meta text-ink-soft">No contact recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-8">
                  {contactLog.map((c) => (
                    <li key={c.id} className="rounded border border-rule p-12 text-table">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize text-ink">{c.channel.replace("_", " ")}</span>
                        <span className="text-meta text-ink-soft">{new Date(c.sentAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {c.note ? <p className="mt-4 text-body text-ink-soft">{c.note}</p> : null}
                      {c.delivered !== null ? (
                        <p className="mt-4 text-meta text-ink-soft">
                          {c.delivered ? "Delivered" : "Not delivered"}
                          {c.read !== null ? ` · ${c.read ? "Read" : "Unread"}` : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Tabs.Content>

            <Tabs.Content value="settings" className="flex flex-col gap-16 pt-16">
              <div className="grid grid-cols-2 gap-8 text-table">
                <span className="text-ink-soft">Payment terms</span>
                <span className="text-ink">{customer.termsDays} days</span>
                <span className="text-ink-soft">Credit limit</span>
                <Money amount={customer.creditLimitMinor} />
                <span className="text-ink-soft">Account status</span>
                <span className="text-ink">{customer.onHold ? "On hold" : "Active"}</span>
              </div>
              <div className="flex gap-8">
                <Button variant="secondary" onClick={() => onWriteOff(account)}>
                  Write off debt
                </Button>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      ) : null}
    </Drawer>
  );
}
