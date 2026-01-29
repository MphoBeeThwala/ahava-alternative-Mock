import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: "./wrangler.toml",
      persist: {
        path: ".wrangler/state/v3",
      },
      entry: "./src/worker/index.ts",
      experimental: {
        disableDevProxy: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    exclude: ["@cloudflare/vite-plugin"],
  },
});

