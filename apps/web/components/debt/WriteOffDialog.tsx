"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/design/ConfirmDialog";
import { WRITE_OFF_TYPED_CONFIRMATION_THRESHOLD_MINOR } from "@/lib/constants";
import { useWriteOffDebt } from "@/lib/queries/debt";
import { useToastStore } from "@/lib/toast-store";
import type { DebtAccountSummary } from "@/lib/api/types";

/**
 * D.6.4 write-off flow: reason required always, typed-name confirmation
 * above WRITE_OFF_TYPED_CONFIRMATION_THRESHOLD_MINOR. Reuses ConfirmDialog's
 * `typedConfirmation` gate exactly as demonstrated in app/design/page.tsx,
 * now with a required reason field via ConfirmDialog's new `children`/
 * `confirmDisabled` slot (components/design/ConfirmDialog.tsx) — a genuine
 * gap found while building this: no existing confirm flow needed a field
 * inside the dialog before Phase 2.
 */
export function WriteOffDialog({ account, onClose }: { account: DebtAccountSummary | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const writeOff = useWriteOffDebt();
  const pushToast = useToastStore((s) => s.push);

  if (!account) return null;

  const amountMinor = account.customer.balanceMinor;
  const aboveThreshold = amountMinor >= WRITE_OFF_TYPED_CONFIRMATION_THRESHOLD_MINOR;
  const reasonReady = reason.trim().length > 0;

  function handleClose() {
    setReason("");
    onClose();
  }

  return (
    <ConfirmDialog
      open={Boolean(account)}
      onOpenChange={(next) => !next && handleClose()}
      title="Write off this debt?"
      message={`This writes off RWF ${(amountMinor / 100).toLocaleString()} owed by ${account.customer.name}. It cannot be undone, and it will show in your reports as a loss.`}
      confirmLabel="Write off debt"
      typedConfirmation={aboveThreshold ? account.customer.name : undefined}
      confirmDisabled={!reasonReady}
      onConfirm={() => {
        writeOff.mutate(
          { customerId: account.customer.id, amountMinor, reason, typedConfirmationName: aboveThreshold ? account.customer.name : undefined },
          {
            onSuccess: () => pushToast({ message: `RWF ${(amountMinor / 100).toLocaleString()} written off for ${account.customer.name}.` }),
            onError: (err) => pushToast({ message: err instanceof Error ? err.message : "Could not write off this debt." }),
          },
        );
        setReason("");
      }}
    >
      <label className="flex flex-col gap-4">
        <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Reason (required)</span>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Customer's shop closed, uncollectable"
          className="h-control rounded border border-rule bg-paper px-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
        />
      </label>
    </ConfirmDialog>
  );
}
