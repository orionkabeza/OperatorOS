"use client";

import type {
  CustomerRow,
  DashboardSummary,
  Order,
  ProductRow,
  SegmentRow,
  SettingsRow,
  StockRow,
  TeamRow,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PATCH ${path} failed (${res.status})`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `POST ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  orders: () => get<{ orders: Order[] }>("/api/orders").then((r) => r.orders),
  stock: () => get<{ stock: StockRow[] }>("/api/stock").then((r) => r.stock),
  team: () => get<{ team: TeamRow[] }>("/api/team").then((r) => r.team),
  customers: () => get<{ customers: CustomerRow[] }>("/api/customers").then((r) => r.customers),
  catalog: () => get<{ products: ProductRow[] }>("/api/catalog").then((r) => r.products),
  broadcasts: () => get<{ segments: SegmentRow[] }>("/api/broadcasts").then((r) => r.segments),
  settings: () => get<{ settings: SettingsRow }>("/api/settings").then((r) => r.settings),
  summary: () => get<{ summary: DashboardSummary }>("/api/dashboard-summary").then((r) => r.summary),

  markDelivered: (id: string) => patch<{ order: Order }>(`/api/orders/${id}`, { action: "mark-delivered" }),
  confirmPayment: (id: string) => patch<{ order: Order }>(`/api/orders/${id}`, { action: "confirm-payment" }),
  requestMomoPayment: (id: string) => post<{ referenceId: string }>(`/api/orders/${id}/request-payment`),
};
