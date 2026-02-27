"use client";

import React from "react";

/**
 * Card wrapper – presentation only. Uses design tokens from globals.css.
 * No logic; wrap existing content for consistent look (Phase 1).
 */
export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border bg-[var(--card)] p-6 shadow-[var(--shadow)] ${className}`}
      style={{ borderColor: "var(--border)" }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={`text-lg font-semibold tracking-tight text-[var(--foreground)] ${className}`}
      {...rest}
    >
      {children}
    </h2>
  );
}
