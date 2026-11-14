// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The SIA relay, both flavours: the Cloudflare Pages Function (functions/api/[[route]].ts, onRequest)
// and the Node server (scripts/relay.mjs, handleRequest). Offline cases stub fetch; LIVE=1 also
// calls the real IRSA SIA service through each of them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/[[route]]';
import { buildSiaUrl } from '../src/core/archive';

type Handler = (req: Request) => Promise<Response>;

// Plain .mjs without type declarations: import it through a variable so tsc treats it as any.
const relayPath = '../scripts/relay.mjs';
const nodeRelay = (await import(/* @vite-ignore */ relayPath)) as { handleRequest: Handler; clearCache: () => void };

const HANDLERS: Array<[string, Handler]> = [
  ['Pages Function', (req) => onRequest({ request: req })],
  ['Node relay', (req) => nodeRelay.handleRequest(req)],
];

const ORIGIN = 'https://site.example';
const req = (path: string, init?: RequestInit): Request => new Request(`${ORIGIN}${path}`, init);

interface Call {
  url: string;
  headers: Headers;
}

function stubFetch(answer: (url: string, init?: RequestInit) => Promise<Response> | Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return answer(url, init);
  });
  return calls;
}

const VOTABLE = '<?xml version="1.0"?><VOTABLE><RESOURCE><PARAM name="COLLECTION"><VALUES><OPTION value="spherex_dr1"/></VALUES></PARAM></RESOURCE></VOTABLE>';
let uniq = 0;
/** A query no earlier test used, so the Node relay's in-memory cache cannot answer it. */
const fresh = (): string => `COLLECTION=spherex_dr1&POS=circle+10+20+0.00${++uniq}&RESPONSEFORMAT=CSV`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  nodeRelay.clearCache();
});

describe.each(HANDLERS)('%s', (_name, handle) => {
  it('relays MAXREC=0 to IRSA with CORS, a generic User-Agent and an hour of caching', async () => {
    const calls = stubFetch(() => new Response(VOTABLE, { status: 200, headers: { 'Content-Type': 'application/x-votable+xml' } }));
    const res = await handle(req('/api/sia?MAXREC=0', { headers: { Cookie: 'secret=1', Referer: 'https://x.example/', 'User-Agent': 'Visitor/1.0' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(res.headers.get('Content-Type')).toBe('application/x-votable+xml');
    expect(await res.text()).toContain('spherex_dr1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://irsa.ipac.caltech.edu/SIA?MAXREC=0');
    expect(calls[0].headers.get('User-Agent')).toBe('sia-relay/1.0');
    expect(calls[0].headers.get('Cookie')).toBeNull();
    expect(calls[0].headers.get('Referer')).toBeNull();
  });

  it('accepts every query the app builds and forwards it unchanged', async () => {
    const calls = stubFetch(() => new Response('a,b\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    const urls = [
      buildSiaUrl('/api/sia', 'spherex_dr1', { ra: 133.7595, dec: -7.2422 }),
      buildSiaUrl('/api/sia', 'spherex_qr3_deep', { ra: 0.000001, dec: -89.5 }, { radiusDeg: 0.05, maxrec: 20000 }),
      buildSiaUrl('/api/sia', 'spherex_dr1', { ra: 359.99, dec: 66.56 }, { time: [61000.5, 61200.25], bandMicrons: [0.75, 5.0], maxrec: 0 }),
      buildSiaUrl('/api/sia', 'spherex_dr1', { ra: 10, dec: 20 }, { radiusDeg: 1e-7 }),
    ];
    for (const u of urls) {
      const res = await handle(req(u));
      expect(res.status, u).toBe(200);
    }
    expect(calls.map((c) => c.url)).toEqual(urls.map((u) => u.replace('/api/sia', 'https://irsa.ipac.caltech.edu/SIA')));
  });

  it('accepts a repeated COLLECTION, lower-case names and a trailing slash', async () => {
    const calls = stubFetch(() => new Response('x', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    const res = await handle(req('/api/sia/?collection=spherex_dr1&COLLECTION=spherex_qr3&pos=CIRCLE%2010%2020%200.01&responseformat=csv'));
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&COLLECTION=spherex_qr3&POS=CIRCLE+10+20+0.01&RESPONSEFORMAT=csv');
  });

  it.each([
    ['an unknown parameter', '/api/sia?MAXREC=0&FORMAT=html'],
    ['a non-SPHEREx collection', '/api/sia?COLLECTION=allwise_images&POS=circle+1+2+0.1'],
    ['a collection with odd characters', '/api/sia?COLLECTION=spherex_dr1%26x%3D1'],
    ['two POS values', '/api/sia?POS=circle+1+2+0.1&POS=circle+3+4+0.1'],
    ['a POS that is not numbers', '/api/sia?POS=circle+1+2+%3Cscript%3E'],
    ['an HTML RESPONSEFORMAT', '/api/sia?RESPONSEFORMAT=text%2Fhtml'],
    ['a huge MAXREC', '/api/sia?MAXREC=999999999'],
    ['a TIME with letters', '/api/sia?TIME=today'],
    ['an over-long query', `/api/sia?${'COLLECTION=spherex_dr1&'.repeat(300)}`],
  ])('refuses %s with 400 and no-store, without calling IRSA', async (_what, path) => {
    const calls = stubFetch(() => new Response('should not be called'));
    const res = await handle(req(path));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(calls).toHaveLength(0);
  });

  it('serves only /api/sia and only GET', async () => {
    const calls = stubFetch(() => new Response('should not be called'));
    for (const path of ['/api/horizons?COMMAND=499', '/api/tap', '/api/sia/extra', '/api/SIA']) {
      const res = await handle(req(path));
      expect(res.status, path).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    const post = await handle(req('/api/sia?MAXREC=0', { method: 'POST', body: 'x' }));
    expect(post.status).toBe(405);
    const pre = await handle(req('/api/sia', { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(calls).toHaveLength(0);
  });

  it('passes upstream errors through with no-store', async () => {
    stubFetch(() => new Response('<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">bad</INFO></VOTABLE>', { status: 400, headers: { 'Content-Type': 'text/xml' } }));
    const res = await handle(req(`/api/sia?${fresh()}`));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('QUERY_STATUS');
  });

  it('never serves an upstream HTML page as HTML', async () => {
    stubFetch(() => new Response('<html><script>alert(1)</script></html>', { status: 503, headers: { 'Content-Type': 'text/html' } }));
    const res = await handle(req(`/api/sia?${fresh()}`));
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('refuses answers over 16 MB (declared or streamed) with 502 and no-store', async () => {
    stubFetch(() => new Response('x', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Length': String(17 * 1048576) } }));
    const declared = await handle(req(`/api/sia?${fresh()}`));
    expect(declared.status).toBe(502);
    expect(declared.headers.get('Cache-Control')).toBe('no-store');

    const chunk = new Uint8Array(1048576);
    stubFetch(() => {
      let n = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (n++ < 20) c.enqueue(chunk);
          else c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
    });
    const streamed = await handle(req(`/api/sia?${fresh()}`));
    expect(streamed.status).toBe(502);
    expect(await streamed.text()).toMatch(/larger than 16 MB/);
  });

  it('answers 502 when IRSA cannot be reached', async () => {
    stubFetch(() => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')));
    const res = await handle(req(`/api/sia?${fresh()}`));
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives up after 25 s with 504', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = handle(req(`/api/sia?${fresh()}`));
    await vi.advanceTimersByTimeAsync(24000);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe.skipIf(!process.env.LIVE).each(HANDLERS)('%s against live IRSA (LIVE=1)', (_name, handle) => {
  it('lists SPHEREx collections for MAXREC=0', async () => {
    const res = await handle(req('/api/sia?MAXREC=0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const text = await res.text();
    expect(text).toMatch(/spherex_dr1/);
    expect(text).toMatch(/spherex_qr3/);
  });

  it('finds WISE 0855-0714 exposures', async () => {
    const res = await handle(req(buildSiaUrl('/api/sia', 'spherex_dr1', { ra: 133.7595, dec: -7.2422 })));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const rows = (await res.text()).trim().split('\n');
    expect(rows[0]).toMatch(/access_url/);
    expect(rows.length).toBeGreaterThan(50);
  });
});
