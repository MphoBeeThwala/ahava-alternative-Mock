import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // The project's postcss.config.mjs targets Tailwind v4's own build
  // pipeline (Next.js), not Vite's PostCSS loader, and fails to load here.
  // Tests don't render styled output, so provide an inline (empty) postcss
  // config to stop Vite from discovering and loading that file at all —
  // `css: false` alone still triggers the same failing config search.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
