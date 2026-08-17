import type { CSSProperties } from "react";
import { decorateOrder } from "@/lib/decorate";
import { lowStockRows, teamToRows } from "@/lib/present";
import type { DashboardSummary, Order, StockRow, TeamRow } from "@/lib/types";

interface TodayViewProps {
  cur: (n: number) => string;
  orders: Order[];
  stock: StockRow[];
  team: TeamRow[];
  summary: DashboardSummary | null;
  showAiLabels: boolean;
  openId: string | null;
  onOpenOrder: (id: string, filter?: string) => void;
  onGoUnpaid: () => void;
  onGoOrders: () => void;
  onGoStock: () => void;
  onGoTeam: () => void;
}

const cardStyle: CSSProperties = {
  background: "oklch(1 0 0)",
  border: "1px solid oklch(0.91 0.008 120)",
  borderRadius: 18,
  padding: 18,
};

export default function TodayView({
  cur,
  orders,
  stock,
  team,
  summary,
  showAiLabels,
  openId,
  onOpenOrder,
  onGoUnpaid,
  onGoOrders,
  onGoStock,
  onGoTeam,
}: TodayViewProps) {
  const latest = orders.slice(0, 4).map((o) => decorateOrder(o, { cur, openId, showAiLabels }));
  const teamRows = teamToRows(team).slice(0, 4);
  const low = lowStockRows(stock);
  const activity = summary?.activity ?? [];

  const neediestOrder = orders.find((o) => o.pay === "unpaid") ?? orders.find((o) => o.pay === "awaiting");
  const neediestStock = [...stock].sort((a, b) => a.quantity - b.quantity)[0];

  const tasks = [
    {
      icon: "💬",
      tint: "oklch(0.95 0.03 155)",
      ink: "oklch(0.42 0.1 155)",
      title: `${summary?.unansweredCount ?? 0} message${summary?.unansweredCount === 1 ? "" : "s"} nobody answered`,
      sub: "Check the Team tab for who's behind",
      when: "now",
      onClick: onGoTeam,
    },
    neediestOrder
      ? {
          icon: "◔",
          tint: "oklch(0.96 0.05 75)",
          ink: "oklch(0.45 0.09 60)",
          title: `Confirm ${cur(neediestOrder.total)} from ${neediestOrder.name}`,
          sub: `Order ${neediestOrder.meta.split(" · ")[0]} · payment not confirmed`,
          when: neediestOrder.meta.split(" · ")[0],
          onClick: () => onOpenOrder(neediestOrder.id, "Not paid"),
        }
      : null,
    neediestStock
      ? {
          icon: "▤",
          tint: "oklch(0.95 0.04 30)",
          ink: "oklch(0.47 0.11 28)",
          title: `${neediestStock.name} is down to ${neediestStock.quantity} ${neediestStock.unit}`,
          sub: neediestStock.quantity < neediestStock.lowThreshold ? "Below the reorder threshold" : "Lowest item in stock",
          when: "stock",
          onClick: onGoStock,
        }
      : null,
  ].filter((t): t is NonNullable<typeof t> => t !== null);

  return (
    <div
      style={{
        padding: "26px 32px 40px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))",
        gap: 24,
        alignItems: "start",
        maxWidth: 1500,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 14,
          }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, color: "oklch(0.55 0.01 150)", fontWeight: 550 }}>Orders today</div>
            <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 8 }}>
              {summary?.ordersToday ?? orders.length}
            </div>
            <div style={{ fontSize: 12, color: "oklch(0.5 0.09 155)", marginTop: 4 }}>
              {summary?.stillCooking ?? 0} still cooking
            </div>
          </div>

          <button
            onClick={onGoUnpaid}
            className="row-btn"
            style={{
              background: "oklch(0.99 0.02 70)",
              border: "1px solid oklch(0.88 0.05 75)",
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 12.5, color: "oklch(0.47 0.07 60)", fontWeight: 550 }}>Waiting to be paid</div>
            <div
              className="mono"
              style={{
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1.15,
                marginTop: 8,
                color: "oklch(0.38 0.08 55)",
              }}
            >
              {cur(summary?.unpaidTotal ?? 0)}
            </div>
            <div style={{ fontSize: 12, color: "oklch(0.47 0.07 60)", marginTop: 4 }}>
              {summary?.unpaidCount ?? 0} orders
            </div>
          </button>

          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, color: "oklch(0.55 0.01 150)", fontWeight: 550 }}>Low stock</div>
            <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 8 }}>
              {summary?.lowStockCount ?? low.length}
            </div>
            <div style={{ fontSize: 12, color: "oklch(0.5 0.11 30)", marginTop: 4 }}>
              {neediestStock ? `${neediestStock.name} runs out first` : "All stocked up"}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, color: "oklch(0.55 0.01 150)", fontWeight: 550 }}>Unanswered messages</div>
            <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 8 }}>
              {summary?.unansweredCount ?? 0}
            </div>
            <div style={{ fontSize: 12, color: "oklch(0.55 0.01 150)", marginTop: 4 }}>From WhatsApp</div>
          </div>
        </div>

        <div
          style={{
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 650 }}>Needs you right now</span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 6,
                background: "oklch(0.95 0.03 70)",
                color: "oklch(0.45 0.09 60)",
              }}
            >
              {tasks.length}
            </span>
          </div>
          {tasks.map((t, i) => (
            <button
              key={i}
              onClick={t.onClick}
              className="row-btn"
              style={{
                width: "100%",
                borderTop: "1px solid oklch(0.94 0.006 120)",
                padding: "15px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                  fontSize: 14,
                  background: t.tint,
                  color: t.ink,
                }}
              >
                {t.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {t.title}
                </span>
                <span style={{ display: "block", fontSize: 13, color: "oklch(0.55 0.01 150)", marginTop: 2 }}>
                  {t.sub}
                </span>
              </span>
              <span className="mono" style={{ fontSize: 11.5, color: "oklch(0.6 0.01 150)" }}>
                {t.when}
              </span>
              <span style={{ color: "oklch(0.65 0.01 150)", fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>

        <div
          style={{
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 650 }}>Latest orders</span>
            <button
              onClick={onGoOrders}
              style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "oklch(0.46 0.1 155)" }}
            >
              See all {orders.length}
            </button>
          </div>
          {latest.map((o) => (
            <button
              key={o.id}
              onClick={() => onOpenOrder(o.id)}
              className="row-btn"
              style={{
                width: "100%",
                borderTop: "1px solid oklch(0.94 0.006 120)",
                padding: "14px 18px",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 0.8fr)",
                alignItems: "center",
                gap: 16,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    background: "oklch(0.95 0.012 150)",
                    color: "oklch(0.4 0.03 150)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
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
                      fontWeight: 600,
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
              <span
                style={{
                  minWidth: 0,
                  fontSize: 13.5,
                  color: "oklch(0.45 0.012 150)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {o.items}
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
              <span className="mono" style={{ minWidth: 0, fontSize: 15, fontWeight: 600, textAlign: "right" }}>
                {o.totalLabel}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <div
          style={{
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 18px 12px", fontSize: 14, fontWeight: 650 }}>Coming in from WhatsApp</div>
          {activity.length === 0 ? (
            <div style={{ padding: "12px 18px", fontSize: 13.5, color: "oklch(0.57 0.01 150)" }}>
              Nothing yet today.
            </div>
          ) : (
            activity.map((a, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderTop: "1px solid oklch(0.94 0.006 120)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: a.dot }} />
                <span style={{ flex: 1, fontSize: 14, color: "oklch(0.3 0.012 150)" }}>{a.text}</span>
                <span className="mono" style={{ fontSize: 11, color: "oklch(0.62 0.01 150)" }}>
                  {a.when}
                </span>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 18px 12px", fontSize: 14, fontWeight: 650 }}>Who replied today</div>
          {teamRows.map((r, i) => (
            <div
              key={i}
              style={{
                padding: "12px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderTop: "1px solid oklch(0.94 0.006 120)",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>{r.a}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "oklch(0.57 0.01 150)", marginTop: 1 }}>
                  {r.b}
                </span>
              </span>
              <span className="mono" style={{ fontSize: 13, color: r.tone }}>
                {r.c}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "oklch(1 0 0)",
            border: "1px solid oklch(0.91 0.008 120)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, fontWeight: 650 }}>Running low</span>
            <button
              onClick={onGoStock}
              style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "oklch(0.46 0.1 155)" }}
            >
              Stock
            </button>
          </div>
          {low.length === 0 ? (
            <div style={{ padding: "12px 18px", fontSize: 13.5, color: "oklch(0.57 0.01 150)" }}>
              Everything&apos;s stocked up.
            </div>
          ) : (
            low.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderTop: "1px solid oklch(0.94 0.006 120)",
                }}
              >
                <span style={{ flex: 1, fontSize: 14.5 }}>{r.a}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 550, color: r.tone }}>
                  {r.c}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
