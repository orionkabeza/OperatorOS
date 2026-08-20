"use client";

import { Button } from "../design/Button";
import { Money } from "../design/Money";
import { EmptyState } from "../design/EmptyState";
import { useQuotes } from "@/lib/queries/sales";
import { useBasketStore } from "@/lib/stores/basket-store";
import { useToastStore } from "@/lib/toast-store";

const STATUS_LABEL: Record<string, string> = { open: "Open", accepted: "Accepted", expired: "Expired", converted: "Converted" };

/** D.4 Quotes: list with statuses; "Convert to sale" reopens the basket. */
export function QuotesPanel() {
  const { data: quotes } = useQuotes();
  const loadParked = useBasketStore((s) => s.loadParked);
  const pushToast = useToastStore((s) => s.push);

  if (!quotes || quotes.length === 0) {
    return <EmptyState statement="No quotes yet. Save a basket as a quote from the Counter to see it here." />;
  }

  return (
    <table className="w-full max-w-form border-collapse text-table">
      <thead>
        <tr className="border-b border-rule text-left text-micro uppercase tracking-tracked text-ink-soft">
          <th className="py-8">Quote</th>
          <th className="py-8">Customer</th>
          <th className="py-8 text-right">Total</th>
          <th className="py-8">Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {quotes.map((q) => (
          <tr key={q.id} className="border-b border-rule">
            <td className="py-8 font-mono">{q.quoteNumber}</td>
            <td className="py-8">{q.customerName ?? "Walk-in"}</td>
            <td className="py-8 text-right">
              <Money amount={q.totalMinor} />
            </td>
            <td className="py-8">{STATUS_LABEL[q.status]}</td>
            <td className="py-8 text-right">
              {q.status === "open" ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    loadParked(
                      q.lines.map((l) => ({ ...l, lineId: `line-${crypto.randomUUID()}` })),
                      q.customerId,
                      "",
                    );
                    pushToast({ message: `Quote ${q.quoteNumber} loaded into the basket — prices refreshed to today's.` });
                  }}
                >
                  Convert to sale
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
