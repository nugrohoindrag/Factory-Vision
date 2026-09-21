import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3050,
    host: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      // The CMS pages the API renders (see deploy/nginx.landing.conf).
      '^/(site/|blog(/|$)|sitemap\\.xml$|robots\\.txt$|google[0-9a-f]+\\.html$)': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
