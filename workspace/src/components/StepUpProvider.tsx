"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";
import { registerStepUpHandler } from "../lib/stepUp";
import { authApi } from "../lib/api/auth";

/**
 * Asks for a fresh authenticator code when the backend requires one for a
 * sensitive action (see lib/stepUp.ts). Mounted once, near the app root.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
    setOpen(false);
    setCode("");
    setError("");
    setBusy(false);
  }, []);

  useEffect(
    () =>
      registerStepUpHandler(
        () =>
          new Promise<boolean>((resolve) => {
            settle.current = resolve;
            setOpen(true);
          }),
      ),
    [],
  );

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await authApi.stepUp(code.trim());
      finish(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Couldn't verify that code. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Modal
        open={open}
        onClose={() => finish(false)}
        title="Confirm it's you"
        primaryLabel={busy ? "Checking…" : "Confirm"}
        onPrimary={submit}
        primaryDisabled={busy || !code.trim()}
      >
        <p className="mb-4 text-sm text-slate-600">
          This action needs a fresh code from your authenticator app. You can also use one of your backup codes.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="6-digit code"
          aria-label="Authenticator code"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base tracking-widest"
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
