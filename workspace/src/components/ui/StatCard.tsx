"use client";

import React from "react";
import { Sparkline } from "./Sparkline";

/**
 * label + big numeric value + optional unit/delta/sparkline. Presentation
 * only — the caller computes delta direction and passes real history data;
 * this component never invents a trend.
 */
export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaTone = "neutral",
  sparklineValues,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** e.g. "+4" or "-2 bpm" — caller-formatted, never derived here */
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  sparklineValues?: number[];
  className?: string;
}) {
  const deltaColor =
    deltaTone === "up" ? "var(--danger)" : deltaTone === "down" ? "var(--success)" : "var(--muted)";

  return (
    <div className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 ${className}`}>
      <p className="text-[var(--text-meta)] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
        {label}
      </p>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span className="num text-2xl font-bold text-[var(--foreground)]">{value}</span>
          {unit != null && <span className="text-sm font-medium text-[var(--muted)]">{unit}</span>}
        </div>
        {sparklineValues != null && (
          <div className="text-[var(--primary)]">
            <Sparkline values={sparklineValues} />
          </div>
        )}
      </div>
      {delta != null && (
        <p className="num mt-1 text-xs font-semibold" style={{ color: deltaColor }}>
          {delta}
        </p>
      )}
    </div>
  );
}
