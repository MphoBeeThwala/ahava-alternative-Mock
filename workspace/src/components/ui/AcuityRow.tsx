"use client";

import React from "react";
import { Icon } from "./Icon";

/**
 * The 5px full-height spine + glyph + word pattern (brief §2.4). Colour is
 * never the only signal for acuity — roughly 1 in 12 men has a red-green
 * colour deficiency, so every level also carries a distinct glyph and word.
 *
 * The spine is a real grid column (grid-template-columns: 5px 1fr), not a
 * border or a box-shadow, so it can never be collapsed by an unrelated
 * style change downstream.
 */
export type AcuityLevel = "emergency" | "urgent" | "routine";

const config: Record<
  AcuityLevel,
  { color: string; ink: string; bg: string; glyph: "alert-triangle" | "alert-square" | "check-circle"; word: string }
> = {
  emergency: { color: "var(--acuity-emergency)", ink: "var(--acuity-emergency-ink)", bg: "var(--acuity-emergency-bg)", glyph: "alert-triangle", word: "Emergency" },
  urgent: { color: "var(--acuity-urgent)", ink: "var(--acuity-urgent-ink)", bg: "var(--acuity-urgent-bg)", glyph: "alert-square", word: "Urgent" },
  routine: { color: "var(--acuity-routine)", ink: "var(--acuity-routine-ink)", bg: "var(--acuity-routine-bg)", glyph: "check-circle", word: "Routine" },
};

/** Maps the app's existing GREEN/YELLOW/RED alert levels onto the acuity
 * scale. The underlying API values are unchanged — this is a display-only
 * mapping used at the point of rendering. */
export function alertLevelToAcuity(alertLevel: "GREEN" | "YELLOW" | "RED"): AcuityLevel {
  if (alertLevel === "RED") return "emergency";
  if (alertLevel === "YELLOW") return "urgent";
  return "routine";
}

export function AcuityRow({
  level,
  children,
  className = "",
}: {
  level: AcuityLevel;
  children: React.ReactNode;
  className?: string;
}) {
  const c = config[level];
  return (
    <div
      className={`grid rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] ${className}`}
      style={{ gridTemplateColumns: "5px minmax(0,1fr)" }}
    >
      <div style={{ background: c.color }} aria-hidden />
      <div className="flex items-center gap-3 p-4">
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ color: c.ink, background: c.bg }}
        >
          <Icon name={c.glyph} size={14} />
          {c.word}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
