import type { MinorUnits } from "@operatoros/shared";
import clsx from "clsx";
import { AGEING_BUCKETS, AGEING_BUCKET_LABELS, type AgeingBucket } from "@/lib/debt-math";
import { Money } from "./Money";

const BUCKET_COLOR: Record<AgeingBucket, string> = {
  current: "bg-in-dark",
  "1-30": "bg-watch-dark/60",
  "31-60": "bg-watch-dark",
  "61-90": "bg-out-dark/70",
  "90+": "bg-out-dark",
};

/**
 * D.6 header band's clickable segmented ageing bar — a genuine new /design
 * primitive (no segmented-bar component existed before Phase 2), matching
 * design-reference/debt-book-stock-room.dc.html's 5-bucket scheme and dark
 * header-band styling (docs/DECISIONS.md's --in-dark/--out-dark/--watch-dark
 * tokens, pulled from that same reference). Clicking a segment or its legend
 * entry filters the customer table below; clicking the active segment again
 * clears the filter.
 */
export function AgeingBar({
  totals,
  selected,
  onSelect,
}: {
  totals: Record<AgeingBucket, MinorUnits>;
  selected: AgeingBucket | null;
  onSelect: (bucket: AgeingBucket | null) => void;
}) {
  const total = AGEING_BUCKETS.reduce((s, b) => s + totals[b], 0);

  function toggle(bucket: AgeingBucket) {
    onSelect(selected === bucket ? null : bucket);
  }

  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label="Ageing of what you're owed, by days since invoice date" className="flex h-24 overflow-hidden rounded">
        {AGEING_BUCKETS.map((bucket) => {
          const value = totals[bucket];
          const widthPercent = total > 0 ? Math.max(value > 0 ? 2 : 0, (value / total) * 100) : bucket === "current" ? 100 : 0;
          if (widthPercent === 0) return null;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => toggle(bucket)}
              aria-pressed={selected === bucket}
              title={`${AGEING_BUCKET_LABELS[bucket]}: RWF ${(value / 100).toLocaleString()}`}
              style={{ width: `${widthPercent}%` }}
              className={clsx(
                BUCKET_COLOR[bucket],
                "h-full transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
                selected !== null && selected !== bucket && "opacity-40",
              )}
            />
          );
        })}
      </div>
      <div role="group" aria-label="Ageing bucket legend" className="flex flex-wrap items-center gap-16">
        {AGEING_BUCKETS.map((bucket) => (
          <button
            key={bucket}
            type="button"
            onClick={() => toggle(bucket)}
            aria-pressed={selected === bucket}
            className={clsx("flex items-center gap-4 text-meta", selected !== null && selected !== bucket && "opacity-50")}
          >
            <span className={clsx("h-8 w-8 rounded-full", BUCKET_COLOR[bucket])} />
            <span className="uppercase tracking-tracked text-white/70">{AGEING_BUCKET_LABELS[bucket]}</span>
            <Money amount={totals[bucket]} surface="dark" emphasis={bucket === "90+" && totals[bucket] > 0 ? "out" : undefined} />
          </button>
        ))}
      </div>
    </div>
  );
}
