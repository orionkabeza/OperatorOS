"use client";

import { Button } from "../design/Button";
import { useBasketStore } from "@/lib/stores/basket-store";
import { useParkedSales, useResumeParkedSale } from "@/lib/queries/sales";

/** D.4: "parked sales appear as tabs above the basket." */
export function ParkedTabs() {
  const { data: parked } = useParkedSales();
  const resume = useResumeParkedSale();
  const loadParked = useBasketStore((s) => s.loadParked);
  const activeParkedTabId = useBasketStore((s) => s.activeParkedTabId);

  if (!parked || parked.length === 0) return null;

  return (
    <div role="tablist" aria-label="Parked sales" className="scroll-x-safe flex gap-4 border-b border-rule pb-8">
      {parked.map((p) => (
        <Button
          key={p.id}
          variant={activeParkedTabId === p.id ? "primary" : "secondary"}
          type="button"
          onClick={async () => {
            const resumed = await resume.mutateAsync(p.id);
            if (resumed) {
              loadParked(
                resumed.lines.map((l) => ({ ...l, lineId: `line-${crypto.randomUUID()}` })),
                resumed.customerId,
                resumed.id,
              );
            }
          }}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
