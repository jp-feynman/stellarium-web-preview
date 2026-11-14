// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// SPHEREx channel rewriter: presents each wavelength of the IRSA SPHEREx all-sky HiPS cube as its own
// ordinary (2-D, PNG) HiPS, for viewers such as the Stellarium Web Engine that build tile URLs as
// <base>/Norder%d/Dir%d/Npix%d.<ext> and cannot add the cube's "_<frame>" suffix.
//
//   GET <root>/hips/spherex/<c>/properties                 c = 1..102 except 51, 52 (blank dichroic frames)
//       -> 200 text/plain: HiPS properties of an image survey (order 0-5, 512 px PNG, equatorial).
//   GET <root>/hips/spherex/<c>/Norder<k>/Dir<d>/Npix<n>.png    k = 0..5, n < 12*4^k, d = floor(n/10000)*10000
//       -> the upstream tile  Norder<k>/Dir<d>/Npix<n>.png (c = 1)  or  Npix<n>_<c-1>.png (c > 1).
//   GET <root>/hips/spherex/<c>/Norder3/Allsky.png  -> upstream Norder3/Allsky.png or Allsky_<c-1>.png
//       (the only order with an Allsky preview upstream); GET .../Moc.fits -> upstream Moc.fits.
//   Anything else: 404. Methods other than GET and HEAD: 405.
//
// Tiles are served either by a 302 redirect to IRSA (default; IRSA sends Access-Control-Allow-Origin: *
// so the redirected image stays readable by WebGL) or by streaming the bytes through (mode 'stream').
// The upstream URL is always rebuilt from validated numbers, never copied from the request, so this is
// not an open redirect or an open proxy. Query strings (cache busters) are ignored.
// handleHips(Request, options?) -> Promise<Response> uses Fetch API types only: it runs unchanged in a
// Cloudflare Pages Function (functions/hips/[[path]].ts) and in Node 18+ (scripts/serve.mjs).

export const UPSTREAM_CUBE = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
export const PREFIX = '/hips/spherex/';
export const DEFAULT_MODE = 'redirect';
export const TIMEOUT_MS = 20000;
export const MAX_TILE_BYTES = 16 * 1024 * 1024;
export const BLANK_CHANNELS = [51, 52];
export const MAX_ORDER = 5;
const USER_AGENT = 'hips-rewrite/1.0';
const CACHE = 'public, max-age=86400';

// Central wavelength (um) of cube channels 1..102, from public/data/spectral_channels.json rounded to
// 3 decimals (identical to data_cube_crval3_arr in the upstream properties; tests/hips.test.ts checks it).
const WAVELENGTHS_UM = (
  '0.753 0.771 0.790 0.809 0.828 0.848 0.868 0.889 0.910 0.932 0.955 0.978 1.001 1.025 1.050 1.075 1.102 ' +
  '1.113 1.139 1.167 1.195 1.224 1.254 1.284 1.315 1.346 1.378 1.412 1.446 1.481 1.517 1.554 1.592 1.631 ' +
  '1.656 1.695 1.735 1.775 1.818 1.861 1.905 1.949 1.995 2.041 2.089 2.139 2.189 2.240 2.292 2.345 2.399 ' +
  '2.445 2.506 2.575 2.646 2.719 2.794 2.871 2.951 3.033 3.118 3.204 3.293 3.383 3.476 3.570 3.667 3.768 ' +
  '3.833 3.867 3.901 3.935 3.970 4.005 4.040 4.076 4.112 4.148 4.184 4.220 4.257 4.294 4.331 4.368 4.405 ' +
  '4.435 4.467 4.500 4.533 4.566 4.600 4.635 4.669 4.704 4.739 4.773 4.808 4.843 4.879 4.915 4.951 4.988'
).split(' ');

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
};

/** Wavelength label (um, 3 decimals) of cube channel c (1..102), or undefined. */
export function channelWavelength(c) {
  return Number.isInteger(c) && c >= 1 && c <= WAVELENGTHS_UM.length ? WAVELENGTHS_UM[c - 1] : undefined;
}

/** True for a channel this rewriter serves: 1..102 except the blank 51 and 52. */
export function isServedChannel(c) {
  return channelWavelength(c) !== undefined && !BLANK_CHANNELS.includes(c);
}

/** Digits only, no leading zero (except "0" itself), at most `max` digits. */
function intOf(s, max) {
  if (!/^(0|[1-9]\d*)$/.test(s) || s.length > max) return undefined;
  return Number(s);
}

/** Cube-frame suffix for channel c: '' for channel 1 (frame 0), '_<c-1>' otherwise. */
function suffix(c) {
  return c === 1 ? '' : `_${c - 1}`;
}

/**
 * Map a request pathname to what it means. Returns
 *   { kind: 'properties', channel } | { kind: 'file', channel, upstream } | null (= 404).
 * Exported for the unit tests.
 */
export function resolvePath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX) || pathname.length > 120) return null;
  const parts = pathname.slice(PREFIX.length).split('/');
  const channel = intOf(parts[0] ?? '', 3);
  if (channel === undefined || !isServedChannel(channel)) return null;
  const rest = parts.slice(1);
  if (rest.length === 1 && rest[0] === 'properties') return { kind: 'properties', channel };
  if (rest.length === 1 && rest[0] === 'Moc.fits') return { kind: 'file', channel, upstream: `${UPSTREAM_CUBE}/Moc.fits`, type: 'application/fits' };
  if (rest.length === 2 && rest[0] === 'Norder3' && rest[1] === 'Allsky.png') {
    return { kind: 'file', channel, upstream: `${UPSTREAM_CUBE}/Norder3/Allsky${suffix(channel)}.png`, type: 'image/png' };
  }
  if (rest.length !== 3) return null;
  const mo = /^Norder(\d+)$/.exec(rest[0]);
  const md = /^Dir(\d+)$/.exec(rest[1]);
  const mn = /^Npix(\d+)\.png$/.exec(rest[2]);
  if (!mo || !md || !mn) return null;
  const k = intOf(mo[1], 1);
  const d = intOf(md[1], 6);
  const n = intOf(mn[1], 6);
  if (k === undefined || d === undefined || n === undefined) return null;
  if (k > MAX_ORDER || n >= 12 * 4 ** k || d !== Math.floor(n / 10000) * 10000) return null;
  return { kind: 'file', channel, upstream: `${UPSTREAM_CUBE}/Norder${k}/Dir${d}/Npix${n}${suffix(channel)}.png`, type: 'image/png' };
}

/** HiPS properties text for channel c (assumed valid). */
export function propertiesText(c) {
  const w = channelWavelength(c);
  const lines = [
    ['obs_title', `SPHEREx all-sky ${w} um (channel ${c})`],
    [
      'obs_description',
      `One wavelength (${w} um, cube channel ${c} of 102, cube frame ${c - 1}) of the SPHEREx DR1 all-sky ` +
        'spectral cube, shown as an ordinary image survey. The tiles are averages over about a year of observing, ' +
        'so they cannot show changes over time. Tiles are the unchanged IRSA files.',
    ],
    ['obs_collection', 'SPHEREx DR1'],
    ['obs_regime', 'Infrared'],
    ['prov_progenitor', 'SPHEREx / IPAC; channel view of ' + UPSTREAM_CUBE],
    ['hips_creator', 'SPHEREx Science Data Center, NASA/JPL-Caltech/IPAC (IRSA)'],
    ['hips_copyright', 'Caltech/IPAC'],
    ['obs_copyright', 'NASA/JPL-Caltech/IPAC IRSA, SPHEREx'],
    ['obs_copyright_url', 'https://irsa.ipac.caltech.edu/Missions/spherex.html'],
    ['bib_reference_url', 'https://doi.org/10.26131/IRSA679'],
    [
      'obs_ack',
      'This publication makes use of data products from SPHEREx, a joint project of the Jet Propulsion Laboratory ' +
        'and the California Institute of Technology, funded by the National Aeronautics and Space Administration.',
    ],
    ['hips_version', '1.4'],
    ['hips_release_date', '2026-11-01T01:58Z'],
    ['hips_status', 'public mirror unclonable'],
    ['hips_frame', 'equatorial'],
    ['hips_order', String(MAX_ORDER)],
    ['hips_order_min', '0'],
    ['hips_tile_width', '512'],
    ['hips_tile_format', 'png'],
    ['dataproduct_type', 'image'],
    ['hips_pixel_scale', '0.0035786'],
    ['hips_initial_ra', '180.00000'],
    ['hips_initial_dec', '-57.99462'],
    ['hips_initial_fov', '359.620'],
    ['moc_sky_fraction', '1.000000'],
  ];
  return lines.map(([k, v]) => `${k.padEnd(20)} = ${v}`).join('\n') + '\n';
}

function textResponse(status, message, extra = {}) {
  return new Response(`${message}\n`, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

async function stream(target, method, type, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetchImpl(target, {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: type, 'User-Agent': USER_AGENT },
    });
    if (upstream.status === 404) {
      await upstream.body?.cancel().catch(() => undefined);
      return textResponse(404, 'Not found upstream.');
    }
    if (upstream.status !== 200) {
      await upstream.body?.cancel().catch(() => undefined);
      return textResponse(502, `Upstream answered ${upstream.status}.`);
    }
    const declared = Number(upstream.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > MAX_TILE_BYTES) {
      await upstream.body?.cancel().catch(() => undefined);
      return textResponse(502, 'Upstream file too large.');
    }
    const body = method === 'HEAD' ? null : new Uint8Array(await upstream.arrayBuffer());
    if (body && body.byteLength > MAX_TILE_BYTES) return textResponse(502, 'Upstream file too large.');
    const headers = { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': CACHE };
    if (body) headers['Content-Length'] = String(body.byteLength);
    else if (Number.isFinite(declared) && upstream.headers.get('Content-Length')) headers['Content-Length'] = String(declared);
    return new Response(body, { status: 200, headers });
  } catch (err) {
    if (ctrl.signal.aborted) return textResponse(504, `IRSA did not answer within ${TIMEOUT_MS / 1000} s.`);
    return textResponse(502, `Could not reach IRSA: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handle one request under /hips/spherex/.
 * options.mode: 'redirect' (default, 302 to IRSA) or 'stream' (fetch and pass the bytes through).
 * options.fetch: fetch implementation for stream mode (tests).
 */
export async function handleHips(request, options = {}) {
  const mode = options.mode === 'stream' ? 'stream' : DEFAULT_MODE;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...BASE_HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store' },
    });
  }
  if (method !== 'GET' && method !== 'HEAD') return textResponse(405, 'Only GET and HEAD are supported.', { Allow: 'GET, HEAD' });
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return textResponse(400, 'Bad request.');
  }
  const r = resolvePath(pathname);
  if (!r) return textResponse(404, 'Not found. Served: /hips/spherex/<channel 1-102 except 51, 52>/properties and HiPS tiles of order 0-5.');
  if (r.kind === 'properties') {
    const text = propertiesText(r.channel);
    return new Response(method === 'HEAD' ? null : text, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': CACHE,
        'Content-Length': String(new TextEncoder().encode(text).byteLength),
      },
    });
  }
  if (mode === 'stream') return stream(r.upstream, method, r.type, options.fetch ?? fetch);
  return new Response(null, {
    status: 302,
    headers: { ...BASE_HEADERS, Location: r.upstream, 'Cache-Control': CACHE },
  });
}
