"use client";

/**
 * Pulsing placeholder block. The app has zero loading states today — every
 * screen goes blank then pops in, which reads as broken on a slow
 * connection. Each async region gets a Skeleton shaped like its own content.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  rounded = "var(--radius)",
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  rounded?: string;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-[var(--border)] ${className}`}
      style={{ width, height, borderRadius: rounded }}
      aria-hidden
    />
  );
}
