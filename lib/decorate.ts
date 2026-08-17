import { payStyle } from "./data";
import type { DecoratedOrder, Order } from "./types";

interface DecorateOptions {
  cur: (n: number) => string;
  openId: string | null;
  showAiLabels: boolean;
}

export function decorateOrder(order: Order, { cur, openId, showAiLabels }: DecorateOptions): DecoratedOrder {
  const p = payStyle(order.pay);
  return {
    ...order,
    totalLabel: cur(order.total),
    initials: order.name
      .split(" ")
      .map((w) => w[0])
      .join(""),
    payLabel: p.label,
    payIcon: p.icon,
    payBg: p.bg,
    payFg: p.fg,
    rowBg: openId === order.id ? "oklch(0.975 0.008 150)" : "transparent",
    showAiReplied: showAiLabels && order.aiReplied,
  };
}
