import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Where the dev server proxies the API.
 *
 * Overridable so a QA run can point the browser at a controlled API instance
 * instead of whatever long-lived `pnpm dev` process happens to hold port 4000 —
 * a stale one silently produces wrong answers, which is worse than no answer.
 */
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/socket.io': {
        target: API_TARGET,
        ws: true,
      },
    },
  },
});
