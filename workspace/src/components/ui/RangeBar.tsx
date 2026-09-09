"use client";

/**
 * A value marker against a shaded "normal" band. Per the brief's §1.1 rule
 * (never invent clinical data): this component requires a real min/max —
 * it does not default to a guessed range, and returns null rather than
 * render a fabricated band if the caller can't supply one. The caller is
 * still responsible for only invoking this when real baseline data exists;
 * this is a second line of defence, not a substitute for that check.
 */
export function RangeBar({
  value,
  min,
  max,
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  className?: string;
}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;

  const clampedPct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const outOfRange = value < min || value > max;

  return (
    <div className={`relative h-2 rounded-full bg-[var(--acuity-routine-bg)] ${className}`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--acuity-routine)]" style={{ width: "100%", opacity: 0.25 }} />
      <div
        className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{
          left: `calc(${clampedPct}% - 6px)`,
          background: outOfRange ? "var(--acuity-emergency)" : "var(--acuity-routine)",
        }}
      />
    </div>
  );
}
