"use client";

import { minorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Card } from "@/components/design/Card";
import { Drawer } from "@/components/design/Drawer";
import { Input } from "@/components/design/Input";
import { Money } from "@/components/design/Money";
import { useMoneyLocations, useUpdateMoneyLocationBalance } from "@/lib/queries/cashbox";
import type { MoneyLocation } from "@/lib/api/types";
import { useToastStore } from "@/lib/toast-store";

function syncedLabel(location: MoneyLocation): string {
  if (location.connectionStatus === "manual") return "Manual";
  if (!location.lastSyncedAt) return "Not synced yet";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(location.lastSyncedAt).getTime()) / 60_000));
  return `Synced ${minutes} min ago`;
}

/** D.7.1 — balances band: a card per money location, today's movement, sync/manual stamp, and "Update balance." */
export function BalancesTab() {
  const { data: locations } = useMoneyLocations();
  const updateBalance = useUpdateMoneyLocationBalance();
  const pushToast = useToastStore((s) => s.push);
  const [updating, setUpdating] = useState<MoneyLocation | null>(null);
  const [countedMajor, setCountedMajor] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-col gap-16">
      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
        {(locations ?? []).map((loc) => (
          <Card key={loc.accountKey} eyebrow={loc.kind.toUpperCase()} title={loc.displayName}>
            <Money amount={loc.balanceMinor} size="card-title" />
            <p className="mt-4 text-meta text-ink-soft">
              Today: <Money amount={loc.todaysMovementMinor} emphasis={loc.todaysMovementMinor < 0 ? "out" : loc.todaysMovementMinor > 0 ? "in" : undefined} />
            </p>
            <div className="mt-12 flex items-center justify-between">
              <span className="text-meta text-ink-soft">{syncedLabel(loc)}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  setUpdating(loc);
                  setCountedMajor(String(loc.balanceMinor / 100));
                  setReason("");
                }}
              >
                Update balance
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Drawer
        open={Boolean(updating)}
        onOpenChange={(next) => !next && setUpdating(null)}
        title={updating ? `Update balance — ${updating.displayName}` : "Update balance"}
        footer={
          updating ? (
            <>
              <Button variant="secondary" onClick={() => setUpdating(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const counted = minorUnits(Math.round((Number.parseFloat(countedMajor) || 0) * 100));
                  updateBalance.mutate(
                    { accountKey: updating.accountKey, countedMinor: counted, reason: reason || undefined },
                    { onSuccess: () => pushToast({ message: `${updating.displayName} balance updated.` }) },
                  );
                  setUpdating(null);
                }}
              >
                Save
              </Button>
            </>
          ) : null
        }
      >
        {updating ? (
          <div className="flex flex-col gap-16">
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-soft">Current recorded balance</span>
              <Money amount={updating.balanceMinor} />
            </div>
            <Input label="Counted balance" money inputMode="decimal" value={countedMajor} onChange={(e) => setCountedMajor(e.target.value)} />
            <label className="flex flex-col gap-4">
              <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Reason (optional)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Bank statement reconciled this morning"
                className="h-control rounded border border-rule bg-paper px-12 text-body text-ink"
              />
            </label>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
