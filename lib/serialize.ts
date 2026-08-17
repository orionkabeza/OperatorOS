import { formatRelativeTime } from "./format";
import { Prisma } from "./generated/prisma/client";
import type { CustomerRow, Order } from "./types";

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { customer: true; items: true; payments: true };
}>;

export type CustomerWithOrders = Prisma.CustomerGetPayload<{
  include: { orders: true };
}>;

const PAY_STATUS_MAP = {
  UNPAID: "unpaid",
  AWAITING: "awaiting",
  PAID: "paid",
  CASH: "cash",
} as const;

const STAGE_LABEL: Record<string, string> = {
  COOKING: "Cooking",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  WAITING_ON_YOU: "Waiting on you",
};

const PAY_REF_FALLBACK: Record<string, string> = {
  UNPAID: "No payment yet",
  AWAITING: "Payment request sent, awaiting confirmation",
  CASH: "Paying cash on delivery",
  PAID: "Payment confirmed",
};

export function serializeOrder(order: OrderWithRelations, opts?: { aiReplied?: boolean; history?: string }): Order {
  const items = order.items.map((i) => `${i.quantity}× ${i.description}`).join(", ");
  const latestPayment = order.payments[order.payments.length - 1];

  return {
    id: order.id,
    number: order.number,
    name: order.customer.name,
    phone: order.customer.phone,
    meta: `#${order.number} · ${formatRelativeTime(order.createdAt)}`,
    total: order.total,
    items,
    pay: PAY_STATUS_MAP[order.paymentStatus],
    stage: STAGE_LABEL[order.stage] ?? order.stage,
    aiReplied: opts?.aiReplied ?? false,
    ref: latestPayment?.providerRef
      ? `${latestPayment.provider === "MTN_MOMO" ? "MTN MoMo" : latestPayment.provider} · ref ${latestPayment.providerRef}`
      : PAY_REF_FALLBACK[order.paymentStatus],
    history: opts?.history ?? "",
    createdAt: order.createdAt.toISOString(),
  };
}

export function serializeCustomer(customer: CustomerWithOrders): CustomerRow {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    orderCount: customer.orders.length,
    totalSpend: customer.orders.reduce((sum, o) => sum + o.total, 0),
  };
}
