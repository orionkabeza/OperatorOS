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
  className,
}: {
  amount: MinorUnits;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const { negative, figure } = toRwfParts(amount);
  return (
    <span
      className={clsx("font-mono whitespace-nowrap", className)}
      aria-label={`RWF ${negative ? "minus " : ""}${figure}`}
    >
      <span className="text-meta text-ink-soft">RWF </span>
      <span className={clsx(SIZE_CLASS[size], negative ? "text-out" : "text-ink")}>
        {negative ? "-" : ""}
        {figure}
      </span>
    </span>
  );
}
