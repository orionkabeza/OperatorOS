import clsx from "clsx";

const TONE_CLASS = {
  light: { normal: "text-ink", low: "text-watch", zero: "text-out" },
  // See tailwind.config.ts — these dark variants exist because the plain
  // tones fail WCAG AA contrast against --steel (confirmed via an axe scan).
  dark: { normal: "text-white", low: "text-watch-dark", zero: "text-out-dark" },
} as const;

/** Every quantity in the product renders through this — never ad-hoc `{n}`. */
export function Qty({
  value,
  unit,
  tone = "normal",
  surface = "light",
  className,
}: {
  value: number;
  unit?: string;
  tone?: keyof typeof TONE_CLASS.light;
  /** Pass "dark" when rendering on --steel/--steel-deep (e.g. the Tally Rail). */
  surface?: keyof typeof TONE_CLASS;
  className?: string;
}) {
  return (
    <span className={clsx("font-mono whitespace-nowrap", TONE_CLASS[surface][tone], className)}>
      {value.toLocaleString("en-US")}
      {unit ? (
        <span className={surface === "dark" ? "text-white/60" : "text-ink-soft"}> {unit}</span>
      ) : null}
    </span>
  );
}
