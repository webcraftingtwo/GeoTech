import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Inlines the favicon for the standalone build.
 *
 * `vite-plugin-singlefile` inlines the script and stylesheet but leaves the
 * icon as a link to a sibling file, which a hand-over copy never has: the
 * technician is given one .html and nothing else. A missing icon is cosmetic,
 * but a self-contained file that quietly requests a file it was not given is
 * not self-contained, and the next thing to be left out that way might not be
 * cosmetic.
 */
function inlineFavicon(publicDir: string) {
  return {
    name: 'geotech-inline-favicon',
    // After the single-file plugin, which rewrites the href to a relative path
    // of its own before this runs.
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        const svg = readFileSync(resolve(publicDir, 'icon.svg'), 'utf8');
        const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        return html.replace(/href="\.?\/?icon\.svg"/, `href="${uri}"`);
      },
    },
  };
}

export default defineConfig(() => {
  const standalone = process.env['VITE_DEPLOYMENT'] === 'standalone';

  return {
  plugins: [react(), ...(standalone ? [viteSingleFile(), inlineFavicon('public')] : [])],
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
