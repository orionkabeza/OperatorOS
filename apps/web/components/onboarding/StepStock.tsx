"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import { Card } from "../design/Card";
import { GridEntryTable } from "./GridEntryTable";
import type { OnboardingState } from "@/lib/api/types";

// exceljs (pulled in by CsvImporter -> lib/import-parse.ts) is a sizeable
// library only needed by the minority of businesses that pick "Upload a
// list" in Step 3 — split it into its own chunk rather than shipping it in
// every onboarding page load. See docs/DECISIONS.md (bundle-budget note).
const CsvImporter = dynamic(() => import("./CsvImporter").then((m) => m.CsvImporter), {
  ssr: false,
});

type StockPath = NonNullable<OnboardingState["stockPath"]>;

const PATHS: { id: StockPath; title: string; blurb: string }[] = [
  { id: "upload", title: "Upload a list", blurb: "CSV or XLSX, with column mapping and per-row validation." },
  { id: "type_in", title: "Type them in", blurb: "A fast grid — Tab across, Enter for a new row." },
  { id: "start_empty", title: "Start with nothing", blurb: "Products get created on the fly the first time they're sold." },
];

/** D.2 Step 3 — three equal paths, presented as cards. */
export function StepStock({
  path,
  productsAdded,
  onSelectPath,
  onProductsAdded,
}: {
  path: StockPath | null;
  productsAdded: number;
  onSelectPath: (path: StockPath) => void;
  onProductsAdded: (count: number) => void;
}) {
  return (
    <div className="flex flex-col gap-16">
      <p className="text-body text-ink-soft">How do you want to get your stock in?</p>
      <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
        {PATHS.map((p) => (
          <button key={p.id} type="button" onClick={() => onSelectPath(p.id)} className="text-left">
            <Card
              className={clsx("h-full cursor-pointer transition-none", path === p.id && "border-tape-deep border-2")}
            >
              <h4 className="mb-8 text-table font-bold text-ink">{p.title}</h4>
              <p className="text-meta text-ink-soft">{p.blurb}</p>
            </Card>
          </button>
        ))}
      </div>

      {productsAdded > 0 ? (
        <p role="status" className="text-meta text-in">
          {productsAdded} products added so far.
        </p>
      ) : null}

      {path === "upload" ? <CsvImporter onImported={onProductsAdded} /> : null}
      {path === "type_in" ? <GridEntryTable onSaved={onProductsAdded} /> : null}
      {path === "start_empty" ? (
        <p className="text-body text-ink-soft">
          No problem — the first time a seller types a name that doesn&apos;t match anything at the Counter, they can
          create it on the spot.
        </p>
      ) : null}
    </div>
  );
}
