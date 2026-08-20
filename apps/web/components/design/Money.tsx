import { toRwfParts, type MinorUnits } from "@operatoros/shared";
import clsx from "clsx";

const SIZE_CLASS = {
  body: "text-body",
  "card-title": "text-card-title",
  "screen-title": "text-screen-title",
  tally: "text-tally",
  "close-total": "text-close-total",
  table: "text-table",
} as const;

export function Money({
  amount,
  size = "body",
  surface = "light",
  className,
}: {
  amount: MinorUnits;
  size?: keyof typeof SIZE_CLASS;
  /**
   * `--ink-soft` (the "RWF" prefix's color) is calibrated against light
   * (`--paper`/`--floor`) backgrounds — 2.13:1 against `--steel`, caught by
   * an axe scan on the Tally Rail, well under WCAG AA's 4.5:1. `surface`
   * lets a dark-background caller (Tally Rail, top nav) opt into
   * `white/60`, which does pass — same pattern the Tally Rail's own labels
   * already used.
   */
  surface?: "light" | "dark";
  className?: string;
}) {
  const { negative, figure } = toRwfParts(amount);
  return (
    <span
      className={clsx("font-mono whitespace-nowrap", className)}
      aria-label={`RWF ${negative ? "minus " : ""}${figure}`}
    >
      <span className={clsx("text-meta", surface === "dark" ? "text-white/60" : "text-ink-soft")}>
        RWF{" "}
      </span>
      <span
        className={clsx(
          SIZE_CLASS[size],
          negative ? "text-out" : surface === "dark" ? "text-white" : "text-ink",
        )}
      >
        {negative ? "-" : ""}
        {figure}
      </span>
    </span>
  );
}
