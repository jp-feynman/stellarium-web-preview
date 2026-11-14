// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Self-hosted version of functions/api/[[route]].ts: a dependency-free Node (18+) HTTP server that relays
//   GET /api/sia?...  ->  https://irsa.ipac.caltech.edu/SIA?...
// with the same strict rules: GET only, only the SIA parameters the app sends (COLLECTION spherex_*,
// POS, RESPONSEFORMAT, MAXREC, TIME, BAND), a 16 MB answer cap, a 25 s timeout, a generic User-Agent,
// Access-Control-Allow-Origin: *, Cache-Control public/max-age=3600 on success and no-store on errors,
// plus a one-hour in-memory cache.
// Run:  PORT=8787 node scripts/relay.mjs     (HOST=0.0.0.0 to listen on all interfaces; default 127.0.0.1)
// then build the app with VITE_API_BASE=https://<relay-host>/api npm run build.
// handleRequest(Request) -> Response is exported so tests/relay.test.ts can call it without a socket.

import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const UPSTREAM_SIA = 'https://irsa.ipac.caltech.edu/SIA';
export const TIMEOUT_MS = 25000;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_QUERY_LENGTH = 4096;
const MAX_COLLECTIONS = 12;
const USER_AGENT = 'sia-relay/1.0';
const CACHE_TTL_MS = 3600 * 1000;
const CACHE_MAX_ENTRIES = 300;

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?[Ii]nf`;
const PARAMS = {
  COLLECTION: { pattern: /^spherex_[a-z0-9_]{1,40}$/, repeatable: true },
  POS: { pattern: new RegExp(`^(?:circle|range|polygon)(?:\\s+(?:${NUM})){3,40}$`, 'i') },
  RESPONSEFORMAT: {
    pattern: /^(?:csv|tsv|votable|text\/csv|text\/xml|text\/tab-separated-values|application\/x-votable\+xml)$/i,
  },
  MAXREC: { pattern: /^\d{1,7}$/ },
  TIME: { pattern: new RegExp(`^(?:${NUM})(?:\\s+(?:${NUM}))?$`) },
  BAND: { pattern: new RegExp(`^(?:${NUM})(?:\\s+(?:${NUM}))?$`) },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const SAFE = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/** @type {Map<string, { expires: number; status: number; type: string; body: Uint8Array }>} */
const cache = new Map();

function textResponse(status, message) {
  return new Response(`${message}\n`, {
    status,
    headers: { ...CORS, ...SAFE, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Same as canonicalQuery in functions/api/[[route]].ts. */
export function canonicalQuery(search) {
  if (search.length > MAX_QUERY_LENGTH) return { error: 'Query string too long.' };
  const params = new URLSearchParams(search);
  const parts = [];
  const seen = new Map();
  for (const [rawKey, rawValue] of params) {
    const key = rawKey.toUpperCase();
    const rule = Object.hasOwn(PARAMS, key) ? PARAMS[key] : undefined;
    if (!rule) return { error: `Parameter ${rawKey.slice(0, 40)} is not allowed. Allowed: ${Object.keys(PARAMS).join(', ')}.` };
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (!rule.repeatable && count > 1) return { error: `Parameter ${key} may appear only once.` };
    if (key === 'COLLECTION' && count > MAX_COLLECTIONS) return { error: 'Too many COLLECTION values.' };
    const value = rawValue.trim().replace(/\s+/g, ' ');
    if (!rule.pattern.test(value)) return { error: `Value of ${key} is not valid for this relay.` };
    parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`);
  }
  return { query: parts.length ? `?${parts.join('&')}` : '' };
}

async function readCapped(res, limit) {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function safeContentType(type) {
  const t = (type ?? '').toLowerCase();
  if (/^(text\/(csv|xml|plain|tab-separated-values)|application\/(x-votable\+xml|xml))\b/.test(t)) return type;
  return 'text/plain; charset=utf-8';
}

async function relay(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${UPSTREAM_SIA}${query}`, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT },
    });
    const body = await readCapped(upstream, MAX_RESPONSE_BYTES);
    if (!body) return { error: 502, message: `The archive answer is larger than ${MAX_RESPONSE_BYTES / 1048576} MB; search a smaller area.` };
    return { status: upstream.status, type: safeContentType(upstream.headers.get('Content-Type')), body };
  } catch (err) {
    if (ctrl.signal.aborted) return { error: 504, message: `The archive (irsa.ipac.caltech.edu) did not answer within ${TIMEOUT_MS / 1000} s.` };
    return { error: 502, message: `Could not reach the archive (irsa.ipac.caltech.edu): ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function okResponse(out, cacheState) {
  const headers = {
    ...CORS,
    ...SAFE,
    'Content-Type': out.type,
    'Cache-Control': out.status === 200 ? 'public, max-age=3600' : 'no-store',
  };
  if (cacheState) headers['X-Relay-Cache'] = cacheState;
  return new Response(out.body, { status: out.status, headers });
}

/** Forget every cached answer (tests). */
export function clearCache() {
  cache.clear();
}

/** The whole relay as a fetch-style handler. */
export async function handleRequest(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  if (!/^\/api\/sia\/?$/.test(url.pathname)) return textResponse(404, 'Not found. This relay only serves /api/sia.');
  if (request.method !== 'GET') return textResponse(405, 'Only GET is supported.');
  const checked = canonicalQuery(url.search);
  if ('error' in checked) return textResponse(400, checked.error);

  const key = checked.query;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return okResponse(hit, 'hit');
  if (hit) cache.delete(key);

  const out = await relay(checked.query);
  if (out.error) return textResponse(out.error, out.message);
  if (out.status === 200) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { ...out, expires: Date.now() + CACHE_TTL_MS });
  }
  return okResponse(out, 'miss');
}

export function startServer(port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    try {
      const request = new Request(new URL(req.url || '/', 'http://relay.local'), { method: req.method });
      const response = await handleRequest(request);
      const headers = Object.fromEntries(response.headers);
      const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
      if (body) headers['Content-Length'] = String(body.length);
      res.writeHead(response.status, headers);
      res.end(body);
    } catch (err) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`Relay error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });
  server.listen(port, host, () => {
    console.log(`Relay listening on http://${host}:${port}/api/sia  (upstream ${UPSTREAM_SIA})`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
