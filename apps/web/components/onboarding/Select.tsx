import { useId } from "react";

/**
 * A native <select> styled to match Input.tsx (B.6). Radix's Select
 * primitive would be the richer choice, but a native element is already
 * fully keyboard- and screen-reader-accessible with zero extra code, and
 * onboarding's dropdowns (business type, role) don't need custom option
 * rendering — not worth the extra dependency surface for this scope.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-control w-full rounded border border-rule bg-paper px-12 text-body text-ink focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
