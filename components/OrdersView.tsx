import { decorateOrder } from "@/lib/decorate";
import type { Order } from "@/lib/types";
import OrderDetailSheet from "./OrderDetailSheet";

const FILTERS = ["All", "Not paid", "Waiting on MoMo", "Paid", "Cash"] as const;

const FILTER_TO_PAY: Record<string, Order["pay"]> = {
  "Not paid": "unpaid",
  "Waiting on MoMo": "awaiting",
  Paid: "paid",
  Cash: "cash",
};

interface OrdersViewProps {
  cur: (n: number) => string;
  orders: Order[];
  filter: string;
  onFilterChange: (filter: string) => void;
  openId: string | null;
  onOpenOrder: (id: string) => void;
  showAiLabels: boolean;
  onOrderChanged: () => void | Promise<void>;
}

export default function OrdersView({
  cur,
  orders,
  filter,
  onFilterChange,
  openId,
  onOpenOrder,
  showAiLabels,
  onOrderChanged,
}: OrdersViewProps) {
  const shown = filter === "All" ? orders : orders.filter((o) => o.pay === FILTER_TO_PAY[filter]);
  const shownOrders = shown.map((o) => decorateOrder(o, { cur, openId, showAiLabels }));
  const selected = orders.find((o) => o.id === openId) ?? null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))",
        alignItems: "start",
      }}
    >
      <div style={{ padding: "22px 28px 40px", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => onFilterChange(f)}
                style={{
                  fontSize: 13.5,
                  fontWeight: 550,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "oklch(0.24 0.012 150)" : "oklch(0.9 0.008 120)"}`,
                  background: active ? "oklch(0.24 0.012 150)" : "oklch(1 0 0)",
                  color: active ? "oklch(0.98 0.004 150)" : "oklch(0.4 0.012 150)",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 16,
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflowX: "auto",
            overflowY: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "190px minmax(180px, 1fr) 200px 100px 120px",
              gap: 16,
              minWidth: 820,
              padding: "12px 18px",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "oklch(0.58 0.01 150)",
              background: "oklch(0.982 0.004 120)",
            }}
          >
            <span>Customer</span>
            <span>What they ordered</span>
            <span>Payment</span>
            <span style={{ textAlign: "right" }}>Total</span>
            <span>Stage</span>
          </div>

          {shownOrders.map((o) => (
            <button
              key={o.id}
              onClick={() => onOpenOrder(o.id)}
              className="row-btn"
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "190px minmax(180px, 1fr) 200px 100px 120px",
                gap: 16,
                minWidth: 820,
                alignItems: "center",
                padding: "15px 18px",
                borderTop: "1px solid oklch(0.94 0.006 120)",
                background: o.rowBg,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: "oklch(0.95 0.012 150)",
                    color: "oklch(0.4 0.03 150)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12.5,
                    fontWeight: 650,
                    flex: "none",
                  }}
                >
                  {o.initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 14.5,
                      fontWeight: 620,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {o.name}
                  </span>
                  <span className="mono" style={{ display: "block", fontSize: 11, color: "oklch(0.6 0.01 150)" }}>
                    {o.meta}
                  </span>
                </span>
              </span>

              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 13.5,
                    color: "oklch(0.42 0.012 150)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {o.items}
                </span>
                {o.showAiReplied ? (
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: 5,
                      fontSize: 11.5,
                      color: "oklch(0.56 0.01 150)",
                      background: "oklch(0.96 0.006 150)",
                      padding: "3px 8px",
                      borderRadius: 999,
                    }}
                  >
                    Front desk replied
                  </span>
                ) : null}
              </span>

              <span
                style={{
                  minWidth: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: o.payBg,
                  color: o.payFg,
                  justifySelf: "start",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span style={{ fontSize: 11 }}>{o.payIcon}</span>
                {o.payLabel}
              </span>

              <span className="mono" style={{ minWidth: 0, fontSize: 15.5, fontWeight: 600, textAlign: "right" }}>
                {o.totalLabel}
              </span>

              <span
                style={{
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "oklch(0.48 0.09 155)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {o.stage}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          borderLeft: "1px solid oklch(0.91 0.008 120)",
          borderTop: "1px solid oklch(0.91 0.008 120)",
          background: "oklch(0.99 0.004 95)",
          padding: "22px 24px 40px",
          position: "sticky",
          top: 71,
          alignSelf: "stretch",
        }}
      >
        <OrderDetailSheet order={selected} cur={cur} onChanged={onOrderChanged} />
      </div>
    </div>
  );
}
