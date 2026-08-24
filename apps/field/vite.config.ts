import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The application shell must be on the device before the technician goes
      // underground; nothing here may depend on a network at run time.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        // API calls are handled by the sync queue, not by a caching strategy:
        // a stale geological reading served from a cache would be worse than
        // an honest "offline".
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'Unki GeoTech — Field',
        short_name: 'GeoTech',
        description: 'Underground geological data capture',
        theme_color: '#0E1013',
        background_color: '#0E1013',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  // The built app is what actually goes underground, so `preview` reaches the
  // API the same way `dev` does — offline behaviour is verified against the
  // real bundle and its service worker, not against the dev server.
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});
