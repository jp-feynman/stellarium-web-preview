// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';
import { handleHips } from './scripts/hips-rewrite.mjs';

// /hips/spherex/<channel>/... (the SPHEREx channel rewriter used by the sky app under /sky/) in
// `vite` and `vite preview`, through the same module as scripts/serve.mjs and functions/hips.
const hipsMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url || !/^\/hips(\/|$)/.test(req.url)) return next();
  handleHips(new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method }))
    .then(async (response) => {
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.statusCode = response.status;
      res.end(Buffer.from(await response.arrayBuffer()));
    })
    .catch((e: unknown) => {
      res.statusCode = 502;
      res.end(String(e));
    });
};
const hipsPlugin: Plugin = {
  name: 'hips-rewrite',
  configureServer: (server) => void server.middlewares.use(hipsMiddleware),
  configurePreviewServer: (server) => void server.middlewares.use(hipsMiddleware),
};

// Dev-only relay for the IRSA SIA exposure search, which sends no CORS headers. In production the
// same path is served by the Pages Function in functions/api or scripts/relay.mjs (see docs/DEPLOY.md).
// Only /api/sia is relayed: nothing in src/ calls JPL Horizons, and JPL asks that its APIs not be
// embedded in web sites.

export default defineConfig({
  base: './',
  plugins: [react(), hipsPlugin],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  server: {
    port: 5173,
    watch: { usePolling: true, interval: 700 },
    proxy: {
      '/api/sia': {
        target: 'https://irsa.ipac.caltech.edu',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/sia/, '/SIA'),
        headers: { 'User-Agent': 'sia-relay/1.0' },
      },
    },
  },
  // `vite preview` reuses server.proxy unless told otherwise. PREVIEW_NO_RELAY=1 switches it off to
  // test the build the way a static host without the relay serves it (only the baked presets work).
  preview: { port: 4173, ...(process.env.PREVIEW_NO_RELAY ? { proxy: {} } : {}) },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: process.env.LIVE ? [] : ['tests/live/**', 'node_modules/**'],
    testTimeout: 120000,
  },
} as any);
