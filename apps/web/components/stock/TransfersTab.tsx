"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { EmptyState } from "../design/EmptyState";
import { useProducts } from "@/lib/queries/products";
import { useCreateTransfer, useReceiveTransfer, useTransfers } from "@/lib/queries/stock";
import { LOCATION_ID, LOCATION_ID_2, LOCATION_NAME, LOCATION_NAME_2 } from "@/lib/mock/seed";

const STATUS_LABEL: Record<string, string> = { in_transit: "In transit", received: "Received", discrepancy: "Discrepancy" };

/** D.5.5 — stock leaves the origin immediately into "In transit"; arrives only when the destination confirms receipt. */
export function TransfersTab() {
  const { data: transfers } = useTransfers();
  const { data: products } = useProducts();
  const createTransfer = useCreateTransfer();
  const receiveTransfer = useReceiveTransfer();

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end gap-8 rounded border border-rule bg-paper p-16">
        <select
          aria-label="Product to transfer"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="h-control rounded border border-rule bg-paper px-8 text-table text-ink"
        >
          <option value="">Choose a product</option>
          {(products ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qty"
          aria-label="Transfer quantity"
          className="h-control w-96 rounded border border-rule bg-paper px-8 text-right font-mono text-ink"
        />
        <Button
          variant="primary"
          type="button"
          disabled={!productId || !qty}
          onClick={() =>
            void createTransfer.mutateAsync({ fromLocationId: LOCATION_ID, toLocationId: LOCATION_ID_2, lines: [{ productId, qty }] }).then(() => {
              setProductId("");
              setQty("");
            })
          }
        >
          Send {LOCATION_NAME} → {LOCATION_NAME_2}
        </Button>
      </div>

      {!transfers || transfers.length === 0 ? (
        <EmptyState statement="No transfers yet. Send stock between locations above." />
      ) : (
        <ul className="flex flex-col gap-8">
          {transfers.map((t) => (
            <li key={t.id} className="rounded border border-rule bg-paper p-16">
              <div className="flex items-center justify-between">
                <span className="text-body text-ink">
                  {t.fromLocationName} → {t.toLocationName}
                </span>
                <span className={t.status === "discrepancy" ? "text-out" : t.status === "received" ? "text-in" : "text-watch"}>
                  {STATUS_LABEL[t.status]}
                </span>
              </div>
              <ul className="mt-8 flex flex-col gap-4 text-table">
                {t.lines.map((l) => (
                  <li key={l.productId} className="flex items-center justify-between">
                    <span>
                      {l.productName} — sent {l.qty}
                      {l.receivedQty != null ? `, received ${l.receivedQty}` : ""}
                    </span>
                    {t.status === "in_transit" ? (
                      <div className="flex items-center gap-4">
                        <input
                          aria-label={`Received quantity for ${l.productName}`}
                          defaultValue={l.qty}
                          onChange={(e) => setReceivedQty((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                          className="h-control w-64 rounded border border-rule bg-paper px-8 text-right font-mono text-ink"
                        />
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() =>
                            void receiveTransfer.mutateAsync({
                              transferId: t.id,
                              received: [{ productId: l.productId, qty: receivedQty[l.productId] ?? l.qty }],
                            })
                          }
                        >
                          Confirm receipt
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
