"use client";

import { useState } from "react";
import { minorUnits } from "@operatoros/shared";
import { Button } from "@/components/design/Button";
import { Card } from "@/components/design/Card";
import { ConfirmDialog } from "@/components/design/ConfirmDialog";
import { Drawer } from "@/components/design/Drawer";
import { EmptyState } from "@/components/design/EmptyState";
import { Input } from "@/components/design/Input";
import { Money } from "@/components/design/Money";
import { Qty } from "@/components/design/Qty";
import { Table } from "@/components/design/Table";
import { useToastStore } from "@/lib/toast-store";
import { TallyRail } from "@/components/shell/TallyRail";

interface DemoRow {
  id: string;
  name: string;
  sku: string;
  onHand: number;
  value: number;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", name: "Cement CIMERWA 50kg", sku: "CEM-050", onHand: 240, value: 2_832_000_00 },
  { id: "2", name: "Rebar 12mm × 12m", sku: "RB-12", onHand: 0, value: 0 },
  { id: "3", name: "PVC pipe 110mm × 3m", sku: "PVC-110", onHand: 54, value: 529_200_00 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-16">
      <h2 className="type-expanded font-display text-section-head font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignRoute() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  return (
    <div className="min-h-screen bg-floor">
      <div className="mx-auto flex max-w-4xl flex-col gap-48 p-16 md:p-32">
        <div>
          <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
            OperatorOS
          </p>
          <h1 className="type-expanded font-display text-screen-title font-bold text-ink">
            Design system
          </h1>
          <p className="mt-8 max-w-prose text-body text-ink-soft">
            Every token and component from OperatorOS-Spec.md Part B, built for real — not a
            screenshot. Visit <code className="font-mono">/</code> for the Shutter sign-in.
          </p>
        </div>

        <Section title="Tally Rail">
          <div className="overflow-hidden rounded border border-rule">
            <TallyRail activeKey="credit" />
          </div>
        </Section>

        <Section title="Money & Qty">
          <div className="flex flex-wrap items-end gap-24">
            <Money amount={minorUnits(1_240_500_00)} size="tally" />
            <Money amount={minorUnits(-340_000_00)} size="card-title" />
            <Money amount={minorUnits(0)} size="body" />
            <Qty value={42} unit="bags" />
            <Qty value={0} tone="zero" unit="in stock" />
            <Qty value={4} tone="low" unit="left" />
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-12">
            <Button variant="primary">Record sale</Button>
            <Button variant="secondary">Save as quote</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Write off debt
            </Button>
            <Button variant="ghost">Clear</Button>
            <Button variant="primary" disabled disabledReason="Open the shop before selling.">
              Take payment
            </Button>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="flex max-w-sm flex-col gap-16">
            <Input label="Customer name" placeholder="Jean Bosco Habimana" />
            <Input label="Amount" money placeholder="0" />
            <Input label="Phone number" error="That number doesn't look right — check the digits." />
          </div>
        </Section>

        <Section title="Card & Empty state">
          <Card eyebrow="Debt Book" title="Owed to you">
            <Money amount={minorUnits(4_120_000_00)} size="card-title" />
          </Card>
          <EmptyState
            statement="No one owes you anything right now. When you sell on credit from the Counter, it lands here."
            actionLabel="Record a credit sale"
            onAction={() => pushToast({ message: "Credit sale recorded.", onUndo: () => {} })}
          />
        </Section>

        <Section title="Table">
          <Table
            columns={[
              { key: "name", label: "Product", render: (r) => r.name },
              { key: "sku", label: "SKU", render: (r) => r.sku, sortValue: (r) => r.sku },
              {
                key: "onHand",
                label: "On hand",
                numeric: true,
                render: (r) => <Qty value={r.onHand} tone={r.onHand === 0 ? "zero" : "normal"} />,
                sortValue: (r) => r.onHand,
              },
              {
                key: "value",
                label: "Value on hand",
                numeric: true,
                render: (r) => <Money amount={minorUnits(r.value)} />,
                sortValue: (r) => r.value,
              },
            ]}
            rows={DEMO_ROWS}
            onRowClick={() => setDrawerOpen(true)}
            onExportCsv={() => pushToast({ message: "Exported to CSV." })}
          />
        </Section>

        <Section title="Drawer & Confirm dialog">
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
        </Section>
      </div>

      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Cement CIMERWA 50kg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Close
            </Button>
            <Button variant="primary">Adjust stock</Button>
          </>
        }
      >
        <p className="text-body text-ink-soft">
          Detail drawers slide from the right and never navigate away from the underlying table —
          this is a placeholder body for the design showcase.
        </p>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Write off this debt?"
        message="This writes off RWF 340,000 owed by Kigali Builders Ltd. It cannot be undone, and it will show in your reports as a loss."
        confirmLabel="Write off debt"
        typedConfirmation="Kigali Builders Ltd"
        onConfirm={() => pushToast({ message: "Debt written off." })}
      />

    </div>
  );
}
