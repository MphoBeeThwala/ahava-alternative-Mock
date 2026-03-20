/**
 * Runtime platform detection + API base URL resolution.
 *
 * Web (Vite dev server / deployed):  VITE_API_URL is ""  → relative URLs work via proxy/same-origin
 * Android Capacitor emulator:        VITE_API_URL=http://10.0.2.2:3000  (host machine localhost)
 * Android Capacitor on real device:  VITE_API_URL=https://your-backend.up.railway.app
 */

import { Capacitor } from "@capacitor/core";

/** True when running inside the Android (or iOS) Capacitor shell */
export const isNative: boolean = Capacitor.isNativePlatform();

/**
 * Returns the absolute backend origin to prefix onto API paths.
 * Empty string on web (relative URLs stay relative).
 */
export function getApiBase(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? "";
}
