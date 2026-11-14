// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden_l2.json';
import { cleanNative, gridToNative, makeGrid, planWindow, reprojectCutout, sigmaClippedMedian } from '../src/core/frames';
import { angularSepArcsec, gridPixToSky, pixToSky, skyToGridPix, skyToPix, tanDeproject, wcsFromCards } from '../src/core/wcs';
import { FLAG_BITS, FLAG_MASKS, type DetectorId, type FrameHeader, type NativeCutout, type SkyPos, type TanSipWcs } from '../src/core/types';

const G = golden as any;
const files = G.files as Record<string, any>;
const POS: SkyPos = { ra: 133.7951, dec: -7.2451 };

function wcsOf(f: any): TanSipWcs {
  return wcsFromCards({ ...f.wcs_keywords, NAXIS1: 2040, NAXIS2: 2040 });
}

/** Same frame rotated by 180 degrees on the sky (what happens between visits six months apart). */
function flipped(w: TanSipWcs): TanSipWcs {
  return { ...w, cd: [[-w.cd[0][0], -w.cd[0][1]], [-w.cd[1][0], -w.cd[1][1]]] };
}

/** A synthetic cutout: flat sky of 0.3 MJy/sr plus a Gaussian star (sigma 5 arcsec, peak 10) at `star`. */
function syntheticCutout(wcs: TanSipWcs, star: SkyPos, fov: number, opts: { flags?: boolean } = {}): NativeCutout {
  const win = planWindow(wcs, POS, fov)!;
  const image = new Float32Array(win.nx * win.ny);
  for (let j = 0; j < win.ny; j++) {
    for (let i = 0; i < win.nx; i++) {
      const [ra, dec] = pixToSky(wcs, win.x0 + i, win.y0 + j);
      const r = angularSepArcsec(ra, dec, star.ra, star.dec);
      image[j * win.nx + i] = 0.3 + 10 * Math.exp((-0.5 * r * r) / 25);
    }
  }
  const header: FrameHeader = {
    wcs,
    detector: 3 as DetectorId,
    obsId: 'TEST',
    mjdAvg: 60800.5,
    mjdBeg: 60800.4993,
    mjdEnd: 60800.5007,
    exptime: 113.58,
    cards: {},
    layout: { url: 'mem://', imageDataOffset: 0, flagsHeaderOffset: 0 },
  };
  const [xt, yt] = skyToPix(wcs, POS.ra, POS.dec);
  return {
    exposure: {
      id: 'TESTD3',
      obsId: 'TEST',
      detector: 3,
      collection: 'spherex_dr1',
      release: 'dr1',
      mjdStart: 0,
      mjdEnd: 0,
      mjd: 0,
      url: '',
      s3Key: '',
      sRa: 0,
      sDec: 0,
      sRegion: [],
      emMin: 0,
      emMax: 0,
      pipelineTag: '',
    },
    header,
    ...win,
    image,
    flags: opts.flags ? new Int32Array(win.nx * win.ny) : undefined,
    targetPix: [xt, yt],
    wavelength: 2.3612,
    bandwidth: 0.05,
    channel: 16,
    cubeChannel: 50,
    omegaArcsec2: 37.8,
  };
}

/** Intensity-weighted centroid in a box of half-width h around (i0, j0), in grid pixels. */
function centroid(data: Float32Array, n: number, i0: number, j0: number, h: number): [number, number] {
  let s = 0;
  let si = 0;
  let sj = 0;
  for (let j = Math.round(j0) - h; j <= Math.round(j0) + h; j++) {
    for (let i = Math.round(i0) - h; i <= Math.round(i0) + h; i++) {
      const v = data[j * n + i];
      if (!Number.isFinite(v)) continue;
      s += v;
      si += v * i;
      sj += v * j;
    }
  }
  return [si / s, sj / s];
}

describe('planWindow', () => {
  const [key, f] = Object.entries(files)[2];
  const wcs = wcsOf(f);
  it(`covers the field plus margin for ${key.split('/').pop()}`, () => {
    const w = planWindow(wcs, POS, 120)!;
    const [xt, yt] = skyToPix(wcs, POS.ra, POS.dec);
    expect(w.x0).toBeLessThan(xt);
    expect(w.y0).toBeLessThan(yt);
    // 120 arcsec field rotated by ~20 deg on 6.15 arcsec pixels: about 25 px plus 2 x 3 px margin.
    expect(w.nx).toBeGreaterThanOrEqual(26);
    expect(w.nx).toBeLessThanOrEqual(34);
    // Every corner of the sky square must land inside the window with at least 2 px to spare.
    for (const [sx, sy] of [
      [-60, -60],
      [60, -60],
      [60, 60],
      [-60, 60],
    ]) {
      const [ra, dec] = tanDeproject(POS.ra, POS.dec, sx, sy);
      const [x, y] = skyToPix(wcs, ra, dec);
      expect(x).toBeGreaterThan(w.x0 + 2);
      expect(y).toBeGreaterThan(w.y0 + 2);
      expect(x).toBeLessThan(w.x0 + w.nx - 1 - 2);
      expect(y).toBeLessThan(w.y0 + w.ny - 1 - 2);
    }
  });
  it('returns null off the detector, near the edge, or on the far side of the sky', () => {
    const at = (x: number, y: number) => {
      const [ra, dec] = pixToSky(wcs, x, y);
      return planWindow(wcs, { ra, dec }, 60);
    };
    expect(at(-10, 500)).toBeNull();
    expect(at(1.0, 500)).toBeNull();
    expect(at(500, 2038.2)).toBeNull();
    expect(at(2, 500)).not.toBeNull();
    const clipped = at(3, 3)!;
    expect(clipped.x0).toBe(0);
    expect(clipped.y0).toBe(0);
    expect(planWindow(wcs, { ra: (POS.ra + 180) % 360, dec: -POS.dec }, 60)).toBeNull();
  });
});

describe('makeGrid', () => {
  it('uses an odd side at the default scale', () => {
    const g = makeGrid(POS, 120);
    expect(g.scaleArcsec).toBe(3.075);
    expect(g.n % 2).toBe(1);
    expect(g.n * g.scaleArcsec).toBeGreaterThanOrEqual(120);
    expect(g.n).toBe(41);
  });
  it('caps n at 257 and grows the scale instead', () => {
    const g = makeGrid(POS, 3600);
    expect(g.n).toBe(257);
    expect(g.scaleArcsec).toBeCloseTo(3600 / 257, 10);
    expect(makeGrid(POS, 1).n).toBe(3);
  });
});

describe('gridToNative lattice interpolation', () => {
  for (const [key, f] of Object.entries(files).slice(0, 3)) {
    it(`stays within 0.02 px of the exact mapping for ${key.split('/').pop()}`, () => {
      const wcs = wcsOf(f);
      const grid = makeGrid(POS, 600);
      const { x, y } = gridToNative(wcs, grid);
      let maxErr = 0;
      for (let j = 0; j < grid.n; j += 3) {
        for (let i = 0; i < grid.n; i += 3) {
          const [ra, dec] = gridPixToSky(grid, i, j);
          const [xe, ye] = skyToPix(wcs, ra, dec);
          maxErr = Math.max(maxErr, Math.abs(xe - x[j * grid.n + i]), Math.abs(ye - y[j * grid.n + i]));
        }
      }
      expect(maxErr).toBeLessThan(0.02);
    });
  }
});

describe('reprojectCutout', () => {
  const f = Object.values(files)[2];
  for (const [name, wcs] of [
    ['May 2025 orientation', wcsOf(f)],
    ['rotated 180 deg', flipped(wcsOf(f))],
  ] as const) {
    it(`puts a star on the right grid pixel, north up and east left (${name})`, () => {
      // Star 24 arcsec east and 15 arcsec north of the field centre.
      const [sra, sdec] = tanDeproject(POS.ra, POS.dec, 24, 15);
      const cut = syntheticCutout(wcs, { ra: sra, dec: sdec }, 120);
      const grid = makeGrid(POS, 120);
      const fr = reprojectCutout(cut, grid, { background: 'median' });
      const [ie, je] = skyToGridPix(grid, sra, sdec);
      const c = (grid.n - 1) / 2;
      // East is to the left (smaller i), north is up (larger j).
      expect(ie).toBeLessThan(c);
      expect(je).toBeGreaterThan(c);
      const [ic, jc] = centroid(fr.data, grid.n, ie, je, 6);
      expect(Math.abs(ic - ie)).toBeLessThan(0.1);
      expect(Math.abs(jc - je)).toBeLessThan(0.1);
      // Sky level removed, field fully covered.
      const finite = Array.from(fr.data).filter(Number.isFinite);
      expect(finite.length).toBe(grid.n * grid.n);
      expect(Math.abs(sigmaClippedMedian(fr.data).median)).toBeLessThan(1e-3);
      expect(fr.meta.kind).toBe('exposure');
      expect(fr.meta.label).toBe('2025-05-05 · D3 · 2.36 um');
      expect(fr.meta.waveMin).toBeCloseTo(2.3362, 6);
      expect(fr.meta.waveMax).toBeCloseTo(2.3862, 6);
      expect(fr.meta.mjd).toBe(60800.5);
      expect(fr.meta.detectors).toEqual([3]);
      expect(fr.meta.exposureIds).toEqual(['TESTD3']);
      expect(fr.meta.cubeChannels).toEqual([50]);
      expect(fr.weight!.every((w) => w > 0.999)).toBe(true);
    });
  }

  it('masks bad pixels to NaN but never SOURCE or OUTLIER pixels', () => {
    const wcs = wcsOf(f);
    const cut = syntheticCutout(wcs, POS, 120, { flags: true });
    const [xt, yt] = cut.targetPix;
    const k = (Math.round(yt) - cut.y0) * cut.nx + (Math.round(xt) - cut.x0);
    // A 2x2 block of hot pixels around one native pixel, and SOURCE+OUTLIER on its neighbour.
    for (const d of [0, 1, cut.nx, cut.nx + 1]) cut.flags![k + d] = 1 << FLAG_BITS.HOT;
    cut.flags![k - 1] = (1 << FLAG_BITS.SOURCE) | (1 << FLAG_BITS.OUTLIER);
    const clean = cleanNative(cut, { background: 'none' });
    expect(Number.isNaN(clean.data[k])).toBe(true);
    expect(clean.data[k - 1]).toBe(cut.image[k - 1]);
    // Even an explicit mask containing SOURCE leaves those pixels alone.
    const all = cleanNative(cut, { background: 'none', badMask: 0xffffffff | 0 });
    expect(all.data[k - 1]).toBe(cut.image[k - 1]);
    expect(FLAG_MASKS.mosaic & (1 << FLAG_BITS.HOT)).not.toBe(0);
    const grid = makeGrid(POS, 120);
    const fr = reprojectCutout(cut, grid, { background: 'none' });
    // A grid point sitting right on the masked native pixel has < 50 % valid weight -> NaN.
    const gx = gridToNative(wcs, grid);
    let sawNaN = false;
    for (let q = 0; q < grid.n * grid.n; q++) {
      const dx = gx.x[q] - Math.round(xt) - 0.5;
      const dy = gx.y[q] - Math.round(yt) - 0.5;
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
        expect(Number.isNaN(fr.data[q])).toBe(true);
        sawNaN = true;
      }
    }
    expect(sawNaN).toBe(true);
    // NaN never becomes zero.
    expect(Array.from(fr.data).some((v) => v === 0)).toBe(false);
  });

  it('zodi+median subtracts the model and then the residual median; falls back to median without zodi', () => {
    const wcs = wcsOf(f);
    const cut = syntheticCutout(wcs, POS, 120);
    const noZodi = cleanNative(cut);
    expect(noZodi.notes.join(' ')).toMatch(/median subtracted/);
    expect(noZodi.level).toBeCloseTo(0.3, 2);
    cut.zodi = new Float32Array(cut.image.length).fill(0.25);
    const withZodi = cleanNative(cut, { background: 'zodi+median' });
    expect(withZodi.level).toBeCloseTo(0.05, 2);
    expect(withZodi.notes).toEqual([]);
  });
});
