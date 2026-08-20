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

const EMPHASIS_CLASS = { out: "text-out", watch: "text-watch", in: "text-in" } as const;

export function Money({
  amount,
  size = "body",
  surface = "light",
  emphasis,
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
  /**
   * Forces the figure's color independent of sign — for a semantically
   * *positive* amount that still needs to read as a warning, e.g. D.4's
   * "customer's outstanding balance inline next to their name in `--out`"
   * (a receivable is positive money, not negative — B.3's leading-minus
   * rule is about actual negative amounts, so this never adds a minus
   * sign, only recolors). Ignored when the amount is genuinely negative
   * (that always wins, and always gets the leading minus).
   */
  emphasis?: keyof typeof EMPHASIS_CLASS | undefined;
  className?: string | undefined;
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
          negative ? "text-out" : emphasis ? EMPHASIS_CLASS[emphasis] : surface === "dark" ? "text-white" : "text-ink",
        )}
      >
        {negative ? "-" : ""}
        {figure}
      </span>
    </span>
  );
}
