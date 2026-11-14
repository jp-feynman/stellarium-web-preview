// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Cloudflare Pages Function for /hips/*: the SPHEREx channel rewriter (scripts/hips-rewrite.mjs, shared
// with the Node server scripts/serve.mjs). It turns each wavelength of the IRSA SPHEREx all-sky HiPS cube
// into an ordinary HiPS at /hips/spherex/<channel>/ so the Stellarium-based sky app under /sky/ can draw
// wavelengths other than channel 1 (0.75 um). GET and HEAD only; tiles are a 302 redirect to IRSA by
// default. Set the Pages environment variable HIPS_MODE=stream to pass the bytes through instead
// (then successful tiles are also kept in the edge cache).
import { handleHips } from '../../scripts/hips-rewrite.mjs';

interface PagesContext {
  request: Request;
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

function edgeCache(): Cache | undefined {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request } = context;
  const mode = context.env?.HIPS_MODE === 'stream' ? 'stream' : 'redirect';
  if (mode !== 'stream' || request.method !== 'GET') return handleHips(request, { mode });

  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
  }
  const response = await handleHips(request, { mode });
  if (cache && response.status === 200) {
    const put = cache.put(cacheKey, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(put);
    else await put;
  }
  return response;
};
