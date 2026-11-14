// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden_l2.json';
import type { DetectorId, Exposure, FrameHeader, NativeCutout, PhotPoint } from '../src/core/types';
import { FLAG_BITS } from '../src/core/types';
import { pixelAreaArcsec2, pixToSky, skyToPix, wcsFromCards } from '../src/core/wcs';
import {
  abMag,
  aperturePhot,
  buildSpectrum,
  centroid,
  combineRatios,
  flagNames,
  lightCurve,
  matchedRatio,
  pixelCircleOverlap,
  sigmaClippedStats,
} from '../src/core/phot';

const firstFile = Object.values((golden as any).files as Record<string, any>)[0];
const WCS = wcsFromCards({ ...firstFile.wcs_keywords, NAXIS1: 2040, NAXIS2: 2040 });

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussRng(seed: number): () => number {
  const u = rng(seed);
  return () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
}

// erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7): integrates the Gaussian over each pixel.
function erf(x: number): number {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
function pixFrac(i: number, c: number, sigma: number): number {
  const k = sigma * Math.SQRT2;
  return 0.5 * (erf((i + 0.5 - c) / k) - erf((i - 0.5 - c) / k));
}

interface SynthOpts {
  /** Star position, full-frame 0-based pixels. */
  sx?: number;
  sy?: number;
  fluxMjy?: number;
  fwhm?: number;
  zodi?: number;
  bkg?: number;
  noise?: number;
  seed?: number;
  x0?: number;
  y0?: number;
  n?: number;
  /** Write the PSF FWHM into the header (enables the aperture correction). Default true. */
  psfInHeader?: boolean;
}

function makeCutout(o: SynthOpts = {}): { cutout: NativeCutout; star: { ra: number; dec: number }; sx: number; sy: number } {
  const x0 = o.x0 ?? 1000;
  const y0 = o.y0 ?? 1000;
  const n = o.n ?? 33;
  const sx = o.sx ?? 1016.37;
  const sy = o.sy ?? 1015.81;
  const flux = o.fluxMjy ?? 50;
  const sigma = (o.fwhm ?? 1.4) / 2.3548;
  const zodi = o.zodi ?? 0.25;
  const bkg = o.bkg ?? 0.05;
  const noise = o.noise ?? 0;
  const g = gaussRng(o.seed ?? 1);
  const omega = pixelAreaArcsec2(WCS, sx, sy);
  const sTot = (flux * 1000) / (23.5044 * omega); // MJy/sr summed over pixels
  const image = new Float32Array(n * n);
  const zplane = new Float32Array(n * n).fill(zodi);
  const variance = new Float32Array(n * n).fill(noise > 0 ? noise * noise : 1e-6);
  const flags = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const star = sTot * pixFrac(i + x0, sx, sigma) * pixFrac(j + y0, sy, sigma);
      image[j * n + i] = star + zodi + bkg + noise * g();
    }
  }
  const [ra, dec] = pixToSky(WCS, sx, sy);
  const exposure: Exposure = {
    id: 'TEST_0001_1D3',
    obsId: 'TEST_0001_1',
    detector: 3,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: 60900,
    mjdEnd: 60900.0013,
    mjd: 60900.00066,
    url: '',
    s3Key: '',
    sRa: ra,
    sDec: dec,
    sRegion: [],
    emMin: 1.636,
    emMax: 2.421,
    pipelineTag: 'test',
  };
  const header: FrameHeader = {
    wcs: WCS,
    detector: 3 as DetectorId,
    obsId: 'TEST_0001_1',
    mjdAvg: 60900.0007,
    mjdBeg: 60900,
    mjdEnd: 60900.0013,
    exptime: 113.58,
    psfFwhmArcsec: o.psfInHeader === false ? undefined : (o.fwhm ?? 1.4) * Math.sqrt(omega),
    cards: {},
    layout: { url: '', imageDataOffset: 0, flagsHeaderOffset: 0 },
  };
  const [tx, ty] = skyToPix(WCS, ra, dec);
  const cutout: NativeCutout = {
    exposure,
    header,
    x0,
    y0,
    nx: n,
    ny: n,
    image,
    zodi: zplane,
    variance,
    flags,
    targetPix: [tx, ty],
    wavelength: 2.1,
    bandwidth: 0.05,
    channel: 12,
    cubeChannel: 46,
    omegaArcsec2: omega,
  };
  return { cutout, star: { ra, dec }, sx, sy };
}

describe('partial-pixel aperture', () => {
  it('overlaps sum to the circle area', () => {
    for (const r of [1.5, 2, 2.5, 3.3]) {
      for (const [cx, cy] of [
        [0, 0],
        [0.37, -0.21],
        [0.5, 0.5],
      ]) {
        let s = 0;
        for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) s += pixelCircleOverlap(cx, cy, r, i, j);
        expect(Math.abs(s / (Math.PI * r * r) - 1)).toBeLessThan(1e-9);
      }
    }
  });
  it('whole pixels are exact', () => {
    expect(pixelCircleOverlap(0, 0, 2, 0, 0)).toBe(1);
    expect(pixelCircleOverlap(0, 0, 2, 3, 0)).toBe(0);
    const edge = pixelCircleOverlap(0, 0, 2, 2, 0); // pixel spanning 1.5..2.5 in x
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.6);
  });
});

describe('aperturePhot on synthetic native pixels with a real SPHEREx WCS', () => {
  it('recovers a known flux within 2 % (several sub-pixel phases)', () => {
    for (const [sx, sy] of [
      [1016.0, 1016.0],
      [1016.37, 1015.81],
      [1015.5, 1016.5],
      [1016.73, 1016.12],
    ]) {
      const { cutout, star } = makeCutout({ sx, sy, fluxMjy: 50 });
      const p = aperturePhot(cutout, star);
      expect(Math.abs(p.flux / 50 - 1)).toBeLessThan(0.02);
      expect(p.good).toBe(true);
      expect(p.saturated).toBe(false);
      expect(p.method).toBe('aperture');
      expect(p.mjd).toBe(60900.0007);
      expect(p.cubeChannel).toBe(46);
      expect(p.wavelength).toBe(2.1);
      expect(p.exposureId).toBe('TEST_0001_1D3');
      expect(p.detector).toBe(3);
      // 3 % floor dominates for a noiseless star.
      expect(p.fluxErr).toBeGreaterThanOrEqual(0.03 * p.flux * 0.999);
    }
  });
  it('aperture correction: exact for a Gaussian PSF, raw sum within 2 % for FWHM 1.2 px', () => {
    for (const fwhm of [1.2, 1.4, 1.5]) {
      const { cutout, star } = makeCutout({ fwhm, sx: 1016.41, sy: 1015.93 });
      expect(Math.abs(aperturePhot(cutout, star).flux / 50 - 1)).toBeLessThan(0.002);
      const raw = aperturePhot(cutout, star, { apertureCorrection: false }).flux;
      expect(raw).toBeLessThan(50);
      if (fwhm === 1.2) expect(Math.abs(raw / 50 - 1)).toBeLessThan(0.02);
    }
    const { cutout, star } = makeCutout({ fwhm: 1.2, psfInHeader: false });
    expect(Math.abs(aperturePhot(cutout, star).flux / 50 - 1)).toBeLessThan(0.02);
    // A wider aperture needs almost no correction.
    const wide = makeCutout({ fwhm: 1.4 });
    expect(Math.abs(aperturePhot(wide.cutout, wide.star, { radiusPix: 3.5, annulus: [6, 10], apertureCorrection: false }).flux / 50 - 1)).toBeLessThan(0.005);
  });
  it('recovers flux with noise and gives a sensible error', () => {
    const fluxes: number[] = [];
    let lastErr = 0;
    for (let s = 1; s <= 40; s++) {
      const { cutout, star } = makeCutout({ fluxMjy: 2, noise: 0.05, seed: s });
      const p = aperturePhot(cutout, star);
      fluxes.push(p.flux);
      lastErr = p.fluxErr;
      expect(p.snr).toBeGreaterThan(5);
    }
    const mean = fluxes.reduce((a, b) => a + b, 0) / fluxes.length;
    const sd = Math.sqrt(fluxes.reduce((a, b) => a + (b - mean) ** 2, 0) / (fluxes.length - 1));
    expect(Math.abs(mean / 2 - 1)).toBeLessThan(0.02);
    // Quoted error (incl. 3 % floor) is at least the statistical scatter and not wildly bigger.
    expect(lastErr).toBeGreaterThan(0.7 * sd);
    expect(lastErr).toBeLessThan(3 * Math.hypot(sd, 0.06));
  });
  it('works without VARIANCE and ZODI planes', () => {
    const { cutout, star } = makeCutout({ fluxMjy: 20, noise: 0.02, seed: 7 });
    delete cutout.variance;
    delete cutout.zodi;
    const p = aperturePhot(cutout, star);
    expect(Math.abs(p.flux / 20 - 1)).toBeLessThan(0.02);
    expect(Number.isFinite(p.fluxErr)).toBe(true);
    expect(p.good).toBe(true);
  });
  it('empty sky gives ~0 flux', () => {
    const { cutout, star } = makeCutout({ fluxMjy: 0, noise: 0.01, seed: 3 });
    const p = aperturePhot(cutout, star);
    expect(Math.abs(p.flux)).toBeLessThan(4 * p.fluxErr);
  });
  it('NaN core => saturated, not good; flux reported but flagged', () => {
    const { cutout, star, sx, sy } = makeCutout({ fluxMjy: 5000 });
    cutout.image[(Math.round(sy) - cutout.y0) * cutout.nx + Math.round(sx) - cutout.x0] = NaN;
    const p = aperturePhot(cutout, star);
    expect(p.saturated).toBe(true);
    expect(p.good).toBe(false);
  });
  it('OVERFLOW or BLOOM bits => saturated', () => {
    for (const bit of [FLAG_BITS.OVERFLOW, FLAG_BITS.BLOOM]) {
      const { cutout, star, sx, sy } = makeCutout();
      cutout.flags![(Math.round(sy) - cutout.y0) * cutout.nx + Math.round(sx) - cutout.x0 + 1] = 1 << bit;
      const p = aperturePhot(cutout, star);
      expect(p.saturated).toBe(true);
      expect(p.good).toBe(false);
      expect(p.flags & (1 << bit)).not.toBe(0);
    }
  });
  it('a HOT pixel in the aperture makes it not good (but not saturated)', () => {
    const { cutout, star, sx, sy } = makeCutout();
    cutout.flags![(Math.round(sy) - cutout.y0) * cutout.nx + Math.round(sx) - cutout.x0] = 1 << FLAG_BITS.HOT;
    const p = aperturePhot(cutout, star);
    expect(p.saturated).toBe(false);
    expect(p.good).toBe(false);
    expect(flagNames(p.flags)).toEqual(['HOT']);
  });
  it('SOURCE and OUTLIER bits are never bad', () => {
    const { cutout, star } = makeCutout();
    cutout.flags!.fill((1 << FLAG_BITS.SOURCE) | (1 << FLAG_BITS.OUTLIER));
    const p = aperturePhot(cutout, star);
    expect(p.good).toBe(true);
    expect(Math.abs(p.flux / 50 - 1)).toBeLessThan(0.02);
  });
  it('a target near the window edge is not good', () => {
    const { cutout, star } = makeCutout({ sx: 1002.6, sy: 1016.2 });
    const p = aperturePhot(cutout, star);
    expect(p.good).toBe(false);
  });
  it('a neighbour star in the annulus is clipped from the background', () => {
    const { cutout, star, sx, sy } = makeCutout({ fluxMjy: 10 });
    const other = makeCutout({ sx: sx + 6, sy, fluxMjy: 30 }).cutout;
    for (let k = 0; k < cutout.image.length; k++) cutout.image[k] += other.image[k] - 0.3;
    const p = aperturePhot(cutout, star);
    expect(Math.abs(p.flux / 10 - 1)).toBeLessThan(0.03);
  });
});

describe('centroid', () => {
  it('recovers a 0.3 px shift to 0.03 px at high S/N', () => {
    for (const [bx, by] of [
      [1016.0, 1016.0],
      [1016.2, 1015.6],
      [1015.55, 1016.4],
    ]) {
      const { cutout } = makeCutout({ sx: bx + 0.3, sy: by, fluxMjy: 50, noise: 0.01, seed: 11 });
      const [ra0, dec0] = pixToSky(WCS, bx, by);
      const c = centroid(cutout, { ra: ra0, dec: dec0 });
      expect(c).not.toBeNull();
      expect(c!.ok).toBe(true);
      expect(c!.snr).toBeGreaterThan(50);
      const [x, y] = skyToPix(WCS, c!.ra, c!.dec);
      expect(Math.abs(x - (bx + 0.3))).toBeLessThan(0.03);
      expect(Math.abs(y - by)).toBeLessThan(0.03);
    }
  });
  it('is not ok on a saturated star', () => {
    const { cutout, star, sx, sy } = makeCutout({ fluxMjy: 5000 });
    cutout.flags![(Math.round(sy) - cutout.y0) * cutout.nx + Math.round(sx) - cutout.x0] = 1 << FLAG_BITS.OVERFLOW;
    const c = centroid(cutout, star);
    expect(c?.ok ?? false).toBe(false);
  });
  it('is not ok on empty sky', () => {
    const { cutout, star } = makeCutout({ fluxMjy: 0, noise: 0.02, seed: 5 });
    const c = centroid(cutout, star);
    expect(c?.ok ?? false).toBe(false);
  });
});

// Synthetic photometry of a very red source: F ~ lambda^-2, i.e. a factor ~4 across a detector pair.
function synthPoints(gain: Record<number, number>, chans: Record<number, number[]>, seed = 1): PhotPoint[] {
  const g = gaussRng(seed);
  const pts: PhotPoint[] = [];
  for (const [vs, list] of Object.entries(chans)) {
    const visit = Number(vs);
    for (const ch of list) {
      for (let rep = 0; rep < 1 + (ch % 3); rep++) {
        const wavelength = 0.75 + ch * 0.04;
        const truth = gain[visit] * 10 * wavelength ** -2;
        const err = 0.01 * truth;
        pts.push({
          exposureId: `e${visit}_${ch}_${rep}`,
          obsId: `o${visit}_${ch}`,
          detector: 1 + Math.floor((ch - 1) / 17),
          mjd: 60900 + visit * 180 + ch * 0.1 + rep * 0.01,
          wavelength,
          bandwidth: 0.02,
          cubeChannel: ch,
          flux: truth + err * g(),
          fluxErr: err,
          method: 'aperture',
          flags: 0,
          saturated: false,
          good: true,
          snr: 100,
          visit,
        });
      }
    }
  }
  return pts;
}
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('like-with-like spectra, ratios and light curves', () => {
  // Visit 0 samples channels 1-30, visit 1 (25 % brighter) samples 10-40: the overlap is 10-30.
  const pts = synthPoints({ 0: 1, 1: 1.25 }, { 0: range(1, 30), 1: range(10, 40) });

  it('buildSpectrum bins by cube channel, sorted by wavelength, skipping bad and channel 0', () => {
    const extra: PhotPoint[] = [
      { ...pts[0], cubeChannel: 0, exposureId: 'x0' },
      { ...pts[0], good: false, flux: 1e6, exposureId: 'x1' },
    ];
    const s = buildSpectrum(synthPoints({ 0: 1 }, { 0: range(1, 30) }).concat(extra));
    expect(s.length).toBe(30);
    for (let i = 1; i < s.length; i++) expect(s[i].wavelength).toBeGreaterThan(s[i - 1].wavelength);
    for (const row of s) {
      const truth = 10 * row.wavelength ** -2;
      expect(Math.abs(row.flux / truth - 1)).toBeLessThan(5 * (row.fluxErr / truth));
    }
  });

  it('matchedRatio uses only shared channels and cancels the spectrum', () => {
    const rows = matchedRatio(pts, 0, 1);
    expect(rows.map((r) => r.cubeChannel).sort((a, b) => a - b)).toEqual(range(10, 30));
    for (const r of rows) expect(Math.abs(r.ratio - 1.25)).toBeLessThan(4 * r.ratioErr + 1e-9);
    const c = combineRatios(rows);
    expect(Math.abs(c.ratio - 1.25)).toBeLessThan(0.01);
  });

  it('lightCurve cancels the spectrum (a naive per-visit mean does not)', () => {
    const lc = lightCurve(pts);
    expect(lc.length).toBe(2);
    expect(Math.abs(lc[1].rel / lc[0].rel - 1.25)).toBeLessThan(0.01);
    expect(lc[0].nChannels).toBe(21);
    // Naive: mean flux per visit is dominated by which wavelengths were sampled.
    const naive = [0, 1].map((v) => {
      const f = pts.filter((p) => p.visit === v).map((p) => p.flux);
      return f.reduce((a, b) => a + b, 0) / f.length;
    });
    expect(Math.abs(naive[1] / naive[0] - 1.25)).toBeGreaterThan(0.2);
  });

  it('lightCurve of a constant source is flat; channel filter and auto-visits work', () => {
    const flat = synthPoints({ 0: 1, 1: 1, 2: 1 }, { 0: range(1, 20), 1: range(15, 34), 2: range(5, 25) }, 3);
    const lc = lightCurve(flat);
    expect(lc.length).toBe(3);
    for (const p of lc) expect(Math.abs(p.rel - 1)).toBeLessThan(0.01);
    const only = lightCurve(flat, { cubeChannels: [15, 16, 17] });
    for (const p of only) expect(p.nChannels).toBe(3);
    const noVisit = flat.map(({ visit: _v, ...p }) => p as PhotPoint);
    expect(lightCurve(noVisit).length).toBe(3);
  });
});

describe('small helpers', () => {
  it('abMag', () => {
    expect(abMag(3631000)).toBeCloseTo(0, 10);
    expect(abMag(1)).toBeCloseTo(16.4, 2);
    expect(Number.isNaN(abMag(-1))).toBe(true);
  });
  it('sigmaClippedStats ignores outliers', () => {
    const v = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * 0.1 + 5);
    v.push(1000, 2000, NaN);
    const s = sigmaClippedStats(v);
    expect(s.median).toBeCloseTo(5, 6);
    expect(s.n).toBe(200);
  });
});
