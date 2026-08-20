"use client";

import clsx from "clsx";
import { useRef } from "react";

/** D.1: 6 individual 44px boxes, numeric keypad on mobile, auto-advance, paste-aware. */
export function PinInput({
  value,
  onChange,
  length = 6,
  error,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function setDigit(index: number, digit: string) {
    const chars = value.split("");
    chars[index] = digit;
    const next = chars.join("").slice(0, length);
    onChange(next);
    if (digit && index < length - 1) refs.current[index + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted.padEnd(value.length, ""));
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div role="group" aria-label="PIN" className="flex gap-8">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          aria-label={`PIN digit ${i + 1}`}
          value={value[i] ?? ""}
          onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          className={clsx(
            "h-control-lg w-control-lg rounded border bg-paper text-center font-mono text-card-title text-ink",
            "focus:outline-none focus:border-steel focus:ring-2 focus:ring-tape",
            error ? "border-out" : "border-rule",
          )}
        />
      ))}
    </div>
  );
}
