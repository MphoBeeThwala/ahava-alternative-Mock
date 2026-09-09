"use client";

import React from "react";

/**
 * Card wrapper – presentation only. Uses design tokens from globals.css.
 * No logic; wrap existing content for consistent look (Phase 1).
 */
const paddingClass = { sm: "p-4", md: "p-6" } as const;

export function Card({
  children,
  className = "",
  variant = "default",
  padding = "md",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "sunken";
  padding?: "sm" | "md";
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border shadow-[var(--shadow)] ${paddingClass[padding]} ${className}`}
      style={{
        borderColor: "var(--border)",
        background: variant === "sunken" ? "var(--card-sunken)" : "var(--card)",
      }}
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
