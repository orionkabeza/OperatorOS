"use client";

import { minorUnits } from "@operatoros/shared";
import { useState } from "react";
import { Button } from "../design/Button";
import { Card } from "../design/Card";
import { Input } from "../design/Input";
import { useApprovalThreshold, useSetApprovalThreshold } from "@/lib/queries/expenses";
import { useConnectMomo, useDisconnectMomo, useMomoConnection } from "@/lib/queries/momo";
import { useToastStore } from "@/lib/toast-store";

/**
 * Back Office additions (D.7/D.6.5 per docs/plans/phase-2.md §4): MoMo
 * "Connect now" against the sandbox provider, the expense approval
 * threshold setting. The reminder schedule/template editor is genuinely
 * heavy (merge-field live preview) and already lives at Debt Book →
 * Reminder schedule, code-split there — linked from here rather than
 * duplicated, since Back Office has no per-room settings sub-nav yet
 * (Phase 1 built Back Office as analytics-only).
 */
export function SettingsTab() {
  const { data: connection } = useMomoConnection();
  const connectMomo = useConnectMomo();
  const disconnectMomo = useDisconnectMomo();
  const [merchantCode, setMerchantCode] = useState("");
  const pushToast = useToastStore((s) => s.push);

  const { data: threshold } = useApprovalThreshold();
  const setThreshold = useSetApprovalThreshold();
  const [thresholdMajor, setThresholdMajor] = useState("");

  return (
    <div className="flex max-w-form flex-col gap-16">
      <Card eyebrow="Mobile money" title="MoMo provider connection">
        {connection?.status === "connected" ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body text-ink">
                Connected — {connection.provider.toUpperCase()} merchant {connection.merchantCode}
              </p>
              <p className="text-meta text-ink-soft">Running against the sandbox provider (docs/DECISIONS.md) — real credentials swap in without any screen changes.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                disconnectMomo.mutate(undefined, { onSuccess: () => pushToast({ message: "MoMo disconnected." }) });
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <p className="text-body text-ink-soft">Not connected. Connecting here activates the sandbox provider used by pay links and payment requests.</p>
            <div className="flex gap-8">
              <Input label="Merchant code" value={merchantCode} onChange={(e) => setMerchantCode(e.target.value)} placeholder="e.g. 774411" />
              <Button
                variant="primary"
                onClick={() => {
                  connectMomo.mutate(merchantCode || "774411", { onSuccess: () => pushToast({ message: "MoMo connected (sandbox)." }) });
                }}
              >
                Connect now
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card eyebrow="Expenses" title="Approval threshold">
        <p className="mb-8 text-body text-ink-soft">Expenses at or above this amount need manager approval before they post.</p>
        <div className="flex items-end gap-8">
          <Input label="Threshold" money value={thresholdMajor || (threshold !== undefined ? String(threshold / 100) : "")} onChange={(e) => setThresholdMajor(e.target.value)} />
          <Button
            variant="secondary"
            onClick={() => {
              const minor = minorUnits(Math.round((Number.parseFloat(thresholdMajor) || 0) * 100));
              setThreshold.mutate(minor, { onSuccess: () => pushToast({ message: "Approval threshold updated." }) });
              setThresholdMajor("");
            }}
          >
            Save
          </Button>
        </div>
      </Card>

      <Card eyebrow="Reminders" title="Reminder schedule & templates">
        <p className="text-body text-ink-soft">Manage the reminder sequence, quiet hours, and message templates from Debt Book → Reminder schedule.</p>
      </Card>
    </div>
  );
}
