import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => {
  const standalone = process.env['VITE_DEPLOYMENT'] === 'standalone';

  return {
  plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
  build: {
    chunkSizeWarningLimit: 4096,
    assetsInlineLimit: standalone ? 100_000_000 : 4096,
  },
  server: {
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  preview: {
    port: 4174,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  };
});
