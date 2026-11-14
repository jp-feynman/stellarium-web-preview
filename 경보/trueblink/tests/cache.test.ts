// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeBundle } from '../src/core/bundle';
import {
  answerFrom,
  cacheStats,
  clearCache,
  configureCache,
  cropToRequest,
  cutoutSource,
  deserializeCutout,
  getCutout,
  IdbCutoutStore,
  MemoryCutoutStore,
  preloadBundle,
  registerBundleCutouts,
  serializeCutout,
  storeKey,
  windowContains,
  type CutoutStore,
  type GetCutoutOptions,
} from '../src/core/cache';
import { planWindow } from '../src/core/frames';
import { pixelAreaArcsec2, skyToPix } from '../src/core/wcs';
import { channelAt, cubeChannelAt, waveAt, waveTables } from '../src/core/wave';
import type { DetectorId, Exposure, FrameHeader, NativeCutout, SkyPos, TanSipWcs } from '../src/core/types';

// A synthetic detector whose pixel values are a known function of (x, y), so any window can be checked.
const pixel = (x: number, y: number) => x * 10000 + y + 0.25;
const S = 6.15 / 3600;
const WCS: TanSipWcs = { crval: [150, 2], crpix: [1020.5, 1020.5], cd: [[-S * 0.8, S * 0.6], [S * 0.6, S * 0.8]], naxis: [2040, 2040] };
const CENTER: SkyPos = { ra: 150.05, dec: 2.03 };

function exposure(k: number): Exposure {
  const obsId = `2025W45_1B_${String(k).padStart(4, '0')}_1`;
  const det = (((k - 1) % 6) + 1) as DetectorId;
  return {
    id: `${obsId}D${det}`,
    obsId,
    detector: det,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: 61000 + k,
    mjdEnd: 61000 + k + 0.001,
    mjd: 61000 + k,
    url: '',
    s3Key: `dr1/level2/x/${det}/file${k}.fits`,
    sRa: 150,
    sDec: 2,
    sRegion: [],
    emMin: 0.75,
    emMax: 1.1,
    pipelineTag: 'l2b-v27',
  };
}

function header(e: Exposure): FrameHeader {
  return {
    wcs: WCS,
    detector: e.detector,
    obsId: e.obsId,
    mjdAvg: e.mjd,
    mjdBeg: e.mjdStart,
    mjdEnd: e.mjdEnd,
    exptime: 113.58,
    cards: {},
    layout: { url: e.s3Key, imageDataOffset: 0, flagsHeaderOffset: 0 },
  };
}

/** What the archive would return (same rules as core/frames loadCutout). */
function synthLoad(e: Exposure, pos: SkyPos, fov: number, planes: string[] = []): NativeCutout | null {
  const h = header(e);
  const w = planWindow(h.wcs, pos, fov);
  if (!w) return null;
  const n = w.nx * w.ny;
  const plane = (f: (x: number, y: number) => number) => {
    const a = new Float32Array(n);
    for (let j = 0; j < w.ny; j++) for (let i = 0; i < w.nx; i++) a[j * w.nx + i] = f(w.x0 + i, w.y0 + j);
    return a;
  };
  const [xt, yt] = skyToPix(h.wcs, pos.ra, pos.dec);
  const wave = waveAt(waveTables()[e.detector], xt, yt);
  return {
    exposure: e,
    header: h,
    ...w,
    image: plane(pixel),
    ...(planes.includes('FLAGS') ? { flags: Int32Array.from(plane((x, y) => (x + y) % 7 === 0 ? 1 << 21 : 0)) } : {}),
    ...(planes.includes('VARIANCE') ? { variance: plane((x, y) => 0.01 * (x - y)) } : {}),
    ...(planes.includes('ZODI') ? { zodi: plane(() => 0.3) } : {}),
    targetPix: [xt, yt],
    wavelength: wave.wavelength,
    bandwidth: wave.bandwidth,
    channel: channelAt(xt, yt),
    cubeChannel: cubeChannelAt(e.detector, xt, yt),
    omegaArcsec2: pixelAreaArcsec2(h.wcs, xt, yt),
  };
}

let loaderCalls: string[] = [];
const loader = async (e: Exposure, pos: SkyPos, fov: number, o: GetCutoutOptions) => {
  loaderCalls.push(e.id);
  return synthLoad(e, pos, fov, o.planes ?? []);
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('window containment', () => {
  it('accepts inner windows and rejects any overhang', () => {
    const outer = { x0: 10, y0: 20, nx: 30, ny: 40 };
    expect(windowContains(outer, outer)).toBe(true);
    expect(windowContains(outer, { x0: 11, y0: 21, nx: 29, ny: 39 })).toBe(true);
    expect(windowContains(outer, { x0: 9, y0: 21, nx: 5, ny: 5 })).toBe(false);
    expect(windowContains(outer, { x0: 11, y0: 21, nx: 30, ny: 5 })).toBe(false);
    expect(windowContains(outer, { x0: 11, y0: 19, nx: 5, ny: 5 })).toBe(false);
    expect(windowContains(outer, { x0: 11, y0: 21, nx: 5, ny: 40 })).toBe(false);
  });

  it('a wide stored window answers a nearby centre exactly like the archive would', () => {
    const e = exposure(1);
    const big = synthLoad(e, CENTER, 240, ['FLAGS'])!;
    const near = { ra: CENTER.ra + 10 / 3600, dec: CENTER.dec - 8 / 3600 };
    const hit = answerFrom([big], near, 180, ['FLAGS']);
    expect(hit?.cutout).toBeTruthy();
    const want = synthLoad(e, near, 180, ['FLAGS'])!;
    const got = hit!.cutout!;
    expect([got.x0, got.y0, got.nx, got.ny]).toEqual([want.x0, want.y0, want.nx, want.ny]);
    expect(Array.from(got.image)).toEqual(Array.from(want.image));
    expect(Array.from(got.flags!)).toEqual(Array.from(want.flags!));
    expect(got.targetPix).toEqual(want.targetPix);
    expect([got.wavelength, got.bandwidth, got.channel, got.cubeChannel, got.omegaArcsec2]).toEqual([
      want.wavelength,
      want.bandwidth,
      want.channel,
      want.cubeChannel,
      want.omegaArcsec2,
    ]);
    // Far away (window leaves the stored one) -> miss; missing plane -> miss; off the detector -> null answer.
    expect(answerFrom([big], { ra: CENTER.ra + 90 / 3600, dec: CENTER.dec }, 180, ['FLAGS'])).toBeUndefined();
    expect(answerFrom([big], CENTER, 300, [])).toBeUndefined();
    expect(answerFrom([big], CENTER, 180, ['VARIANCE'])).toBeUndefined();
    expect(answerFrom([big], { ra: 170, dec: 2 }, 180, [])).toEqual({ cutout: null });
    // A request without FLAGS drops the plane like loadCutout would.
    expect(answerFrom([big], CENTER, 180, [])!.cutout!.flags).toBeUndefined();
    expect(() => cropToRequest(big, { x0: 0, y0: 0, nx: 5, ny: 5 }, CENTER, [])).toThrow();
  });
});

describe('getCutout layers', () => {
  let store: MemoryCutoutStore;
  beforeEach(async () => {
    loaderCalls = [];
    store = new MemoryCutoutStore();
    configureCache({ loader, store });
    await clearCache({ bundles: true });
  });
  afterEach(async () => {
    await clearCache({ bundles: true });
  });

  it('archive first, then the browser cache, never the loader twice', async () => {
    const e = exposure(2);
    const a = await getCutout(e, CENTER, 180, { planes: ['FLAGS', 'VARIANCE', 'ZODI'] });
    expect(cutoutSource(e.id)).toBe('archive');
    await settle();
    expect((await store.stats()).count).toBe(1);
    const b = await getCutout(e, CENTER, 180, { planes: ['VARIANCE'] });
    expect(cutoutSource(e.id)).toBe('cache');
    expect(loaderCalls).toEqual([e.id]);
    expect(Array.from(b!.variance!)).toEqual(Array.from(a!.variance!));
    expect(b!.flags).toBeUndefined();
    // Bigger field than stored: back to the archive.
    await getCutout(e, CENTER, 400, {});
    expect(cutoutSource(e.id)).toBe('archive');
    expect(loaderCalls.length).toBe(2);
    const st = await cacheStats();
    expect(st.hits).toEqual({ bundle: 0, cache: 1, archive: 2 });
    expect(st.store.available).toBe(true);
  });

  it('bundle beats cache beats archive; bundle misses fall through', async () => {
    const e1 = exposure(3);
    const e2 = exposure(4);
    registerBundleCutouts('demo', [synthLoad(e1, CENTER, 240, ['FLAGS'])!]);
    await getCutout(e1, CENTER, 180, { planes: ['FLAGS'] });
    expect(cutoutSource(e1.id)).toBe('bundle');
    expect(loaderCalls).toEqual([]);
    // ZODI is not in the bundle -> archive.
    await getCutout(e1, CENTER, 180, { planes: ['ZODI'] });
    expect(cutoutSource(e1.id)).toBe('archive');
    // An exposure not in the bundle -> archive, then cache.
    await getCutout(e2, CENTER, 180, {});
    await settle();
    await getCutout(e2, CENTER, 180, {});
    expect(cutoutSource(e2.id)).toBe('cache');
    expect(loaderCalls).toEqual([e1.id, e2.id]);
    // Bundle cutouts are not copied into the browser cache.
    expect([...store.recs.keys()].some((k) => k.includes('|IMAGE+FLAGS') && k.startsWith(e1.s3Key))).toBe(false);
  });

  it('a broken store falls through to the archive', async () => {
    const broken: CutoutStore = {
      list: async () => {
        throw new Error('QuotaExceededError');
      },
      put: async () => {
        throw new Error('QuotaExceededError');
      },
      touch: async () => undefined,
      clear: async () => undefined,
      stats: async () => ({ count: 0, bytes: 0 }),
    };
    configureCache({ store: broken });
    const e = exposure(5);
    expect(await getCutout(e, CENTER, 180, {})).toBeTruthy();
    await settle();
    expect(cutoutSource(e.id)).toBe('archive');
    expect((await cacheStats()).storeErrors).toBeGreaterThanOrEqual(2);
  });

  it('off-detector positions answer null', async () => {
    expect(await getCutout(exposure(6), { ra: 170, dec: 2 }, 180, {})).toBeNull();
  });

  it('honours an aborted signal before touching any layer', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(getCutout(exposure(7), CENTER, 180, { signal: ac.signal })).rejects.toThrow();
    expect(loaderCalls).toEqual([]);
  });
});

describe('browser cache storage', () => {
  it('serializes every plane bit-exactly', () => {
    const c = synthLoad(exposure(8), CENTER, 120, ['FLAGS', 'VARIANCE', 'ZODI'])!;
    c.image[3] = NaN;
    const r = serializeCutout(c, 5);
    expect(r.id).toBe(storeKey(c, ['ZODI', 'FLAGS', 'VARIANCE']));
    expect(r.id.endsWith('|IMAGE+FLAGS+VARIANCE+ZODI')).toBe(true);
    const d = deserializeCutout(structuredClone(r));
    for (const k of ['image', 'flags', 'variance', 'zodi'] as const) expect(Buffer.from(d[k]!.buffer).equals(Buffer.from(c[k]!.buffer))).toBe(true);
    expect(d.header.wcs).toEqual(c.header.wcs);
    expect(d.targetPix).toEqual(c.targetPix);
  });

  it('evicts least recently used records above the limit', async () => {
    const s = new MemoryCutoutStore(3 * 60000);
    const recs = [9, 10, 11, 12].map((k, i) => serializeCutout(synthLoad(exposure(k), CENTER, 120, ['FLAGS'])!, 1000 + i));
    const size = recs[0].bytes;
    const small = new MemoryCutoutStore(3.5 * size);
    for (const r of recs.slice(0, 3)) await small.put(r);
    await small.touch(recs[0].id); // now the newest
    await small.put(recs[3]);
    const left = [...small.recs.keys()];
    expect(left).toContain(recs[0].id);
    expect(left).toContain(recs[3].id);
    expect(left).not.toContain(recs[1].id);
    expect((await small.stats()).bytes).toBeLessThanOrEqual(3.5 * size);
    expect(s.limitBytes).toBe(180000);
  });

  it('without indexedDB (Node) the store is simply absent and loading still works', async () => {
    expect(await IdbCutoutStore.open()).toBeNull();
    configureCache({ store: undefined, loader });
    const st = await cacheStats();
    expect(st.store.available).toBe(false);
    expect(await getCutout(exposure(13), CENTER, 180, {})).toBeTruthy();
    await clearCache();
  });
});

describe('preloadBundle', () => {
  afterEach(async () => {
    await clearCache({ bundles: true });
  });

  function serve(files: Record<string, Uint8Array | string>) {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      const body = files[url];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 });
    };
    return { f, urls };
  }

  it('loads, registers and answers from a served bundle', async () => {
    loaderCalls = [];
    configureCache({ loader, store: null });
    const cuts = [14, 15, 16].map((k) => synthLoad(exposure(k), CENTER, 240, ['FLAGS'])!);
    const { manifest, binary } = encodeBundle(cuts, { presetId: 'demo', center: CENTER, fovArcsec: 180, windowFovArcsec: 240 });
    const { f, urls } = serve({ '/p/demo.bundle.json': JSON.stringify(manifest), '/p/demo.bundle.bin': gzipSync(binary) });
    expect(await preloadBundle('demo', undefined, { baseUrl: '/p/', fetch: f })).toBe(3);
    expect(urls.sort()).toEqual(['/p/demo.bundle.bin', '/p/demo.bundle.json']);
    // Second call: memoised, no new requests.
    expect(await preloadBundle('demo', undefined, { baseUrl: '/p/', fetch: f })).toBe(3);
    expect(urls.length).toBe(2);
    const got = await getCutout(cuts[1].exposure, CENTER, 180, { planes: ['FLAGS'] });
    expect(cutoutSource(cuts[1].exposure.id)).toBe('bundle');
    expect(got!.flags).toBeTruthy();
    expect(loaderCalls).toEqual([]);
    expect((await cacheStats()).bundles).toEqual([{ presetId: 'demo', cutouts: 3, generated: manifest.generated }]);
  });

  it('missing files, HTML fallbacks and bad ids give 0', async () => {
    const { f } = serve({ '/p/x.bundle.json': '<!doctype html><html></html>', '/p/x.bundle.bin': '<!doctype html>' });
    expect(await preloadBundle('none', undefined, { baseUrl: '/p', fetch: f })).toBe(0);
    expect(await preloadBundle('x', undefined, { baseUrl: '/p', fetch: f })).toBe(0);
    expect(await preloadBundle('../etc', undefined, { baseUrl: '/p', fetch: f })).toBe(0);
  });
});
