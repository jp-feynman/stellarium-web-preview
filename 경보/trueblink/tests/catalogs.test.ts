// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  externalFrame,
  gaiaCone,
  leoParallaxArcsec,
  overlaysFromCatalog,
  parseGaiaTsv,
  parseSimbadTapJson,
  parseSkybotJson,
  propagateCatalog,
  simbadCone,
  skybotCone,
  solarSystemOverlays,
} from '../src/core/catalogs';
import { hipsLocate, ang2xyf, xyf2nest } from '../src/core/catalogs/hips';
import { parseFitsImage } from '../src/core/catalogs/fitsimage';
import { fetchWithTimeout } from '../src/core/catalogs/net';
import { angularSepArcsec, skyToGridPix, tanDeproject } from '../src/core/wcs';
import type { SkyGrid } from '../src/core/types';

const FIX = new URL('./fixtures/catalogs/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');

const AU_KM = 149597870.7;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parsers on saved real responses (2026-11-14)', () => {
  it('Gaia DR3 from VizieR (WISE 0855 field, 120 arcsec)', () => {
    const rows = parseGaiaTsv(fixture('gaia_wise0855_r120.tsv'));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]).toMatchObject({ catalog: 'Gaia DR3', id: '5756955785394371328', epoch: 2016, magBand: 'G' });
    expect(rows[0].ra).toBeCloseTo(133.79701301043, 9);
    expect(rows[0].dec).toBeCloseTo(-7.25786230116, 9);
    expect(rows[0].pmRa).toBeCloseTo(-2.083, 6);
    expect(rows[0].parallax).toBeCloseTo(1.5557, 6);
    // Brightest first.
    for (let k = 1; k < rows.length; k++) expect(rows[k].mag!).toBeGreaterThanOrEqual(rows[k - 1].mag!);
    // The G = 16.3 star that blends with WISE 0855.
    expect(rows.some((r) => r.id === '5756956644387831296')).toBe(true);
  });

  it('SIMBAD TAP JSON (Barnard field)', () => {
    const rows = parseSimbadTapJson(fixture('simbad_barnard_r180.json'));
    const b = rows.find((r) => r.id === "NAME Barnard's star")!;
    expect(b).toBeDefined();
    expect(b.epoch).toBe(2000);
    expect(b.pmDec).toBeCloseTo(10362.394, 3);
    expect(b.pmRa).toBeCloseTo(-801.551, 3);
    expect(b.label).toContain('BY*');
    // nulls stay undefined, never zero
    const noPm = rows.find((r) => r.pmRa === undefined);
    if (noPm) expect(noPm.pmDec).toBeUndefined();
  });

  it('SkyBoT JSON, including the empty answer', () => {
    const objs = parseSkybotJson(fixture('skybot_jd2460823.82017_r540.json'), 60823.32017);
    expect(objs.length).toBe(8);
    const o = objs[0];
    expect(o.name).toBe('2022 SW107');
    expect(o.ra).toBeCloseTo((12 + 19 / 60 + 51.7572 / 3600) * 15, 8);
    expect(o.dec).toBeCloseTo(-(4 + 3 / 60 + 16.909 / 3600), 8);
    expect(o).toMatchObject({ objectClass: 'MB>Outer', vMag: 23.1, dRa: 3.4493, dDec: 4.5471, errArcsec: 0.111, phaseDeg: 15.99, mjd: 60823.32017 });
    expect(o.deltaAu).toBeCloseTo(2.58992967769, 9);
    expect(o.rAu).toBeCloseTo(3.20940571966, 9);
    expect(objs[1].number).toBe(201058);
    expect(parseSkybotJson('', 0)).toEqual([]);
    expect(parseSkybotJson('[]', 0)).toEqual([]);
  });
});

describe('leoParallaxArcsec (constructed geometry)', () => {
  it('observer moved east makes the body appear to move west, 1/Delta scaling', () => {
    // Body on the equator at RA 0: local east is +Y, north is +Z.
    const [dE, dN] = leoParallaxArcsec(0, 0, 1, [0, 7000, 0]);
    const want = (7000 / AU_KM) * 206264.806;
    expect(dE).toBeCloseTo(-want, 6);
    expect(Math.abs(dN)).toBeLessThan(1e-9);
    const [dE2] = leoParallaxArcsec(0, 0, 2, [0, 7000, 0]);
    expect(dE2).toBeCloseTo(-want / 2, 6);
    // Observer moved north: body appears to move south.
    const [, dN3] = leoParallaxArcsec(0, 0, 1, [0, 0, 7000]);
    expect(dN3).toBeCloseTo(-want, 6);
  });

  it('about 9.7 arcsec at 1 au from low Earth orbit; zero along the line of sight', () => {
    const r = 6378 + 700;
    const [dE, dN] = leoParallaxArcsec(90, 30, 1, [0, 0, r]);
    // Spacecraft over the north pole, body at dec 30: shift is r cos(30)/Delta to the south.
    expect(dN).toBeCloseTo(-(r / AU_KM) * 206264.806 * Math.cos(Math.PI / 6), 6);
    expect(Math.abs(dE)).toBeLessThan(1e-9);
    expect(Math.hypot(...leoParallaxArcsec(10, -20, 1, [0, r, 0]))).toBeLessThan(9.8);
    expect(Math.hypot(...leoParallaxArcsec(0, 0, 1, [0, r, 0]))).toBeCloseTo(9.76, 1);
    const along = leoParallaxArcsec(0, 0, 1, [r, 0, 0]);
    expect(Math.hypot(...along)).toBeLessThan(1e-9);
  });
});

describe('propagation and overlays', () => {
  const simbad = parseSimbadTapJson(fixture('simbad_barnard_r180.json'));
  const barnard = simbad.find((r) => r.id === "NAME Barnard's star")!;

  it("moves Barnard's Star by its proper motion", () => {
    const mjd2025 = 51544.5 + 25 * 365.25;
    const [p] = propagateCatalog([barnard], mjd2025);
    const sep = angularSepArcsec(barnard.ra, barnard.dec, p.ra, p.dec);
    expect(sep).toBeCloseTo((Math.hypot(barnard.pmRa!, barnard.pmDec!) * 25) / 1000, 1);
    expect(p.dec).toBeGreaterThan(barnard.dec);
    expect(p.epoch).toBeCloseTo(2025, 6);
    // Source without proper motion keeps its position.
    const still = { catalog: 'X', id: 'a', ra: 10, dec: 20, epoch: 2000 };
    expect(propagateCatalog([still], mjd2025)[0]).toMatchObject({ ra: 10, dec: 20 });
  });

  it('overlaysFromCatalog makes labelled circles and a track for fast movers', () => {
    const ov = overlaysFromCatalog(simbad, 60800);
    const circles = ov.filter((o) => o.kind === 'circle');
    expect(circles.length).toBe(simbad.length);
    expect(circles.every((o) => typeof o.text === 'string' && o.sizeArcsec === 8)).toBe(true);
    const tracks = ov.filter((o) => o.kind === 'track');
    expect(tracks.some((t) => t.id.includes("Barnard's star"))).toBe(true);
    const g = overlaysFromCatalog(parseGaiaTsv(fixture('gaia_wise0855_r120.tsv')), 60800, { labelMagLimit: 17 });
    expect(g.filter((o) => o.text).length).toBeLessThan(g.length);
  });

  it('solarSystemOverlays draws a circle and a one-hour motion arrow', () => {
    const objs = parseSkybotJson(fixture('skybot_jd2460823.82017_r540.json'), 60823.32);
    const ov = solarSystemOverlays(objs);
    const arrow = ov.find((o) => o.kind === 'arrow')!;
    const [a, b] = arrow.path!;
    expect(angularSepArcsec(a[0], a[1], b[0], b[1])).toBeCloseTo(Math.hypot(3.4493, 4.5471), 2);
  });
});

/** Build a minimal FITS file (float32 image) for the mocked services. */
function makeFits(nx: number, ny: number, data: Float32Array, extra: Record<string, string | number> = {}): Uint8Array<ArrayBuffer> {
  const cards: string[] = [];
  const card = (k: string, v: string | number | boolean) => {
    const val = typeof v === 'boolean' ? (v ? 'T' : 'F') : typeof v === 'string' ? `'${v.padEnd(8)}'` : String(v);
    cards.push(`${k.padEnd(8)}= ${val.padStart(20)}`.padEnd(80));
  };
  card('SIMPLE', true);
  card('BITPIX', -32);
  card('NAXIS', 2);
  card('NAXIS1', nx);
  card('NAXIS2', ny);
  for (const [k, v] of Object.entries(extra)) card(k, v);
  cards.push('END'.padEnd(80));
  const hlen = Math.ceil((cards.length * 80) / 2880) * 2880;
  const dlen = Math.ceil((nx * ny * 4) / 2880) * 2880;
  const out = new Uint8Array(hlen + dlen);
  const head = cards.join('').padEnd(hlen, ' ');
  for (let i = 0; i < hlen; i++) out[i] = head.charCodeAt(i);
  const dv = new DataView(out.buffer, hlen);
  for (let i = 0; i < nx * ny; i++) dv.setFloat32(i * 4, data[i], false);
  return out;
}

function argmax(d: Float32Array): number {
  let best = -Infinity;
  let k = -1;
  d.forEach((v, i) => {
    if (v > best) {
      best = v;
      k = i;
    }
  });
  return k;
}

describe('externalFrame', () => {
  it('HiPS tile route puts a real Gaia star on the right SkyGrid pixel (real AllWISE W2 pixels)', async () => {
    const crop = JSON.parse(fixture('hips_allwise_w2_o8_tile654490_crop.json'));
    const tile = new Float32Array(512 * 512).fill(NaN);
    for (let y = 0; y < crop.h; y++)
      for (let x = 0; x < crop.w; x++) {
        const v = crop.values[y * crop.w + x];
        tile[(crop.y0 + y) * 512 + crop.x0 + x] = v === null ? NaN : v;
      }
    const tileBytes = makeFits(512, 512, tile);
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (url.includes(`Norder8/Dir650000/Npix${crop.tile}.fits`) && url.includes('irsa')) return new Response(tileBytes, { status: 200 });
      return new Response('<html>Page unavailable</html>', { status: 404 });
    });
    // Gaia DR3 5756955785394371328 (G = 13.3) at 2010.5 (moves only 0.1 arcsec from 2016).
    const star = { ra: 133.79701301043, dec: -7.25786230116 };
    // Centre the grid 20 arcsec east and 10 arcsec north of the star, so a flip would show.
    const [ra0, dec0] = tanDeproject(star.ra, star.dec, 20, 10);
    const grid: SkyGrid = { ra0, dec0, n: 33, scaleArcsec: 3.075 };
    const f = await externalFrame('allwise-w2', grid);
    const [wi, wj] = skyToGridPix(grid, star.ra, star.dec);
    expect(wi).toBeGreaterThan(20); // star lies west of centre -> larger column index
    expect(wj).toBeLessThan(16); // and south -> smaller row index
    const k = argmax(f.data);
    const i = k % grid.n;
    const j = Math.floor(k / grid.n);
    expect(Math.abs(i - wi)).toBeLessThanOrEqual(1);
    expect(Math.abs(j - wj)).toBeLessThanOrEqual(1);
    expect(f.meta).toMatchObject({ kind: 'external', source: 'AllWISE W2 (2010)' });
    expect(f.meta.mjd).toBeCloseTo(51544.5 + 10.5 * 365.25, 6);
    expect(f.meta.notes!.join(' ')).toMatch(/varies/);
    // Background median removed; pixels outside the saved crop are NaN, not zero.
    const fin = Array.from(f.data).filter(Number.isFinite).sort((a, b) => a - b);
    expect(Math.abs(fin[fin.length >> 1])).toBeLessThan(0.05);
    expect(f.data.some((v) => Number.isNaN(v))).toBe(true);
    expect(urls[0]).toContain('alasky.cds.unistra.fr/hips-image-services/hips2fits');
  });

  it('hips2fits route honours the returned WCS, even when east is to the right', async () => {
    const n = 33;
    const scale = 3.075;
    const grid: SkyGrid = { ra0: 269.452, dec0: 4.6933, n, scaleArcsec: scale };
    // A returned image with CDELT1 > 0 (east to the RIGHT, the opposite of our grid).
    const data = new Float32Array(n * n).fill(1);
    const c = (n - 1) / 2;
    data[(c + 4) * n + (c + 6)] = 1000; // 6 px east, 4 px north of centre
    const bytes = makeFits(n, n, data, {
      CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRVAL1: grid.ra0, CRVAL2: grid.dec0,
      CRPIX1: c + 1, CRPIX2: c + 1, CDELT1: scale / 3600, CDELT2: scale / 3600,
    });
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toContain('hips=CDS%2FP%2F2MASS%2FK');
      expect(url).toContain(`width=${n}`);
      return new Response(bytes, { status: 200 });
    });
    const f = await externalFrame('2mass-k', grid);
    const k = argmax(f.data);
    // East is column 0 in a SkyGrid, so 6 px east of centre is column c - 6.
    expect(k % n).toBe(c - 6);
    expect(Math.floor(k / n)).toBe(c + 4);
    expect(f.meta.source).toBe('2MASS Ks (about 1999)');
  });

  it('fails with a message naming the survey when every route fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 404 }));
    await expect(externalFrame('dss2-red', { ra0: 10, dec0: 10, n: 16, scaleArcsec: 3 })).rejects.toThrow(/DSS2 red.*unavailable.*HTTP 404/);
  });
});

describe('HEALPix helpers', () => {
  it('nested indices at order 0 and 1 match the HEALPix base layout', () => {
    // North pole lies on the corner of faces 0-3; dec +90 maps to one of them.
    expect(ang2xyf(0, 0.0001, 0.1).face).toBe(0);
    expect(ang2xyf(0, Math.PI / 2, 0).face).toBe(4); // equator at RA 0 is face 4
    expect(ang2xyf(0, Math.PI - 0.0001, 0.1).face).toBe(8);
    // Order 1 pixel of RA 0, Dec 0 belongs to face 4.
    const { face, ix, iy } = ang2xyf(1, Math.PI / 2 + 0.01, 0.01);
    expect(Math.floor(xyf2nest(1, face, ix, iy) / 4)).toBe(4);
    const l = hipsLocate(8, 133.79701301043, -7.25786230116);
    expect(l).toEqual({ tile: 654490, x: 84, y: 347 });
  });
});

describe('network behaviour (mocked)', () => {
  it('Gaia query keeps the 500 brightest and falls back to the next mirror', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (url.includes('cfa.harvard')) throw new TypeError('Failed to fetch');
      return new Response(fixture('gaia_wise0855_r120.tsv'), { status: 200 });
    });
    const rows = await gaiaCone({ ra: 133.78, dec: -7.24 }, 120);
    expect(rows.length).toBeGreaterThan(10);
    expect(urls[0]).toContain('-out.max=500');
    expect(urls[0]).toContain('-sort=Gmag');
    expect(urls[1]).toContain('vizier.idia.ac.za');
  });

  it('errors name the service and every host tried', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Page unavailable</html>', { status: 404 }));
    await expect(simbadCone({ ra: 1, dec: 2 }, 60)).rejects.toThrow(/SIMBAD is unavailable \(simbad\.harvard\.edu: HTTP 404; simbad\.cds\.unistra\.fr: HTTP 404\)/);
  });

  it('SkyBoT 204 means nothing in the cone', async () => {
    let seen = '';
    vi.stubGlobal('fetch', async (url: string) => {
      seen = url;
      return new Response(null, { status: 204 });
    });
    expect(await skybotCone({ ra: 183.77, dec: -4.21 }, 180, 60861.43327)).toEqual([]);
    expect(seen).toContain('-ep=2460861.933270');
    expect(seen).toContain('-rd=0.050000');
    expect(seen).toContain('-observer=500');
  });

  it('times out and honours AbortSignal', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    await expect(fetchWithTimeout('https://example.org/x', async (r) => r.text(), { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    const ctl = new AbortController();
    const p = gaiaCone({ ra: 1, dec: 1 }, 10, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('parseFitsImage applies BLANK, BSCALE and BZERO for integer images', () => {
    const cards = ['SIMPLE  =                    T', 'BITPIX  =                   16', 'NAXIS   =                    2', 'NAXIS1  =                    2', 'NAXIS2  =                    1', 'BZERO   =                 10.0', 'BSCALE  =                  2.0', 'BLANK   =             -32768.0', 'END'];
    const head = cards.map((c) => c.padEnd(80)).join('').padEnd(2880, ' ');
    const buf = new Uint8Array(5760);
    for (let i = 0; i < 2880; i++) buf[i] = head.charCodeAt(i);
    const dv = new DataView(buf.buffer, 2880);
    dv.setInt16(0, 5, false);
    dv.setInt16(2, -32768, false);
    const img = parseFitsImage(buf);
    expect(img.data[0]).toBe(20);
    expect(Number.isNaN(img.data[1])).toBe(true);
  });
});
