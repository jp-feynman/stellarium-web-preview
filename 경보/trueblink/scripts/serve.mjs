// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Serve the production build (dist/) and the /api/sia relay from one small Node process.
// Use it to self-host on any machine or Node host, or behind a tunnel for a quick public demo:
//   npm run build && node scripts/serve.mjs          (PORT=8080, HOST=127.0.0.1 by default)
// Only files inside dist/ are served; everything under /api goes to the hardened relay in relay.mjs and
// everything under /hips/ to the SPHEREx channel rewriter in hips-rewrite.mjs (HIPS_MODE=stream to pass
// tiles through instead of the default 302 redirect to IRSA). When the combined site was built with
// npm run build:site, the Stellarium-based sky app is served from dist/sky/ like any other files.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './relay.mjs';
import { handleHips } from './hips-rewrite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const HIPS_MODE = process.env.HIPS_MODE === 'stream' ? 'stream' : 'redirect';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  // Types the sky app (dist/sky/, Stellarium Web Engine) needs; same list as its own preview server.
  '.wasm': 'application/wasm',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.md': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
  '.zip': 'application/zip',
  '.xml': 'application/xml',
  '.csv': 'text/csv; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.eph': 'application/octet-stream',
  '.dat': 'application/octet-stream',
};

function cacheControl(path) {
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('/presets/') || path.startsWith('/data/')) return 'public, max-age=86400';
  return 'no-cache';
}

async function relay(req, res, handler = handleRequest) {
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method });
  const response = await handler(request);
  const headers = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Only GET is supported.');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request.');
    return;
  }
  if (pathname.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request.');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden.');
    return;
  }
  // A directory without the trailing slash (for example /sky): redirect so relative URLs resolve inside it.
  if (existsSync(file) && statSync(file).isDirectory() && existsSync(join(file, 'index.html'))) {
    const search = new URL(req.url, 'http://localhost').search;
    res.writeHead(308, { Location: `${encodeURI(pathname)}/${search}`, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found.');
    return;
  }
  const size = statSync(file).size;
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': cacheControl(pathname),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/hips' || path.startsWith('/hips/')) {
      relay(req, res, (request) => handleHips(request, { mode: HIPS_MODE })).catch((e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end(`HiPS rewriter error: ${e && e.message ? e.message : e}`);
      });
    } else if (path === '/api' || path.startsWith('/api/')) {
      relay(req, res).catch((e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end(`Relay error: ${e && e.message ? e.message : e}`);
      });
    } else {
      serveStatic(req, res);
    }
  })
  .listen(PORT, HOST, () => console.log(`TrueBlink: serving ${ROOT}, /api/sia and /hips/spherex/ (${HIPS_MODE}) on http://${HOST}:${PORT}/`));
