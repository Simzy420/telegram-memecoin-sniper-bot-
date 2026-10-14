import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project Pages path: https://simzy420.github.io/command-center/
 *  Vercel (VERCEL=1) uses `/` so /api/generate-image works at the deployment root. */
const pagesBase = process.env.VERCEL ? '/' : '/command-center/';

export default defineConfig({
  base: pagesBase,
  plugins: [
    {
      name: 'accounts-api',
      async configureServer(server) {
        const { handleAccountsRequest } = await import('./api/_lib/accounts.ts');
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/accounts')) {
            next();
            return;
          }
          handleAccountsRequest(req, res).catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Account request failed.' }));
            }
          });
        });
      },
      async configurePreviewServer(server) {
        const { handleAccountsRequest } = await import('./api/_lib/accounts.ts');
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/accounts')) {
            next();
            return;
          }
          handleAccountsRequest(req, res).catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Account request failed.' }));
            }
          });
        });
      },
    },
    {
      name: 'drive-api',
      async configureServer(server) {
        const { handleDriveRequest } = await import('./api/_lib/handle.ts');
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/drive')) {
            next();
            return;
          }
          handleDriveRequest(req, res).catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Drive request failed.' }));
            }
          });
        });
      },
      async configurePreviewServer(server) {
        const { handleDriveRequest } = await import('./api/_lib/handle.ts');
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/drive')) {
            next();
            return;
          }
          handleDriveRequest(req, res).catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Drive request failed.' }));
            }
          });
        });
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Dark Command Center',
        short_name: 'Command',
        description: 'Phone-first multi-bot command center. Observe, analyze, command.',
        theme_color: '#050816',
        background_color: '#050816',
        display: 'standalone',
        orientation: 'portrait',
        start_url: pagesBase,
        scope: pagesBase,
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        navigateFallback: `${pagesBase}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/image\.pollinations\.ai\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pollinations-images',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      // Dev only. The browser stays on this Vite origin; the mail process is loopback.
      '/api/gmail': { target: 'http://127.0.0.1:8787' },
    },
  },
  preview: {
    proxy: {
      '/api/gmail': { target: 'http://127.0.0.1:8787' },
    },
  },
});
