import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: api, ws: true },
      '/media': api,
    },
  },
  build: { target: 'es2020', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
