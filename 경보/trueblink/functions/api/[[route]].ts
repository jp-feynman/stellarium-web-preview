// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Cloudflare Pages Function: a tiny, stateless relay for the one service the browser cannot call
// directly because it sends no CORS headers:
//   GET /api/sia?...  ->  https://irsa.ipac.caltech.edu/SIA?...   (SPHEREx exposure search)
// Nothing else is relayed. The relay is strict so it cannot be used as an open proxy:
//   - GET only (OPTIONS answers a CORS preflight; everything else is 405);
//   - only the SIA parameters the app sends: COLLECTION (repeatable, spherex_* only), POS,
//     RESPONSEFORMAT, MAXREC, TIME, BAND; each value is checked against a pattern;
//   - answers larger than MAX_RESPONSE_BYTES are refused, upstream has TIMEOUT_MS to answer;
//   - no visitor header (cookie, referrer, user agent) is forwarded; a generic User-Agent is sent.
// Success: Cache-Control public, max-age=3600 (and the edge cache when available). Errors: no-store.
// scripts/relay.mjs is the same relay as a plain Node server; keep the two in step
// (tests/relay.test.ts runs one table of cases against both).

interface PagesContext {
  request: Request;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const UPSTREAM_SIA = 'https://irsa.ipac.caltech.edu/SIA';
export const TIMEOUT_MS = 25000;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_QUERY_LENGTH = 4096;
const MAX_COLLECTIONS = 12;
const USER_AGENT = 'sia-relay/1.0';

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?[Ii]nf`;
/** Allowed parameters (upper case) and the pattern each decoded value must match. */
const PARAMS: Record<string, { pattern: RegExp; repeatable?: boolean }> = {
  COLLECTION: { pattern: /^spherex_[a-z0-9_]{1,40}$/, repeatable: true },
  POS: { pattern: new RegExp(`^(?:circle|range|polygon)(?:\\s+(?:${NUM})){3,40}$`, 'i') },
  RESPONSEFORMAT: {
    pattern: /^(?:csv|tsv|votable|text\/csv|text\/xml|text\/tab-separated-values|application\/x-votable\+xml)$/i,
  },
  MAXREC: { pattern: /^\d{1,7}$/ },
  TIME: { pattern: new RegExp(`^(?:${NUM})(?:\\s+(?:${NUM}))?$`) },
  BAND: { pattern: new RegExp(`^(?:${NUM})(?:\\s+(?:${NUM}))?$`) },
};

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
/** Relayed bodies are data, never a page: stop browsers from rendering or sniffing them. */
const SAFE: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function textResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { ...CORS, ...SAFE, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Check the query string and rebuild it from the allowed parameters only.
 * Returns the upstream query (starting with '?', or '' when empty) or an error message.
 */
export function canonicalQuery(search: string): { query: string } | { error: string } {
  if (search.length > MAX_QUERY_LENGTH) return { error: 'Query string too long.' };
  const params = new URLSearchParams(search);
  const parts: string[] = [];
  const seen = new Map<string, number>();
  for (const [rawKey, rawValue] of params) {
    const key = rawKey.toUpperCase();
    const rule = PARAMS[key];
    if (!rule) return { error: `Parameter ${rawKey.slice(0, 40)} is not allowed. Allowed: ${Object.keys(PARAMS).join(', ')}.` };
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (!rule.repeatable && count > 1) return { error: `Parameter ${key} may appear only once.` };
    if (key === 'COLLECTION' && count > MAX_COLLECTIONS) return { error: 'Too many COLLECTION values.' };
    const value = rawValue.trim().replace(/\s+/g, ' ');
    if (!rule.pattern.test(value)) return { error: `Value of ${key} is not valid for this relay.` };
    // Values are limited to [A-Za-z0-9_.+-/ ] by the patterns above: encode, spaces as '+'.
    parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`);
  }
  return { query: parts.length ? `?${parts.join('&')}` : '' };
}

/** Read a body, giving up once it passes `limit` bytes. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
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

/** Only data types pass through; anything else (an HTML error page, say) is sent as plain text. */
function safeContentType(type: string | null): string {
  const t = (type ?? '').toLowerCase();
  if (/^(text\/(csv|xml|plain|tab-separated-values)|application\/(x-votable\+xml|xml))\b/.test(t)) return type as string;
  return 'text/plain; charset=utf-8';
}

async function relay(query: string): Promise<Response> {
  const target = `${UPSTREAM_SIA}${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT },
    });
    const body = await readCapped(upstream, MAX_RESPONSE_BYTES);
    if (!body) return textResponse(502, `The archive answer is larger than ${MAX_RESPONSE_BYTES / 1048576} MB; search a smaller area.`);
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        ...SAFE,
        'Content-Type': safeContentType(upstream.headers.get('Content-Type')),
        'Cache-Control': upstream.status === 200 ? 'public, max-age=3600' : 'no-store',
      },
    });
  } catch (err) {
    if (ctrl.signal.aborted) return textResponse(504, `The archive (irsa.ipac.caltech.edu) did not answer within ${TIMEOUT_MS / 1000} s.`);
    return textResponse(502, `Could not reach the archive (irsa.ipac.caltech.edu): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function edgeCache(): Cache | undefined {
  try {
    const g = globalThis as unknown as { caches?: { default?: Cache } };
    return g.caches?.default;
  } catch {
    return undefined;
  }
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  if (!/^\/api\/sia\/?$/.test(url.pathname)) return textResponse(404, 'Not found. This relay only serves /api/sia.');
  if (request.method !== 'GET') return textResponse(405, 'Only GET is supported.');

  const checked = canonicalQuery(url.search);
  if ('error' in checked) return textResponse(400, checked.error);

  const cache = edgeCache();
  // Cache key: our own URL with the canonical query, without any request headers.
  const cacheKey = new Request(`${url.origin}/api/sia${checked.query}`, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
  }

  const response = await relay(checked.query);
  if (cache && response.status === 200) {
    const put = cache.put(cacheKey, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(put);
    else await put;
  }
  return response;
};
