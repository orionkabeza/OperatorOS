"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { payStyle } from "@/lib/data";
import type { Order } from "@/lib/types";

interface OrderDetailSheetProps {
  order: Order | null;
  cur: (n: number) => string;
  onChanged: () => void | Promise<void>;
}

export default function OrderDetailSheet({ order, cur, onChanged }: OrderDetailSheetProps) {
  const [busy, setBusy] = useState<"primary" | "momo" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!order) return null;

  const p = payStyle(order.pay);
  const lines = order.items.replace("Office tray: ", "").split(", ");
  const primary = order.pay === "paid" ? "Mark as delivered" : "Confirm payment received";

  async function runPrimary() {
    if (!order) return;
    setBusy("primary");
    setActionError(null);
    try {
      if (order.pay === "paid") {
        await api.markDelivered(order.id);
      } else {
        await api.confirmPayment(order.id);
      }
      await onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  async function runMomoRequest() {
    if (!order) return;
    setBusy("momo");
    setActionError(null);
    try {
      await api.requestMomoPayment(order.id);
      await onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "MoMo request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-0.02em" }}>{order.name}</div>
      <div className="mono" style={{ fontSize: 12, color: "oklch(0.58 0.01 150)", marginTop: 3 }}>
        {order.phone} · {order.meta}
      </div>

      <div
        style={{
          marginTop: 16,
          background: "oklch(1 0 0)",
          border: "1px solid oklch(0.91 0.008 120)",
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        {lines.map((what, i) => (
          <div
            key={i}
            style={{
              padding: "12px 15px",
              fontSize: 14,
              color: "oklch(0.32 0.012 150)",
              borderTop: "1px solid oklch(0.94 0.006 120)",
            }}
          >
            {what}
          </div>
        ))}
        <div
          style={{
            padding: "13px 15px",
            display: "flex",
            borderTop: "1px solid oklch(0.91 0.008 120)",
            background: "oklch(0.982 0.004 120)",
          }}
        >
          <span style={{ flex: 1, fontSize: 14, fontWeight: 650 }}>Total</span>
          <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
            {cur(order.total)}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 18, background: p.bg, color: p.fg }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{p.headline}</div>
        <div className="mono" style={{ fontSize: 12, marginTop: 5, opacity: 0.85 }}>
          {order.ref}
        </div>
      </div>

      {actionError ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 12,
            background: "oklch(0.95 0.05 30)",
            color: "oklch(0.47 0.11 28)",
            fontSize: 13,
          }}
        >
          {actionError}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          onClick={runPrimary}
          disabled={busy !== null}
          style={{
            minHeight: 46,
            borderRadius: 14,
            background: "oklch(0.52 0.11 155)",
            color: "oklch(0.99 0.01 155)",
            fontSize: 14.5,
            fontWeight: 620,
            opacity: busy === "primary" ? 0.7 : 1,
          }}
        >
          {busy === "primary" ? "Working…" : primary}
        </button>
        {order.pay === "unpaid" || order.pay === "awaiting" ? (
          <button
            onClick={runMomoRequest}
            disabled={busy !== null}
            style={{
              minHeight: 46,
              borderRadius: 14,
              border: "1px solid oklch(0.89 0.008 120)",
              background: "oklch(1 0 0)",
              color: "oklch(0.3 0.012 150)",
              fontSize: 14.5,
              fontWeight: 600,
              opacity: busy === "momo" ? 0.7 : 1,
            }}
          >
            {busy === "momo" ? "Sending…" : "Send MoMo request"}
          </button>
        ) : null}
        <button
          style={{
            minHeight: 46,
            borderRadius: 14,
            border: "1px solid oklch(0.89 0.008 120)",
            background: "oklch(1 0 0)",
            color: "oklch(0.3 0.012 150)",
            fontSize: 14.5,
            fontWeight: 600,
          }}
        >
          Open chat in WhatsApp
        </button>
      </div>

      <div style={{ marginTop: 20, fontSize: 13, fontWeight: 650 }}>This customer</div>
      <div style={{ marginTop: 8, fontSize: 13.5, color: "oklch(0.5 0.012 150)", lineHeight: 1.6 }}>
        {order.history}
      </div>
    </div>
  );
}
