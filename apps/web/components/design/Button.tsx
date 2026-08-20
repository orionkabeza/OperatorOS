import clsx from "clsx";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    "h-control-lg bg-tape text-ink border border-tape-deep hover:bg-tape-deep active:translate-y-px active:shadow-none disabled:bg-rule disabled:text-ink-soft disabled:cursor-not-allowed",
  secondary:
    "h-control bg-transparent text-ink border border-steel hover:bg-paper disabled:bg-transparent disabled:text-ink-soft disabled:border-rule disabled:cursor-not-allowed",
  danger:
    "h-control bg-out text-white border border-out hover:opacity-90 disabled:bg-rule disabled:text-ink-soft disabled:cursor-not-allowed",
  ghost:
    "h-control bg-transparent text-ink-soft border-0 underline-offset-2 hover:underline disabled:text-ink-soft disabled:cursor-not-allowed",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Required when `disabled` is true — spec B.6: disabled buttons must explain why via `title`. */
  disabledReason?: string | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", disabled, disabledReason, title, className, children, ...rest },
  ref,
) {
  if (disabled && !disabledReason && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("Button: disabled without a disabledReason — spec B.6 requires an explanation.");
  }
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason ?? title : title}
      className={clsx(
        "rounded px-16 font-body text-table font-semibold transition-none",
        VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
