"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { EmptyState } from "../design/EmptyState";
import { useProducts } from "@/lib/queries/products";
import { useCreateTransfer, useReceiveTransfer, useTransferLocations, useTransfers } from "@/lib/queries/stock";

const STATUS_LABEL: Record<string, string> = { in_transit: "In transit", received: "Received", discrepancy: "Discrepancy" };

/** D.5.5 — stock leaves the origin immediately into "In transit"; arrives only when the destination confirms receipt. */
export function TransfersTab() {
  const { data: transfers } = useTransfers();
  const { data: products } = useProducts();
  // Locations come from the API layer rather than lib/mock/seed -- sending
  // demo location ids to a real backend is what broke day-open, and the
  // demo branch names would have been shown to a business that has neither.
  const { data: locations, isError: locationsUnavailable } = useTransferLocations();
  const [from, to] = locations ?? [];
  const createTransfer = useCreateTransfer();
  const receiveTransfer = useReceiveTransfer();

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});

  if (locationsUnavailable || (locations && locations.length < 2)) {
    return (
      <EmptyState statement="Transfers move stock between two of your shops. This build can't list your locations yet, so there's nothing to transfer between — ask an owner to move stock with a stock adjustment for now." />
    );
  }

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
          disabled={!productId || !qty || !from || !to}
          onClick={() => {
            // Still loading, or fewer than two locations -- the button is
            // disabled in both cases, but narrow explicitly rather than
            // asserting: sending an undefined location id is precisely the
            // class of bug this whole boundary exists to prevent.
            if (!from || !to) return;
            void createTransfer.mutateAsync({ fromLocationId: from.id, toLocationId: to.id, lines: [{ productId, qty }] }).then(() => {
              setProductId("");
              setQty("");
            });
          }}
        >
          Send {from?.name} → {to?.name}
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
