"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastState {
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [state]);

  const show = useCallback((message: string, type: ToastType) => {
    setState({ message, type });
  }, []);

  const toast = useCallback(
    () => ({
      success: (message: string) => show(message, "success"),
      error: (message: string) => show(message, "error"),
      info: (message: string) => show(message, "info"),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {state && (
        <div
          role="alert"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-[var(--radius)] border px-4 py-3 shadow-lg"
          style={{
            borderColor: state.type === "error" ? "var(--danger)" : state.type === "success" ? "var(--success)" : "var(--border)",
            backgroundColor: state.type === "error" ? "#fef2f2" : state.type === "success" ? "#f0fdf4" : "var(--card)",
            color: state.type === "error" ? "var(--danger)" : state.type === "success" ? "#166534" : "var(--foreground)",
          }}
        >
          {state.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === undefined) throw new Error("useToast must be used within ToastProvider");
  return ctx.toast;
}
