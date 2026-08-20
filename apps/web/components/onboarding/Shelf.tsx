import clsx from "clsx";

const STEP_LABELS = ["The business", "The counter", "The stock", "The people", "The books"];

/**
 * D.2: "Progress shown as a 5-step shelf being filled, not a percentage
 * bar." Five segments styled like shelf slots — filled ones read as
 * "stocked", the active one gets the tape marker, later ones stay empty
 * outlines. This is the one place in the product a literal shelf metaphor
 * earns a bespoke visual rather than a generic progress bar.
 */
export function Shelf({ currentStep }: { currentStep: number }) {
  return (
    <ol aria-label="Onboarding progress" className="flex w-full gap-8">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const filled = step < currentStep;
        const active = step === currentStep;
        return (
          <li key={label} className="flex flex-1 flex-col gap-8">
            <div
              aria-hidden
              className={clsx(
                "h-8 rounded-none border",
                filled ? "border-tape-deep bg-tape" : active ? "border-tape bg-paper" : "border-rule bg-paper",
              )}
            />
            <span
              className={clsx(
                "text-micro font-semibold uppercase tracking-tracked",
                active ? "text-ink" : "text-ink-soft",
              )}
              aria-current={active ? "step" : undefined}
            >
              {step}. {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
