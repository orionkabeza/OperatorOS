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

async function aiRepliedForCustomer(customerId: string): Promise<boolean> {
  const count = await prisma.message.count({
    where: { customerId, direction: "OUTBOUND", repliedBy: { isAi: true } },
  });
  return count > 0;
}

async function historyForCustomer(customerId: string): Promise<string> {
  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (orders.length <= 1) return "First order · new customer";
  const monthLabel = orders[0].createdAt.toLocaleDateString("en-US", { month: "long" });
  return `${orders.length} orders since ${monthLabel} · repeat customer`;
}

async function decorate(order: Parameters<typeof serializeOrder>[0]): Promise<OrderDTO> {
  const [aiReplied, history] = await Promise.all([
    aiRepliedForCustomer(order.customerId),
    historyForCustomer(order.customerId),
  ]);
  return serializeOrder(order, { aiReplied, history });
}

export async function listOrders(paymentFilter?: string): Promise<OrderDTO[]> {
  const dbStatus = paymentFilter ? PAY_FILTER_MAP[paymentFilter] : undefined;
  const orders = await prisma.order.findMany({
    where: dbStatus ? { paymentStatus: dbStatus } : undefined,
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(orders.map(decorate));
}

export async function getOrderDTO(id: string): Promise<OrderDTO | null> {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) return null;
  return decorate(order);
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
