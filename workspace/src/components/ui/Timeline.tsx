"use client";

import React from "react";
import { Icon } from "./Icon";

export type TimelineStepState = "done" | "current" | "pending";

export interface TimelineStep {
  label: React.ReactNode;
  detail?: React.ReactNode;
  state: TimelineStepState;
}

/**
 * Vertical step list — done / current / pending. Presentation only; the
 * caller supplies real timestamps/state, this never invents one.
 */
export function Timeline({ steps, className = "" }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={`space-y-0 ${className}`}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 bottom-0 w-px"
                style={{ background: step.state === "pending" ? "var(--border)" : "var(--primary)" }}
                aria-hidden
              />
            )}
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white"
              style={{
                background: step.state === "pending" ? "var(--card)" : "var(--primary)",
                border: step.state === "pending" ? "2px solid var(--border)" : "none",
              }}
            >
              {step.state === "done" && <Icon name="check" size={12} />}
              {step.state === "current" && (
                <span className="h-2 w-2 rounded-full bg-white" />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className="text-sm font-semibold"
                style={{ color: step.state === "pending" ? "var(--muted)" : "var(--foreground)" }}
              >
                {step.label}
              </p>
              {step.detail != null && (
                <p className="mt-0.5 text-xs text-[var(--muted)]">{step.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
