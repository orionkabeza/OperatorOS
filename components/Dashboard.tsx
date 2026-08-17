"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { buildStubSection } from "@/lib/present";
import type {
  CustomerRow,
  DashboardSummary,
  NavKey,
  Order,
  ProductRow,
  SegmentRow,
  SettingsRow,
  StockRow,
  TeamRow,
} from "@/lib/types";
import Header from "./Header";
import OrdersView from "./OrdersView";
import Sidebar from "./Sidebar";
import StubView from "./StubView";
import TodayView from "./TodayView";

interface DashboardData {
  orders: Order[];
  stock: StockRow[];
  team: TeamRow[];
  customers: CustomerRow[];
  products: ProductRow[];
  segments: SegmentRow[];
  settings: SettingsRow | null;
  summary: DashboardSummary | null;
}

const EMPTY_DATA: DashboardData = {
  orders: [],
  stock: [],
  team: [],
  customers: [],
  products: [],
  segments: [],
  settings: null,
  summary: null,
};

export default function Dashboard() {
  const [tab, setTab] = useState<NavKey>("today");
  const [filter, setFilter] = useState("All");
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [orders, stock, team, customers, products, segments, settings, summary] = await Promise.all([
        api.orders(),
        api.stock(),
        api.team(),
        api.customers(),
        api.catalog(),
        api.broadcasts(),
        api.settings(),
        api.summary(),
      ]);
      setData({ orders, stock, team, customers, products, segments, settings, summary });
      setError(null);
      setOpenId((current) => current ?? orders[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshOrders = useCallback(async () => {
    const [orders, summary] = await Promise.all([api.orders(), api.summary()]);
    setData((d) => ({ ...d, orders, summary }));
  }, []);

  const currency = data.settings?.currency ?? "₵";
  const showAiLabels = data.settings?.showAiLabels ?? true;
  const cur = useCallback((n: number) => currency + n.toLocaleString("en-US"), [currency]);

  const go = (nextTab: NavKey, nextFilter?: string) => {
    setTab(nextTab);
    if (nextFilter) setFilter(nextFilter);
  };

  const openOrderFromToday = (id: string, nextFilter?: string) => {
    setTab("orders");
    if (nextFilter) setFilter(nextFilter);
    setOpenId(id);
  };

  const stub = buildStubSection(
    tab,
    { stock: data.stock, team: data.team, customers: data.customers, products: data.products, segments: data.segments, settings: data.settings },
    cur
  );

  const titles: Record<string, [string, string]> = {
    today: ["Today", data.summary ? `${data.summary.ordersToday} orders today · ${data.summary.stillCooking} still cooking` : ""],
    orders: [
      "Orders & payments",
      data.summary ? `${data.orders.length} orders today · ${cur(data.summary.unpaidTotal)} not yet paid` : "",
    ],
  };
  const [pageTitle, pageSub] = titles[tab] ?? [stub?.title ?? "", stub?.sub ?? ""];

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "oklch(0.5 0.01 150)" }}>
        Loading OperatorOS…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 8 }}>Couldn&apos;t load the dashboard</div>
          <div style={{ fontSize: 14, color: "oklch(0.5 0.01 150)" }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "248px 1fr",
        background: "oklch(0.975 0.004 95)",
        color: "oklch(0.24 0.012 150)",
      }}
    >
      <Sidebar tab={tab} onNavigate={go} moneyIn={cur(data.summary?.moneyInToday ?? 0)} />

      <div style={{ minWidth: 0 }}>
        <Header pageTitle={pageTitle} pageSub={pageSub} />

        {tab === "today" ? (
          <TodayView
            cur={cur}
            orders={data.orders}
            stock={data.stock}
            team={data.team}
            summary={data.summary}
            showAiLabels={showAiLabels}
            openId={openId}
            onOpenOrder={openOrderFromToday}
            onGoUnpaid={() => go("orders", "Not paid")}
            onGoOrders={() => go("orders", "All")}
            onGoStock={() => go("stock")}
            onGoTeam={() => go("team")}
          />
        ) : null}

        {tab === "orders" ? (
          <OrdersView
            cur={cur}
            orders={data.orders}
            filter={filter}
            onFilterChange={setFilter}
            openId={openId}
            onOpenOrder={setOpenId}
            showAiLabels={showAiLabels}
            onOrderChanged={refreshOrders}
          />
        ) : null}

        {tab !== "today" && tab !== "orders" && stub ? <StubView stub={stub} /> : null}
      </div>
    </div>
  );
}
