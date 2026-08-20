"use client";

import { minorUnits } from "@operatoros/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/design/Button";
import { Drawer } from "@/components/design/Drawer";
import { Input } from "@/components/design/Input";
import { Money } from "@/components/design/Money";
import { useSetCustomerCreditLimit } from "@/lib/queries/customers";
import { useToastStore } from "@/lib/toast-store";
import type { DebtAccountSummary } from "@/lib/api/types";

/** D.6 row action — "Adjust limit." */
export function AdjustLimitDrawer({ account, onClose }: { account: DebtAccountSummary | null; onClose: () => void }) {
  const [limitMajor, setLimitMajor] = useState("");
  const setLimit = useSetCustomerCreditLimit();
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (account) setLimitMajor(String(account.customer.creditLimitMinor / 100));
  }, [account]);

  if (!account) return null;

  const newLimitMinor = minorUnits(Math.round((Number.parseFloat(limitMajor) || 0) * 100));
  const belowBalance = newLimitMinor < account.customer.balanceMinor;

  return (
    <Drawer
      open={Boolean(account)}
      onOpenChange={(next) => !next && onClose()}
      title={`Adjust credit limit — ${account.customer.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setLimit.mutate(
                { id: account.customer.id, creditLimitMinor: newLimitMinor },
                { onSuccess: () => pushToast({ message: `Credit limit updated to RWF ${(newLimitMinor / 100).toLocaleString()}.` }) },
              );
              onClose();
            }}
          >
            Save limit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-16">
        <div className="flex items-center justify-between text-body">
          <span className="text-ink-soft">Current balance</span>
          <Money amount={account.customer.balanceMinor} />
        </div>
        <Input label="New credit limit" money inputMode="decimal" value={limitMajor} onChange={(e) => setLimitMajor(e.target.value)} />
        {belowBalance ? (
          <p role="alert" className="text-meta text-watch">
            This is below the customer&apos;s current balance — they&apos;ll show as over limit immediately.
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
