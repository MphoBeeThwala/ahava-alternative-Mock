"use client";

import React, { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Modal wrapper – overlay + panel, title, optional footer. Presentation only (Phase 3).
 * Same trigger/close logic; use for refer, override, etc.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel = "Cancel",
  onSecondary,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const el = contentRef.current;
    if (!el) return;
    const firstFocusable = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? el).focus({ preventScroll: true });

    // Restore focus to whatever opened the modal once it closes/unmounts —
    // otherwise focus silently drops to <body> and a keyboard user loses
    // their place.
    return () => {
      previouslyFocused.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const el = contentRef.current;
    if (!el) return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // Focus trap: wrap Tab/Shift+Tab at the modal's edges so keyboard focus
    // can never escape to the page behind the overlay.
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const handleSecondary = onSecondary ?? onClose;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-[var(--radius)] border bg-[var(--card)] shadow-[var(--shadow)] outline-none"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="border-b p-6" style={{ borderColor: "var(--border)" }}>
          <h3 id="modal-title" className="text-lg font-bold text-[var(--foreground)]">
            {title}
          </h3>
        </div>
        <div className="p-6">{children}</div>
        {(primaryLabel || secondaryLabel) && (
          <div
            className="flex gap-3 border-t p-6"
            style={{ borderColor: "var(--border)" }}
          >
            {secondaryLabel && (
              <button
                type="button"
                onClick={handleSecondary}
                className="flex-1 rounded-lg border py-2 font-medium transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                {secondaryLabel}
              </button>
            )}
            {primaryLabel && onPrimary && (
              <button
                type="button"
                onClick={onPrimary}
                disabled={primaryDisabled}
                className="flex-1 rounded-lg py-2 font-medium text-white transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary)]"
                style={{ backgroundColor: "var(--primary)" }}
              >
                {primaryLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
