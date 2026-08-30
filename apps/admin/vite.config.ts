import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 3300 keeps the vendor console away from the customer apps on 3100/3200,
    // so a firewall rule can expose those two and never this one.
    port: 3300,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
