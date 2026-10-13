/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // In development the API is proxied so the browser sees a single origin (cookies stay SameSite=Lax).
  const apiTarget = env.VITE_DEV_API_PROXY ?? 'http://localhost:4100';
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5180,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: false },
      },
    },
    preview: { port: 5180 },
    // Heavy modules (three.js globe, charts) are split via React.lazy route/component imports.
    build: { sourcemap: true, chunkSizeWarningLimit: 2200 }, // the lazily-loaded three.js globe chunk is ~2 MB
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
