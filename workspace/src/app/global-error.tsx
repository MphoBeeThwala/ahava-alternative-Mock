"use client";

// Last-resort boundary for errors in the root layout itself. Reports to error
// tracking (no-op without a DSN) and gives the user a way out.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, color: "#0f172a" }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
        <p>
          The page failed to load. If you need urgent medical help, call 112 or go to your
          nearest emergency unit — do not wait for this page.
        </p>
        <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
