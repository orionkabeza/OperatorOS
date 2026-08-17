import { formatRelativeTime } from "../format";
import { prisma } from "../db";
import { countUnansweredThreads } from "./messages";

export interface ActivityItem {
  text: string;
  when: string;
  dot: string;
  at: Date;
}

const DOT_ORDER = "oklch(0.52 0.11 155)";
const DOT_PAYMENT = "oklch(0.52 0.11 155)";
const DOT_OUTBOUND = "oklch(0.72 0.1 70)";
const DOT_INBOUND = "oklch(0.75 0.02 150)";

async function recentActivity(limit: number, currency: string): Promise<ActivityItem[]> {
  const [orders, payments, messages] = await Promise.all([
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { customer: true } }),
    prisma.payment.findMany({
      where: { status: "PAID" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { order: { include: { customer: true } } },
    }),
    prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { customer: true } }),
  ]);

  const items: ActivityItem[] = [
    ...orders.map((o) => ({
      text: `New order from ${o.customer.name}`,
      at: o.createdAt,
      when: formatRelativeTime(o.createdAt),
      dot: DOT_ORDER,
    })),
    ...payments.map((p) => ({
      text: `${p.order.customer.name} paid ${currency}${p.amount.toLocaleString("en-US")} by ${
        p.provider === "MTN_MOMO" ? "MoMo" : p.provider === "AIRTEL_MONEY" ? "Airtel Money" : "cash"
      }`,
      at: p.createdAt,
      when: formatRelativeTime(p.createdAt),
      dot: DOT_PAYMENT,
    })),
    ...messages.map((m) => ({
      text: m.direction === "INBOUND" ? `New message from ${m.customer.name}` : `Message sent to ${m.customer.name}`,
      at: m.createdAt,
      when: formatRelativeTime(m.createdAt),
      dot: m.direction === "INBOUND" ? DOT_INBOUND : DOT_OUTBOUND,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export async function getTodaySummary(currency: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [ordersToday, stillCooking, unpaidOrders, stockItems, unansweredCount, paidToday, activity] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.order.count({ where: { stage: "COOKING" } }),
      prisma.order.findMany({
        where: { paymentStatus: { in: ["UNPAID", "AWAITING"] } },
        select: { total: true },
      }),
      prisma.stockItem.findMany({ select: { quantity: true, lowThreshold: true } }),
      countUnansweredThreads(),
      prisma.payment.findMany({
        where: { status: "PAID", createdAt: { gte: startOfDay } },
        select: { amount: true },
      }),
      recentActivity(5, currency),
    ]);

  return {
    ordersToday,
    stillCooking,
    unpaidCount: unpaidOrders.length,
    unpaidTotal: unpaidOrders.reduce((sum, o) => sum + o.total, 0),
    lowStockCount: stockItems.filter((s) => s.quantity < s.lowThreshold).length,
    unansweredCount,
    moneyInToday: paidToday.reduce((sum, p) => sum + p.amount, 0),
    activity: activity.map(({ text, when, dot }) => ({ text, when, dot })),
  };
}
