"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import { Money } from "../design/Money";
import { EmptyState } from "../design/EmptyState";
import { findSaleByReceipt } from "@/lib/api/sales";
import { useRecordReturn } from "@/lib/queries/sales";
import { useToastStore } from "@/lib/toast-store";
import type { PaymentMethod, Sale } from "@/lib/api/types";
import { useQuery } from "@tanstack/react-query";

const REASONS = ["Wrong item", "Damaged / defective", "Customer changed their mind", "Other"];

/** D.4 Returns & refunds: find sale by receipt -> tick lines+qty -> restock/write-off -> refund method -> reason -> complete. */
export function ReturnsPanel() {
  const [receiptNumber, setReceiptNumber] = useState("");
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [selectedQty, setSelectedQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState(REASONS[0]!);
  const [note, setNote] = useState("");
  const recordReturn = useRecordReturn();
  const pushToast = useToastStore((s) => s.push);

  const { data: sale, isFetching } = useQuery<Sale | undefined>({
    queryKey: ["sale-by-receipt", searchedFor],
    queryFn: () => findSaleByReceipt(searchedFor as string),
    enabled: Boolean(searchedFor),
  });

  function search() {
    setSearchedFor(receiptNumber.trim());
    setSelectedQty({});
    setRestock({});
  }

  async function complete() {
    if (!sale) return;
    const lines = sale.lines
      .filter((l) => selectedQty[l.productId] && Number.parseFloat(selectedQty[l.productId]!) > 0)
      .map((l) => ({ productId: l.productId, qty: selectedQty[l.productId]!, restock: restock[l.productId] ?? true }));
    if (lines.length === 0) return;
    const result = await recordReturn.mutateAsync({ saleId: sale.id, lines, refundMethod, reason, note });
    pushToast({ message: `Return recorded — refunded RWF ${(result.refundMinor / 100).toLocaleString()}` });
    setSearchedFor(null);
    setReceiptNumber("");
  }

  return (
    <div className="flex max-w-form flex-col gap-16">
      <div className="flex items-end gap-8">
        <Input label="Receipt number" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
        <Button variant="secondary" type="button" onClick={search}>
          Find sale
        </Button>
      </div>

      {isFetching ? <p className="text-body text-ink-soft">Looking it up…</p> : null}
      {searchedFor && !isFetching && !sale ? (
        <EmptyState statement={`No sale found with receipt #${searchedFor}.`} />
      ) : null}

      {sale ? (
        <div className="flex flex-col gap-16 rounded border border-rule bg-paper p-16">
          <p className="text-body text-ink">
            Receipt #{sale.receiptNumber} · {sale.customerName ?? "Walk-in"} · <Money amount={sale.totalMinor} />
          </p>
          <table className="w-full border-collapse text-table">
            <thead>
              <tr className="text-left text-micro uppercase tracking-tracked text-ink-soft">
                <th className="py-4">Item</th>
                <th className="py-4">Sold qty</th>
                <th className="py-4">Return qty</th>
                <th className="py-4">Restock?</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((line) => (
                <tr key={line.productId} className="border-t border-rule">
                  <td className="py-8">{line.name}</td>
                  <td className="py-8 font-mono">{line.qty}</td>
                  <td className="py-8">
                    <input
                      aria-label={`Return quantity for ${line.name}`}
                      value={selectedQty[line.productId] ?? ""}
                      onChange={(e) => setSelectedQty((prev) => ({ ...prev, [line.productId]: e.target.value }))}
                      className="h-control w-64 rounded border border-rule bg-paper px-8 text-right font-mono text-ink"
                    />
                  </td>
                  <td className="py-8">
                    <input
                      type="checkbox"
                      aria-label={`Restock ${line.name}`}
                      checked={restock[line.productId] ?? true}
                      onChange={(e) => setRestock((prev) => ({ ...prev, [line.productId]: e.target.checked }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-16">
            <label className="flex flex-col gap-4">
              <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Refund method</span>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
              >
                {(["cash", "momo", "airtel", "bank", "credit"] as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-4">
              <span className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">Reason</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Input label="Notes" value={note} onChange={(e) => setNote(e.target.value)} />

          <Button variant="primary" type="button" onClick={() => void complete()}>
            Complete return
          </Button>
        </div>
      ) : null}
    </div>
  );
}
