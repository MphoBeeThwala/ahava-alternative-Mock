/**
 * vite.capacitor.config.ts
 *
 * Stripped-down Vite config for Android/Capacitor builds.
 * Excludes @cloudflare/vite-plugin (server-side only) so the
 * pure SPA is output to dist/client for `npx cap sync android`.
 *
 * Usage:  pnpm build:capacitor
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Backend URL injected at Capacitor build time.
 *
 * Emulator:     http://10.0.2.2:3000   (host machine localhost as seen from the Android emulator)
 * Real device:  https://your-backend.up.railway.app
 *
 * Override by setting CAPACITOR_API_URL in your shell before building:
 *   $env:CAPACITOR_API_URL="https://my-api.up.railway.app"; pnpm build:capacitor
 */
const apiUrl = process.env.CAPACITOR_API_URL ?? "http://10.0.2.2:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
