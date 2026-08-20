"use client";

import clsx from "clsx";
import { Money } from "../design/Money";
import { Qty } from "../design/Qty";
import { useTallyStore, type TallyKey } from "@/lib/tally-store";

const FIGURES: { key: TallyKey; label: string }[] = [
  { key: "taken", label: "Taken today" },
  { key: "credit", label: "On credit" },
  { key: "till", label: "In the till" },
  { key: "stock", label: "Low stock" },
];

/**
 * B.5.2 / C.2 — 56px fixed strip under the top nav, present on every screen.
 * `activeKey` draws the tape underline beneath whichever figure the current
 * room relates to (e.g. Debt Book → "On credit").
 */
export function TallyRail({ activeKey }: { activeKey?: TallyKey | undefined }) {
  const { takenToday, onCreditToday, inTheTill, lowStockCount } = useTallyStore();

  const values: Record<TallyKey, React.ReactNode> = {
    taken: <Money amount={takenToday} size="card-title" />,
    credit: <Money amount={onCreditToday} size="card-title" />,
    till: <Money amount={inTheTill} size="card-title" />,
    stock: <Qty value={lowStockCount} unit={lowStockCount === 1 ? "item" : "items"} />,
  };

  return (
    <div
      role="status"
      aria-label="Today's figures"
      className="scroll-x-safe sticky top-rail z-20 flex h-rail items-stretch gap-24 bg-steel px-24"
    >
      {FIGURES.map(({ key, label }) => (
        <div key={key} className="flex flex-col justify-center gap-4 whitespace-nowrap py-8">
          <p className="text-micro font-semibold uppercase tracking-tracked text-white/60">{label}</p>
          <div
            className={clsx(
              "type-expanded font-display font-semibold text-white",
              key === activeKey && "motion-safe:animate-count-up",
            )}
          >
            {values[key]}
          </div>
          <div className={clsx("h-px", key === activeKey ? "bg-tape" : "bg-transparent")} />
        </div>
      ))}
    </div>
  );
}
