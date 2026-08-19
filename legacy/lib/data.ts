import type { PayStatus, PayStyle } from "./types";

export const NORMAL_TONE = "oklch(0.35 0.012 150)";
export const LOW_TONE = "oklch(0.5 0.12 30)";
export const WARN_TONE = "oklch(0.55 0.1 60)";
export const MUTED_TONE = "oklch(0.6 0.01 150)";
export const GOOD_TONE = "oklch(0.45 0.09 155)";

const PAY_STYLES: Record<PayStatus, PayStyle> = {
  paid: {
    label: "Paid · MoMo confirmed",
    icon: "✓",
    bg: "oklch(0.95 0.05 155)",
    fg: "oklch(0.42 0.1 155)",
    headline: "Money received automatically",
  },
  awaiting: {
    label: "Waiting for MoMo",
    icon: "◔",
    bg: "oklch(0.96 0.05 75)",
    fg: "oklch(0.45 0.09 60)",
    headline: "Payment request sent, not confirmed yet",
  },
  unpaid: {
    label: "Not paid yet",
    icon: "!",
    bg: "oklch(0.95 0.05 30)",
    fg: "oklch(0.47 0.11 28)",
    headline: "Nothing received for this order",
  },
  cash: {
    label: "Cash on delivery",
    icon: "₵",
    bg: "oklch(0.95 0.006 150)",
    fg: "oklch(0.42 0.012 150)",
    headline: "Collect cash at the door",
  },
};

export function payStyle(pay: PayStatus): PayStyle {
  return PAY_STYLES[pay];
}
