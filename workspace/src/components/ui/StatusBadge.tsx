"use client";

import React from "react";

/**
 * Status/acuity badge – presentation only. Maps to design tokens (Phase 1 acuity mapping).
 * danger = high/critical, success = stable/routine, warning = pending/draft.
 */
type Variant = "danger" | "success" | "warning";

const variantStyles: Record<Variant, string> = {
  danger: "bg-red-100 text-red-800",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
};

export function StatusBadge({
  children,
  variant = "success",
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${variantStyles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
