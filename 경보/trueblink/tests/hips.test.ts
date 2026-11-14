// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The SPHEREx channel rewriter (scripts/hips-rewrite.mjs) and its Pages Function (functions/hips).
// Offline: properties, tile mapping, rejects, methods, stream mode with a stubbed fetch.
// LIVE=1: follows a real redirect to IRSA and checks the PNG.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/hips/[[path]]';
import { skyAppHref } from '../src/app/components/SkyLink';
import { UPSTREAM_CUBE, channelWavelength, handleHips, resolvePath } from '../scripts/hips-rewrite.mjs';

const ORIGIN = 'https://site.example';
const get = (path: string, method = 'GET') => handleHips(new Request(`${ORIGIN}${path}`, { method }));

describe('hips rewriter: properties', () => {
  it.each([
    [1, '0.753'],
    [21, '1.195'],
    [37, '1.735'],
    [102, '4.988'],
  ])('channel %i is an ordinary equatorial PNG image survey at %s um', async (c, w) => {
    const res = await get(`/hips/spherex/${c}/properties`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const text = await res.text();
    const props = Object.fromEntries(
      text
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
    expect(props.hips_order).toBe('5');
    expect(props.hips_order_min).toBe('0');
    expect(props.hips_tile_width).toBe('512');
    expect(props.hips_tile_format).toBe('png');
    expect(props.hips_frame).toBe('equatorial');
    expect(props.dataproduct_type).toBe('image');
    expect(props.obs_title).toBe(`SPHEREx all-sky ${w} um (channel ${c})`);
    expect(props.hips_creator).toMatch(/NASA\/JPL-Caltech\/IPAC/);
    expect(props.obs_copyright).toMatch(/NASA/);
    expect(props.hips_cube_depth).toBeUndefined();
  });

  it('HEAD answers the headers without a body', async () => {
    const res = await get('/hips/spherex/21/properties', 'HEAD');
    expect(res.status).toBe(200);
    expect(Number(res.headers.get('Content-Length'))).toBeGreaterThan(200);
    expect(await res.text()).toBe('');
  });

  it('the embedded wavelength table matches public/data/spectral_channels.json', () => {
    const channels = JSON.parse(readFileSync(new URL('../public/data/spectral_channels.json', import.meta.url), 'utf8')) as Array<{
      cubeChannel: number;
      wavelength: number;
    }>;
    expect(channels).toHaveLength(102);
    for (const ch of channels) expect(channelWavelength(ch.cubeChannel)).toBe(ch.wavelength.toFixed(3));
  });
});

describe('hips rewriter: tiles', () => {
  it('channel 1 maps to the cube frame 0 tile (no suffix), by 302 with CORS and cache headers', async () => {
    const res = await get('/hips/spherex/1/Norder3/Dir0/Npix305.png');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${UPSTREAM_CUBE}/Norder3/Dir0/Npix305.png`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('channel 37 maps to frame 36', async () => {
    const res = await get('/hips/spherex/37/Norder5/Dir10000/Npix12287.png?v=123');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${UPSTREAM_CUBE}/Norder5/Dir10000/Npix12287_36.png`);
    const head = await get('/hips/spherex/37/Norder0/Dir0/Npix0.png', 'HEAD');
    expect(head.status).toBe(302);
    expect(head.headers.get('Location')).toBe(`${UPSTREAM_CUBE}/Norder0/Dir0/Npix0_36.png`);
  });

  it('maps the order-3 Allsky preview and the MOC, nothing else', () => {
    expect(resolvePath('/hips/spherex/1/Norder3/Allsky.png')).toMatchObject({ upstream: `${UPSTREAM_CUBE}/Norder3/Allsky.png` });
    expect(resolvePath('/hips/spherex/102/Norder3/Allsky.png')).toMatchObject({ upstream: `${UPSTREAM_CUBE}/Norder3/Allsky_101.png` });
    expect(resolvePath('/hips/spherex/5/Moc.fits')).toMatchObject({ upstream: `${UPSTREAM_CUBE}/Moc.fits` });
    expect(resolvePath('/hips/spherex/5/Norder0/Allsky.png')).toBeNull();
    expect(resolvePath('/hips/spherex/5/Norder3/Allsky.jpg')).toBeNull();
  });

  it.each([0, 51, 52, 103, 999])('rejects channel %i', async (c) => {
    expect((await get(`/hips/spherex/${c}/properties`)).status).toBe(404);
    expect((await get(`/hips/spherex/${c}/Norder0/Dir0/Npix0.png`)).status).toBe(404);
  });

  it.each([
    '/hips/spherex/',
    '/hips/spherex/21',
    '/hips/spherex/21/',
    '/hips/spherex/021/properties',
    '/hips/spherex/21/properties/',
    '/hips/spherex/21/Norder6/Dir0/Npix0.png', // order above 5
    '/hips/spherex/21/Norder0/Dir0/Npix12.png', // only 12 pixels at order 0
    '/hips/spherex/21/Norder5/Dir0/Npix12287.png', // wrong Dir
    '/hips/spherex/21/Norder5/Dir10000/Npix12288.png',
    '/hips/spherex/21/Norder3/Dir0/Npix05.png', // leading zero
    '/hips/spherex/21/Norder3/Dir0/Npix5.jpg',
    '/hips/spherex/21/Norder3/Dir0/Npix5.png/x',
    '/hips/spherex/21/Norder3/Dir0/Npix-5.png',
    '/hips/spherex/21/Norder3/Dir0/Npix5_20.png',
    '/hips/spherex/21/../../api/sia',
    '/hips/spherex/21/%2e%2e/properties',
    '/hips/spherex/21/Norder3/Dir0/Npix5.png%3Fx=https://evil.example',
    '/hips/other/21/properties',
    '/hips/spherex/abc/properties',
    '/hips/spherex/1e1/properties',
  ])('rejects %s', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('refuses %s', async (method) => {
    const res = await get('/hips/spherex/21/properties', method);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });

  it('the Pages Function answers the same (redirect by default)', async () => {
    const res = await onRequest({ request: new Request(`${ORIGIN}/hips/spherex/37/Norder1/Dir0/Npix47.png`) });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${UPSTREAM_CUBE}/Norder1/Dir0/Npix47_36.png`);
    const props = await onRequest({ request: new Request(`${ORIGIN}/hips/spherex/21/properties`), env: { HIPS_MODE: 'stream' } });
    expect(props.status).toBe(200);
    expect((await onRequest({ request: new Request(`${ORIGIN}/hips/spherex/51/properties`) })).status).toBe(404);
  });
});

describe('hips rewriter: stream mode', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it('fetches the validated upstream URL and passes the bytes with CORS and cache headers', async () => {
    const calls: string[] = [];
    const res = await handleHips(new Request(`${ORIGIN}/hips/spherex/37/Norder2/Dir0/Npix100.png`), {
      mode: 'stream',
      fetch: async (url) => {
        calls.push(url);
        return new Response(png, { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Length': String(png.byteLength) } });
      },
    });
    expect(calls).toEqual([`${UPSTREAM_CUBE}/Norder2/Dir0/Npix100_36.png`]);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });

  it('turns an upstream 404 into 404 and a failure into 502 without caching', async () => {
    const r404 = await handleHips(new Request(`${ORIGIN}/hips/spherex/2/Norder0/Dir0/Npix1.png`), {
      mode: 'stream',
      fetch: async () => new Response('nope', { status: 404 }),
    });
    expect(r404.status).toBe(404);
    const r502 = await handleHips(new Request(`${ORIGIN}/hips/spherex/2/Norder0/Dir0/Npix1.png`), {
      mode: 'stream',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(r502.status).toBe(502);
    expect(r502.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('TrueBlink -> sky app link', () => {
  it('builds the contract B query for a field and the bare address without one', () => {
    expect(skyAppHref('./sky/', { ra: 269.4520827, dec: 4.6933639, name: "Barnard's Star" })).toBe(
      "./sky/?ra=269.452083&dec=4.693364&fov=20&view=sky&spherex=21&name=Barnard%27s+Star",
    );
    expect(skyAppHref('./sky/', { ra: 10, dec: -5 })).toBe('./sky/?ra=10&dec=-5&fov=20&view=sky&spherex=21');
    expect(skyAppHref('./sky/', null)).toBe('./sky/');
    expect(skyAppHref('https://x.example/sky/?lang=ko', { ra: 1, dec: 2 })).toMatch(/\?lang=ko&ra=1&dec=2&/);
  });
});

describe.runIf(process.env.LIVE === '1')('hips rewriter: live IRSA', () => {
  it('channel 21 tile: the redirect target is a PNG with Access-Control-Allow-Origin *', async () => {
    const res = await get('/hips/spherex/21/Norder0/Dir0/Npix4.png');
    const location = res.headers.get('Location') as string;
    const up = await fetch(location, { signal: AbortSignal.timeout(30000) });
    expect(up.status).toBe(200);
    expect(up.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const bytes = new Uint8Array(await up.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const streamed = await handleHips(new Request(`${ORIGIN}/hips/spherex/21/Norder0/Dir0/Npix4.png`), { mode: 'stream' });
    expect(streamed.status).toBe(200);
    expect((await streamed.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });
});
