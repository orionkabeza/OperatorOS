"use client";

import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Card } from "@/components/design/Card";
import { Money } from "@/components/design/Money";
import { Table, type TableColumn } from "@/components/design/Table";
import { useDebtAccounts } from "@/lib/queries/debt";
import { useBroadcasts, useCreateSegment, useSegments, useSendBroadcast } from "@/lib/queries/debt";
import type { CustomerSegmentFilterSpec, DebtAccountSummary } from "@/lib/api/types";

/** D.6.8 — All customers list + segment builder (saved filters, live member counts) + broadcast composer. */
export function AllCustomersTab() {
  const { data: accounts } = useDebtAccounts();
  const { data: segments } = useSegments();
  const { data: broadcasts } = useBroadcasts();
  const createSegment = useCreateSegment();
  const sendBroadcast = useSendBroadcast();

  const [newSegmentName, setNewSegmentName] = useState("");
  const [newSegmentStatus, setNewSegmentStatus] = useState<DebtAccountSummary["status"] | "">("");
  const [newSegmentMinUsage, setNewSegmentMinUsage] = useState("");

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | "all">("all");
  const [message, setMessage] = useState("");

  const columns: TableColumn<DebtAccountSummary & { id: string }>[] = [
    { key: "name", label: "Customer", render: (a) => a.customer.name, sortValue: (a) => a.customer.name },
    { key: "phone", label: "Phone", render: (a) => <span className="font-mono text-ink-soft">{a.customer.phone}</span> },
    { key: "balance", label: "Balance", numeric: true, render: (a) => <Money amount={a.customer.balanceMinor} />, sortValue: (a) => a.customer.balanceMinor },
    { key: "hold", label: "On hold", render: (a) => (a.customer.onHold ? "Yes" : "No") },
  ];
  const rows = (accounts ?? []).map((a) => ({ ...a, id: a.customer.id }));

  const selectedSegment = segments?.find((s) => s.id === selectedSegmentId);
  const recipientCount = selectedSegmentId === "all" ? (accounts?.length ?? 0) : (selectedSegment?.memberCount ?? 0);

  function buildFilterSpec(): CustomerSegmentFilterSpec {
    const spec: CustomerSegmentFilterSpec = {};
    if (newSegmentStatus) spec.status = newSegmentStatus;
    if (newSegmentMinUsage) spec.minUsagePercent = Number(newSegmentMinUsage);
    return spec;
  }

  return (
    <div className="flex flex-col gap-24">
      <Table columns={columns} rows={rows} emptyMessage="No customers yet." />

      <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
        <Card eyebrow="Segments" title="Saved filters">
          <div className="flex flex-col gap-8">
            {(segments ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded border border-rule px-12 py-8">
                <span className="text-table text-ink">{s.name}</span>
                <span className="text-meta text-ink-soft">{s.memberCount} members</span>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-col gap-8 border-t border-rule pt-16">
            <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">New segment</p>
            <input
              aria-label="Segment name"
              value={newSegmentName}
              onChange={(e) => setNewSegmentName(e.target.value)}
              placeholder="Segment name"
              className="h-control rounded border border-rule bg-paper px-12 text-body text-ink"
            />
            <div className="flex gap-8">
              <select
                aria-label="Status filter"
                value={newSegmentStatus}
                onChange={(e) => setNewSegmentStatus(e.target.value as DebtAccountSummary["status"] | "")}
                className="h-control flex-1 rounded border border-rule bg-paper px-8 text-table text-ink"
              >
                <option value="">Any status</option>
                <option value="current">Current</option>
                <option value="due_this_week">Due this week</option>
                <option value="overdue">Overdue</option>
                <option value="over_limit">Over limit</option>
              </select>
              <input
                aria-label="Minimum credit-limit usage percent"
                inputMode="numeric"
                value={newSegmentMinUsage}
                onChange={(e) => setNewSegmentMinUsage(e.target.value)}
                placeholder="Min usage %"
                className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-table text-ink"
              />
            </div>
            <Button
              variant="secondary"
              disabled={!newSegmentName.trim()}
              disabledReason="Name the segment before saving it."
              onClick={() => {
                createSegment.mutate({ name: newSegmentName, filterSpec: buildFilterSpec() });
                setNewSegmentName("");
                setNewSegmentStatus("");
                setNewSegmentMinUsage("");
              }}
            >
              Save segment
            </Button>
          </div>
        </Card>

        <Card eyebrow="Broadcast" title="Send a message">
          <div className="flex flex-col gap-8">
            <select
              aria-label="Segment to send to"
              value={selectedSegmentId}
              onChange={(e) => setSelectedSegmentId(e.target.value)}
              className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
            >
              <option value="all">All customers</option>
              {(segments ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Broadcast message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. New shipment of cement and rebar just arrived — come see us this week!"
              rows={3}
              className="rounded border border-rule bg-paper p-12 text-body text-ink"
            />
            <p className="text-meta text-ink-soft">Will send to {recipientCount} recipients.</p>
            <Button
              variant="primary"
              disabled={!message.trim() || recipientCount === 0}
              disabledReason={!message.trim() ? "Write a message first." : "This segment has no members."}
              onClick={() => {
                sendBroadcast.mutate({ segmentId: selectedSegmentId === "all" ? null : selectedSegmentId, message });
                setMessage("");
              }}
            >
              Send to {recipientCount}
            </Button>
          </div>

          {broadcasts && broadcasts.length > 0 ? (
            <div className="mt-16 flex flex-col gap-8 border-t border-rule pt-16">
              <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Recent broadcasts</p>
              {broadcasts.slice(0, 5).map((b) => (
                <div key={b.id} className="rounded border border-rule p-12 text-table">
                  <p className="text-ink">{b.message}</p>
                  <p className="mt-4 text-meta text-ink-soft">
                    {b.segmentName} · {b.recipientCount} sent · {b.deliveredCount} delivered · {b.readCount} read
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
