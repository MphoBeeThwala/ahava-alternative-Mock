"use client";

import React from "react";
import { StatusBadge } from "./StatusBadge";

type Variant = "danger" | "success" | "warning";

/**
 * KPI block – large number + label + optional status badge. Presentation only (Phase 2).
 */
export function KpiCard({
  label,
  value,
  badge,
  badgeVariant = "warning",
  className = "",
  ...rest
}: {
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  badgeVariant?: Variant;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius)] border bg-[var(--card)] p-6 shadow-[var(--shadow)] ${className}`}
      style={{ borderColor: "var(--border)" }}
      {...rest}
    >
      <p className="text-sm font-medium text-[var(--muted)] mb-1">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-3xl font-bold text-[var(--foreground)]">{value}</p>
        {badge != null && (
          <StatusBadge variant={badgeVariant}>{badge}</StatusBadge>
        )}
      </div>
    </div>
  );
}
