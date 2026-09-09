"use client";

import React from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Right-aligns the column and applies the .num tabular-nums class — use for vitals, scores, timestamps, IDs, currency. */
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
}

/**
 * Header row, row hover, right-aligned numeric columns, and a responsive
 * card fallback below 768px (a dense table doesn't work on a phone —
 * rather than force horizontal scroll, render each row as a small card).
 * Pure presentation: the caller supplies rows and render functions, this
 * owns no data fetching or business logic.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  className = "",
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* Table — 768px and up */}
      <div className="hidden overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--card-sunken)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-[var(--text-meta)] font-semibold uppercase tracking-wide text-[var(--ink-3)] ${
                    col.numeric ? "text-right" : "text-left"
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={rowKey(row)} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--card-sunken)]">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-[var(--foreground)] ${col.numeric ? "num text-right" : "text-left"}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card fallback — below 768px */}
      <div className="space-y-2 md:hidden">
        {data.map((row) => (
          <div key={rowKey(row)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3">
            {columns.map((col) => (
              <div key={col.key} className="flex items-center justify-between gap-3 py-1 text-sm first:pt-0 last:pb-0">
                <span className="text-[var(--text-meta)] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  {col.header}
                </span>
                <span className={col.numeric ? "num text-[var(--foreground)]" : "text-[var(--foreground)]"}>
                  {col.render(row)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
