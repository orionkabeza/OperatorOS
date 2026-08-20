import clsx from "clsx";
import type { Category } from "@/lib/api/types";

/** D.4 — 180px category rail on desktop, horizontal scroll strip on tablet/mobile. */
export function CategorySidebar({
  categories,
  activeCategoryId,
  onSelect,
}: {
  categories: Category[];
  activeCategoryId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav aria-label="Categories" className="scroll-x-safe flex shrink-0 gap-4 lg:w-categories lg:flex-col lg:gap-px lg:overflow-visible">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={activeCategoryId === null ? "true" : undefined}
        className={clsx(
          "h-control-lg shrink-0 whitespace-nowrap rounded border-l-2 px-16 text-left text-table font-semibold lg:w-full lg:rounded-none",
          activeCategoryId === null ? "border-tape bg-paper text-ink" : "border-transparent text-ink-soft hover:text-ink",
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onSelect(cat.id)}
          aria-current={activeCategoryId === cat.id ? "true" : undefined}
          className={clsx(
            "h-control-lg shrink-0 whitespace-nowrap rounded border-l-2 px-16 text-left text-table font-semibold lg:w-full lg:rounded-none",
            activeCategoryId === cat.id ? "border-tape bg-paper text-ink" : "border-transparent text-ink-soft hover:text-ink",
          )}
        >
          {cat.name}
        </button>
      ))}
    </nav>
  );
}
