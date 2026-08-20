import clsx from "clsx";

const TONE_CLASS = {
  normal: "text-ink",
  low: "text-watch",
  zero: "text-out",
} as const;

/** Every quantity in the product renders through this — never ad-hoc `{n}`. */
export function Qty({
  value,
  unit,
  tone = "normal",
  className,
}: {
  value: number;
  unit?: string;
  tone?: keyof typeof TONE_CLASS;
  className?: string;
}) {
  return (
    <span className={clsx("font-mono whitespace-nowrap", TONE_CLASS[tone], className)}>
      {value.toLocaleString("en-US")}
      {unit ? <span className="text-ink-soft"> {unit}</span> : null}
    </span>
  );
}
