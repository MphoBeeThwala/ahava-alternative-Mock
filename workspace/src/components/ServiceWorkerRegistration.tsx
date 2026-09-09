"use client";

import { useEffect } from "react";

// Registers public/sw.js once the page has loaded. Silently no-ops if the
// browser doesn't support service workers (older Safari, some in-app
// browsers) — the app works identically either way, just without the
// offline fallback / installability.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("[pwa] service worker registration failed:", error);
      });
    };

    // By the time this effect runs (after hydration), `load` may have
    // already fired and will never fire again — register immediately in
    // that case instead of waiting forever.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
