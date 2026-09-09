"use client";

import React from "react";

/**
 * Compact page header — title, optional subtitle, optional right-hand slot.
 * Replaces the ~200px gradient hero that repeated across patient, doctor
 * and nurse dashboards. Presentation only; owns no data.
 */
export function PageHeader({
  title,
  subtitle,
  right,
  className = "",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)] px-6 py-4 ${className}`}
    >
      <div className="min-w-0">
        <h1
          className="truncate font-extrabold text-[var(--foreground)]"
          style={{ fontSize: "var(--text-page)", letterSpacing: "-0.02em" }}
        >
          {title}
        </h1>
        {subtitle != null && (
          <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p>
        )}
      </div>
      {right != null && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
