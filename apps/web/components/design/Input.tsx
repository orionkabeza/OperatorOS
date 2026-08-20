import clsx from "clsx";
import { forwardRef, useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** Right-aligned Plex Mono with an "RWF" chip inside the field — B.6. */
  money?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, money, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor={inputId}
        className="text-micro font-semibold uppercase tracking-tracked text-ink-soft"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        {money ? (
          <span className="pointer-events-none absolute left-8 text-meta text-ink-soft">RWF</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={clsx(
            "h-control w-full rounded border bg-paper px-12 text-body text-ink",
            "focus:outline-none focus:border-steel focus:ring-2 focus:ring-tape",
            error ? "border-out" : "border-rule",
            money && "pl-32 text-right font-mono",
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-meta text-out">
          {error}
        </p>
      ) : null}
    </div>
  );
});
