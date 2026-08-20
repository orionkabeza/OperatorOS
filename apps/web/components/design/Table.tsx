import clsx from "clsx";
import { useMemo, useState } from "react";
import { Button } from "./Button";

export interface TableColumn<Row> {
  key: string;
  label: string;
  align?: "left" | "right";
  numeric?: boolean;
  render: (row: Row) => React.ReactNode;
  sortValue?: (row: Row) => string | number;
}

/**
 * B.6: steel header, sticky, 44px alternating rows, numeric columns
 * right-aligned in mono, row hover gets a 2px tape left border, row click
 * opens a detail drawer (never a page navigation — pass `onRowClick`).
 * Wrapped in `.scroll-x-safe` so a wide table scrolls inside itself instead
 * of ever pushing the page wide (spec: "everything fits the screen without
 * sliding off").
 */
export function Table<Row extends { id: string }>({
  columns,
  rows,
  onRowClick,
  onExportCsv,
  emptyMessage = "Nothing here yet.",
}: {
  columns: TableColumn<Row>[];
  rows: Row[];
  onRowClick?: (row: Row) => void;
  onExportCsv?: () => void;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const withKeys = rows.map((row) => ({ row, key: col.sortValue!(row) }));
    withKeys.sort((a, b) => {
      if (a.key < b.key) return sort.dir === "asc" ? -1 : 1;
      if (a.key > b.key) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return withKeys.map((w) => w.row);
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return (
    <div className="rounded border border-rule bg-paper shadow-shelf">
      <div className="flex items-center justify-between gap-16 border-b border-rule px-16 py-8">
        <p className="text-meta text-ink-soft">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </p>
        {onExportCsv ? (
          <Button variant="ghost" onClick={onExportCsv}>
            Export CSV
          </Button>
        ) : null}
      </div>
      <div className="scroll-x-safe">
        <table className="w-full min-w-full border-collapse">
          <thead>
            <tr className="bg-steel">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sort?.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={clsx(
                    "sticky top-0 whitespace-nowrap px-12 py-8 text-micro font-bold uppercase tracking-tracked text-white",
                    col.align === "right" || col.numeric ? "text-right" : "text-left",
                  )}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="focus-visible:outline-none"
                    >
                      {col.label}
                      {sort?.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-12 py-24 text-center text-body text-ink-soft">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(
                    "h-control-lg border-b border-rule border-l-2 border-l-transparent",
                    i % 2 === 0 ? "bg-paper" : "bg-transparent",
                    onRowClick && "cursor-pointer hover:border-l-tape",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        "px-12 text-table text-ink",
                        col.numeric && "font-mono",
                        col.align === "right" || col.numeric ? "text-right" : "text-left",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
