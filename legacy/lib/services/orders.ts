import { prisma } from "../db";
import { Prisma, type PaymentStatus as DbPaymentStatus } from "../generated/prisma/client";
import { serializeOrder } from "../serialize";
import type { Order as OrderDTO } from "../types";

const PAY_FILTER_MAP: Record<string, DbPaymentStatus> = {
  unpaid: "UNPAID",
  awaiting: "AWAITING",
  paid: "PAID",
  cash: "CASH",
};

// Payments ordered deterministically (oldest→newest) so serializeOrder's
// "last element = latest payment" holds identically on both servers, instead
// of relying on planner-dependent row order.
const ORDER_INCLUDE = {
  customer: true,
  items: true,
  payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderInclude;

export const VALID_PAYMENT_FILTERS = Object.keys(PAY_FILTER_MAP);

type OrderRow = Parameters<typeof serializeOrder>[0];

function buildHistory(count: number, firstOrder: Date | null, fallback: Date): string {
  if (count <= 1) return "First order · new customer";
  const monthLabel = (firstOrder ?? fallback).toLocaleDateString("en-US", { month: "long" });
  return `${count} orders since ${monthLabel} · repeat customer`;
}

/**
 * Decorate a batch of orders with per-customer facts (AI-replied badge, order
 * history) using a fixed 2 queries for the whole batch instead of 2 per order
 * — the previous per-order fan-out could open hundreds of concurrent queries
 * and exhaust the shared connection pool.
 */
async function decorateMany(orders: OrderRow[]): Promise<OrderDTO[]> {
  if (orders.length === 0) return [];
  const customerIds = [...new Set(orders.map((o) => o.customerId))];

  const [aiRows, grouped] = await Promise.all([
    prisma.message.findMany({
      where: { customerId: { in: customerIds }, direction: "OUTBOUND", repliedBy: { isAi: true } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds } },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
  ]);

  const aiSet = new Set(aiRows.map((r) => r.customerId));
  const histMap = new Map(grouped.map((g) => [g.customerId, { count: g._count._all, first: g._min.createdAt }]));

  return orders.map((o) => {
    const h = histMap.get(o.customerId);
    return serializeOrder(o, {
      aiReplied: aiSet.has(o.customerId),
      history: buildHistory(h?.count ?? 1, h?.first ?? null, o.createdAt),
    });
  });
}

export async function listOrders(paymentFilter?: string): Promise<OrderDTO[]> {
  const dbStatus = paymentFilter ? PAY_FILTER_MAP[paymentFilter] : undefined;
  const orders = await prisma.order.findMany({
    where: dbStatus ? { paymentStatus: dbStatus } : undefined,
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return decorateMany(orders);
}

export async function getOrderDTO(id: string): Promise<OrderDTO | null> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) return null;
  return (await decorateMany([order]))[0] ?? null;
}

export async function markOrderDelivered(id: string): Promise<OrderDTO | null> {
  await prisma.order.update({ where: { id }, data: { stage: "DELIVERED" } });
  return getOrderDTO(id);
}

export async function confirmOrderPaymentManually(id: string): Promise<OrderDTO | null> {
  // Idempotent + atomic: flip the order to PAID only if it isn't already, and
  // create the CASH payment row only when that flip actually happened. A
  // double-tap or LB retry lands the second call with the order already PAID,
  // so updateMany reports 0 rows and no duplicate payment is written (which
  // would otherwise double-count "Money in today").
  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id, paymentStatus: { not: "PAID" } },
      data: { paymentStatus: "PAID" },
    });
    if (updated.count === 1) {
      const order = await tx.order.findUniqueOrThrow({ where: { id }, select: { total: true } });
      await tx.payment.create({
        data: { orderId: id, provider: "CASH", status: "PAID", amount: order.total },
      });
    }
  });
  return getOrderDTO(id);
}
