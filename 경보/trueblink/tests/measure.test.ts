// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Unit tests for src/app/measure: per-visit aggregation, significance rules, compass directions,
// wing photometry / centroids and the finding texts, on synthetic cutouts.
import { describe, expect, it } from 'vitest';
import { tanDeproject, tanProject, pixToSky } from '../src/core/wcs';
import { FLAG_BITS, type CatalogSource, type Exposure, type NativeCutout, type SkyPos, type TanSipWcs, type TargetInfo, type Visit } from '../src/core/types';
import {
  aggregateVisits,
  bandRatios,
  brightnessVerdict,
  colourExtremes,
  colourSplit,
  compassDirection,
  detectorOfCubeChannel,
  robustRatio,
  motionFromVisits,
  motionSignificant,
  nearNeighbours,
  wellCoveredVisits,
  wingCentroid,
  wingPhot,
  type PosSample,
} from '../src/app/measure/core';
import { buildFindings, renderFinding } from '../src/app/measure/findings';
import { measureSession, type MeasureInput, type MeasureResult } from '../src/app/measure';
import { t } from '../src/app/i18n';

const SCALE = 6.15;
const WCS: TanSipWcs = {
  crval: [180, 10],
  crpix: [1021, 1021],
  cd: [
    [-SCALE / 3600, 0],
    [0, SCALE / 3600],
  ],
  naxis: [2040, 2040],
};
const CENTER: SkyPos = { ra: 180, dec: 10 };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

interface Star {
  pos: SkyPos;
  amp: number;
}

let serial = 0;
function makeCutout(stars: Star[], opts: { mjd: number; cubeChannel: number; detector?: number; saturateAbove?: number; seed?: number; noise?: number }): NativeCutout {
  const nx = 41;
  const ny = 41;
  const x0 = 1000;
  const y0 = 1000;
  const image = new Float32Array(nx * ny);
  const flags = new Int32Array(nx * ny);
  const r = rng(opts.seed ?? ++serial);
  const sigma = 1.4 / 2.3548;
  const pix = stars.map((s) => {
    const [xi, eta] = tanProject(WCS.crval[0], WCS.crval[1], s.pos.ra, s.pos.dec);
    return { x: 1020 - xi / SCALE - x0, y: 1020 + eta / SCALE - y0, amp: s.amp };
  });
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let v = 0.5 + (opts.noise ?? 0.02) * gauss(r);
      // Core plus broad wings (the SPHEREx PSF is far from Gaussian outside the core).
      for (const p of pix) {
        const d2 = (i - p.x) ** 2 + (j - p.y) ** 2;
        v += p.amp * (Math.exp(-d2 / (2 * sigma * sigma)) + 0.06 * Math.exp(-d2 / (2 * 1.8 * 1.8)));
      }
      const k = j * nx + i;
      if (opts.saturateAbove !== undefined && v > opts.saturateAbove) {
        image[k] = NaN;
        flags[k] = 1 << FLAG_BITS.OVERFLOW;
      } else image[k] = v;
      // SOURCE bit everywhere near stars: must never count as bad.
      if (v > 1) flags[k] |= 1 << FLAG_BITS.SOURCE;
    }
  }
  const det = (opts.detector ?? 1) as 1;
  const id = `SYN${serial}_${opts.mjd.toFixed(3)}D${det}`;
  const exposure = { id, obsId: id, detector: det, mjd: opts.mjd, s3Key: id } as unknown as Exposure;
  return {
    exposure,
    header: { wcs: WCS, detector: det, obsId: id, mjdAvg: opts.mjd, mjdBeg: opts.mjd, mjdEnd: opts.mjd, exptime: 113.58, cards: {}, layout: { url: '', imageDataOffset: 0, flagsHeaderOffset: 0 } },
    x0,
    y0,
    nx,
    ny,
    image,
    flags,
    targetPix: [1020, 1020],
    wavelength: 0.8 + opts.cubeChannel * 0.02,
    bandwidth: 0.02,
    channel: opts.cubeChannel,
    cubeChannel: opts.cubeChannel,
    omegaArcsec2: SCALE * SCALE,
  };
}

const offset = (p: SkyPos, east: number, north: number): SkyPos => {
  const [ra, dec] = tanDeproject(p.ra, p.dec, east, north);
  return { ra, dec };
};

describe('compassDirection', () => {
  it('maps vectors to the 8 compass points', () => {
    expect(compassDirection(0, 1)).toBe('N');
    expect(compassDirection(1, 0)).toBe('E');
    expect(compassDirection(-1, 0)).toBe('W');
    expect(compassDirection(0, -1)).toBe('S');
    expect(compassDirection(1, 1)).toBe('NE');
    expect(compassDirection(-1, -1)).toBe('SW');
    // Barnard's Star: (-0.80, +10.36) arcsec/yr is north.
    expect(compassDirection(-801, 10362)).toBe('N');
    // Eps Indi B: (+3.98, -2.47) is south-east.
    expect(compassDirection(3982, -2467)).toBe('SE');
  });
});

describe('significance rules', () => {
  it('motion: total > 3 x max(control median, error)', () => {
    expect(motionSignificant(10000, 600, [{ total: 200 }, { total: 300 }]).significant).toBe(true);
    const v = motionSignificant(1000, 500, [{ total: 400 }]);
    expect(v.threshold).toBeCloseTo(1500);
    expect(v.significant).toBe(false);
    // Controls dominate the floor when they move more than the formal error says.
    expect(motionSignificant(2000, 100, [{ total: 800 }, { total: 700 }, { total: 900 }]).significant).toBe(false);
  });
  it('brightness: |ratio - 1| > 3 x max(error, control change, 2 %)', () => {
    const rw = brightnessVerdict(0.5, 0.03, [0.97, 1.05, 0.9]);
    expect(rw.significant).toBe(true);
    expect(rw.change).toBeCloseTo(-0.5);
    expect(brightnessVerdict(1.05, 0.03, [0.97, 1.05]).significant).toBe(false);
    expect(brightnessVerdict(1.05, 0.005, []).floor).toBeCloseTo(0.02);
  });
});

describe('aggregateVisits', () => {
  it('averages per visit, measures offsets from the first visit and errors from the scatter', () => {
    const r = rng(7);
    const s: PosSample[] = [];
    const p0 = { ra: 10, dec: 20 };
    for (let k = 0; k < 20; k++) {
      const a = offset(p0, 0.3 * gauss(r), 0.3 * gauss(r));
      s.push({ visit: 0, mjd: 60000 + k * 0.5, ...a, err: 0.3 });
      const b = offset(p0, 2 + 0.3 * gauss(r), -1 + 0.3 * gauss(r));
      s.push({ visit: 3, mjd: 60182 + k * 0.5, ...b, err: 0.3 });
    }
    // One wild outlier and a visit with too few points.
    s.push({ visit: 3, mjd: 60185, ...offset(p0, 30, 30), err: 0.3 });
    s.push({ visit: 1, mjd: 60100, ...offset(p0, 1, 1), err: 0.3 }, { visit: 1, mjd: 60101, ...offset(p0, 1, 1), err: 0.3 });
    const v = aggregateVisits(s);
    expect(v.map((x) => x.visit)).toEqual([0, 3]);
    expect(v[0].dRa).toBe(0);
    expect(v[1].dRa).toBeCloseTo(2, 0);
    expect(v[1].dDec).toBeCloseTo(-1, 0);
    expect(v[1].n).toBeGreaterThanOrEqual(19);
    expect(v[1].n).toBeLessThanOrEqual(20);
    expect(v[1].err).toBeGreaterThan(0.04);
    expect(v[1].err).toBeLessThan(0.15);
    const fit = motionFromVisits(v)!;
    expect(fit.twoPoint).toBe(true);
    expect(Number.isFinite(fit.totalErr)).toBe(true);
    // 2.24 arcsec in half a year = 4.5 arcsec/yr.
    expect(fit.total / 1000).toBeCloseTo(Math.hypot(2, 1) / (182 / 365.25), 0);
  });
});

describe('wing measurements on a saturated star', () => {
  it('centroids on the wings and gives relative brightness', () => {
    const truth = offset(CENTER, 1.7, -2.4);
    const c1 = makeCutout([{ pos: truth, amp: 200 }], { mjd: 60000, cubeChannel: 3, saturateAbove: 60 });
    expect(Number.isNaN(c1.image[20 * 41 + 20])).toBe(true);
    const w = wingCentroid(c1, CENTER)!;
    expect(w.ok).toBe(true);
    const [x, y] = [tanProject(truth.ra, truth.dec, w.ra, w.dec)[0], tanProject(truth.ra, truth.dec, w.ra, w.dec)[1]];
    expect(Math.hypot(x, y)).toBeLessThan(1.0); // < 0.16 px
    const c2 = makeCutout([{ pos: truth, amp: 100 }], { mjd: 60200, cubeChannel: 3, saturateAbove: 60 });
    const a = wingPhot(c1, truth);
    const b = wingPhot(c2, truth);
    expect(a.good && b.good).toBe(true);
    expect(b.flux / a.flux).toBeGreaterThan(0.45);
    expect(b.flux / a.flux).toBeLessThan(0.55);
  });
});

describe('wellCoveredVisits and nearNeighbours', () => {
  it('keeps visits with enough good points', () => {
    const mk = (visit: number) => ({ good: true, visit, cubeChannel: 5 }) as never;
    const pts = [...Array(20).fill(0).map(() => mk(0)), ...Array(3).fill(0).map(() => mk(1)), ...Array(12).fill(0).map(() => mk(2))];
    expect(wellCoveredVisits(pts)).toEqual([0, 2]);
  });
  it('finds a Gaia star passing within 8 arcsec but not the target itself', () => {
    const tgt = (mjd: number) => offset(CENTER, (-8 * (mjd - 60000)) / 365.25, 0);
    const gaia: CatalogSource[] = [
      { catalog: 'gaia', id: 'self', ...CENTER, epoch: 2016, mag: 18 },
      { catalog: 'gaia', id: 'near', ...offset(CENTER, -4, 1), epoch: 2016, mag: 16.3 },
      { catalog: 'gaia', id: 'far', ...offset(CENTER, 40, 0), epoch: 2016, mag: 12 },
    ];
    // "self" is exactly on the target at mjd 60000 only; it is skipped as the target's own entry.
    const n = nearNeighbours(gaia, tgt, [60000, 60182, 60365], 8);
    expect(n.map((x) => x.source.id)).toEqual(['near']);
    expect(n[0].sepArcsec).toBeLessThan(1.5);
  });
});

// ---------------------------------------------------------------- end to end

function syntheticSession(opts: { pmEast: number; pmNorth: number; fade: number; saturate?: boolean }): MeasureInput {
  serial = 1000;
  const target: TargetInfo = { id: 'syn', name: 'Synthetic', ra: CENTER.ra, dec: CENTER.dec, epoch: 2025.0, pmRa: opts.pmEast, pmDec: opts.pmNorth };
  const mjd2025 = 51544.5 + 25 * 365.25;
  const visitsMjd = [mjd2025 + 10, mjd2025 + 192];
  const cutouts = new Map<string, NativeCutout>();
  const visits: Visit[] = [];
  const visitOf = new Map<string, number>();
  const fieldStars: Star[] = [
    { pos: offset(CENTER, 70, 20), amp: 8 },
    { pos: offset(CENTER, -60, -50), amp: 6 },
    { pos: offset(CENTER, 10, 75), amp: 5 },
  ];
  visitsMjd.forEach((m0, vi) => {
    const ids: string[] = [];
    for (let k = 0; k < 12; k++) {
      const mjd = m0 + k * 0.7;
      const dt = (mjd - mjd2025) / 365.25;
      const pos = offset(CENTER, (opts.pmEast * dt) / 1000, (opts.pmNorth * dt) / 1000);
      const amp = (opts.saturate ? 300 : 10) * (vi === 1 ? opts.fade : 1);
      const c = makeCutout([{ pos, amp }, ...fieldStars], { mjd, cubeChannel: 1 + (k % 6), saturateAbove: opts.saturate ? 60 : undefined });
      cutouts.set(c.exposure.id, c);
      visitOf.set(c.exposure.id, vi);
      ids.push(c.exposure.id);
    }
    visits.push({ index: vi, mjdMin: m0, mjdMax: m0 + 8, mjdMid: m0 + 4, exposureIds: ids, label: vi === 0 ? '2025-01-11' : '2025-07-12' });
  });
  return { id: 1, target, center: CENTER, cutouts, visits, visitOf, gaia: null };
}

const tEn = (k: string, v?: Record<string, string | number>) => t(k, v, 'en');

describe('measureSession + findings', () => {
  it('measures motion towards the north and a 50 % fade, with comparison stars', () => {
    const input = syntheticSession({ pmEast: 0, pmNorth: 12000, fade: 0.5 });
    const r = measureSession(input, null);
    expect(r.isTarget).toBe(true);
    expect(r.relative).toBe(false);
    expect(r.controls.length).toBeGreaterThanOrEqual(2);
    expect(r.motion?.fit).toBeTruthy();
    expect(r.motion!.fit!.total / 1000).toBeGreaterThan(10);
    expect(r.motion!.fit!.total / 1000).toBeLessThan(14);
    expect(r.ratio!.combined.ratio).toBeGreaterThan(0.45);
    expect(r.ratio!.combined.ratio).toBeLessThan(0.55);
    const specs = buildFindings(r, (v) => input.visits[v].label);
    const texts = specs.map((s) => renderFinding(s, tEn));
    const motion = texts.find((f) => f.id === 'measure:motion')!;
    expect(motion.body).toMatch(/arcsec per year towards the north/);
    expect(motion.body).toMatch(/catalogue says 12\.00/);
    expect(motion.value).toMatch(/arcsec\/yr/);
    const bright = texts.find((f) => f.id === 'measure:brightness')!;
    expect(bright.body).toMatch(/^5\d % fainter between 2025-01-11 and 2025-07-12, measured in 6 shared colour channels/);
    for (const f of texts) expect(`${f.title} ${f.body}`.toLowerCase()).not.toMatch(/discover|planet x/);
  });

  it('says plainly when nothing changed', () => {
    const input = syntheticSession({ pmEast: 0, pmNorth: 0, fade: 1 });
    const r = measureSession(input, null);
    const texts = buildFindings(r, (v) => input.visits[v].label).map((s) => renderFinding(s, tEn));
    const motion = texts.find((f) => f.id === 'measure:motion')!;
    expect(motion.title).toBe('No motion measured');
    expect(motion.body).toMatch(/did not move by more than the noise/);
    expect(texts.find((f) => f.id === 'measure:brightness')!.title).toBe('No brightness change measured');
  });

  it('switches to wing measurements for a saturated target and labels brightness as relative', () => {
    const input = syntheticSession({ pmEast: -6000, pmNorth: 0, fade: 0.5, saturate: true });
    const r = measureSession(input, null);
    expect(r.relative).toBe(true);
    expect(r.motion?.method).toBe('wings');
    expect(r.motion!.fit!.total / 1000).toBeGreaterThan(4.5);
    expect(r.motion!.fit!.total / 1000).toBeLessThan(7.5);
    const texts = buildFindings(r, (v) => input.visits[v].label).map((s) => renderFinding(s, tEn));
    expect(texts.find((f) => f.id === 'measure:motion')!.body).toMatch(/towards the west/);
    expect(texts.find((f) => f.id === 'measure:brightness')!.body).toMatch(/^Relative brightness/);
    expect(texts.some((f) => f.id === 'measure:saturated')).toBe(true);
  });

  it('reports too few frames for a single visit and renders Korean', () => {
    const input = syntheticSession({ pmEast: 0, pmNorth: 0, fade: 1 });
    for (const [id, v] of input.visitOf) if (v === 1) input.cutouts.delete(id);
    const r = measureSession(input, null);
    const specs = buildFindings(r, (v) => input.visits[v].label);
    expect(specs.some((s) => s.id === 'measure:few')).toBe(true);
    const ko = specs.map((s) => renderFinding(s, (k, v) => t(k, v, 'ko')));
    expect(ko.find((f) => f.id === 'measure:few')!.title).toBe('영상이 너무 적음');
  });

  it('measures a picked position as a fixed point', () => {
    const input = syntheticSession({ pmEast: 0, pmNorth: 12000, fade: 1 });
    const star = offset(CENTER, 70, 20);
    const r = measureSession(input, star);
    expect(r.isTarget).toBe(false);
    expect(r.pos).toEqual(star);
    expect(r.points.filter((p) => p.good).length).toBeGreaterThan(15);
    expect(pixToSky(WCS, 1020, 1020)[1]).toBeCloseTo(10, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Colour-dependent change (short 0.75-2.4 um vs long 2.4-5.0 um) and "too noisy to tell"

/** Per-channel ratio rows: `perDet[d-1]` is the ratio of every channel of array d (17 per array). */
function ratioRows(perDet: number[], err = 0.02, jitter = 0.01) {
  const rows: { cubeChannel: number; wavelength: number; ratio: number; ratioErr: number }[] = [];
  perDet.forEach((r, k) => {
    for (let j = 0; j < 17; j++) {
      const cc = k * 17 + j + 1;
      rows.push({ cubeChannel: cc, wavelength: 0.75 + (cc - 1) * 0.042, ratio: r * (1 + jitter * Math.sin(cc * 1.7)), ratioErr: err * r });
    }
  });
  return rows;
}

function fakeResult(perDet: number[], opts: { relative?: boolean; ctrl?: number[]; err?: number; altShort?: number } = {}): MeasureResult {
  const rows = ratioRows(perDet, opts.err ?? 0.02);
  const b = bandRatios(rows);
  const ctrl = opts.ctrl ?? [1.0, 0.99, 1.01];
  const altShort = opts.altShort;
  return {
    sessionId: 1,
    pos: null,
    isTarget: true,
    targetName: 'Test',
    points: Array.from({ length: 20 }, (_, k) => ({
      exposureId: `e${k}`,
      obsId: '',
      detector: 1 + (k % 6),
      mjd: 60000 + (k < 10 ? 0 : 365),
      wavelength: 1,
      bandwidth: 0.01,
      cubeChannel: k + 1,
      flux: 1,
      fluxErr: 0.01,
      method: 'aperture' as const,
      flags: 0,
      saturated: false,
      good: true,
      snr: 100,
      visit: k < 10 ? 0 : 1,
    })),
    binned: [],
    lightCurve: [],
    ratio: {
      visitA: 0,
      visitB: 1,
      labelA: '2025-09-10',
      labelB: '2026-09-09',
      rows,
      combined: robustRatio(rows),
      bands: { short: b.short, long: b.long },
      perDetector: b.perDetector,
      rings:
        opts.relative && altShort !== undefined
          ? { phot: { rin: 3, rout: 5.5 }, alt: { rin: 5, rout: 7.5 }, altBands: { short: { ratio: altShort, ratioErr: 0.01, n: 51 }, long: b.long } }
          : undefined,
    },
    brightness: null,
    motion: null,
    controls: ctrl.map((x, k) => ({
      star: { id: `c${k}`, label: `c${k}`, ra: 0, dec: 0, origin: 'peak' as const },
      points: [],
      epochs: [],
      fit: null,
      ratio: { ratio: x, ratioErr: 0.01, n: 50 },
      bands: { short: { ratio: x, ratioErr: 0.01, n: 25 }, long: { ratio: x, ratioErr: 0.01, n: 25 } },
      lightCurve: [],
    })),
    relative: !!opts.relative,
    saturatedCount: opts.relative ? 20 : 0,
    cold: false,
    neighbours: [],
    nCutouts: 20,
    notes: [],
  };
}

describe('colour-dependent brightness change', () => {
  it('splits the ratio into short and long wavelengths and per detector', () => {
    const b = bandRatios(ratioRows([1.55, 1.2, 1.08, 0.87, 0.48, 0.49]));
    expect(b.short.n).toBeGreaterThan(20);
    expect(b.long.n).toBeGreaterThan(20);
    expect(b.short.ratio).toBeGreaterThan(1.05);
    expect(b.long.ratio).toBeLessThan(0.8);
    expect(b.perDetector.map((d) => d.detector)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(b.perDetector[0].ratio).toBeCloseTo(1.55, 1);
    expect(detectorOfCubeChannel(51)).toBe(3);
    expect(detectorOfCubeChannel(52)).toBe(4);
  });

  it('says in plain words when long wavelengths fade and short ones brighten (RW Aur pattern)', () => {
    const r = fakeResult([1.55, 1.2, 1.08, 0.87, 0.48, 0.49]);
    const f = buildFindings(r, (v) => ['2025-09-10', '2026-09-09'][v]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.title).toBe('The change depends on colour');
    expect(f.body).toMatch(/about half as bright at 3\.8–5 µm but \d+ % brighter at 0\.75–1\.1 µm/);
    expect(f.body).toMatch(/0\.75-2\.4 µm it is \d+(\.\d)? % brighter; over 2\.4-5\.0 µm, \d+ % fainter/);
    expect(f.body).not.toMatch(/44 % fainter/);
    expect(f.value).toMatch(/−\d+ % \(2\.4–5 µm\) · \+\d+(\.\d)? % \(0\.75–2\.4 µm\)/);
    const ko = buildFindings(r, (v) => ['2025-09-10', '2026-09-09'][v]).map((s) => renderFinding(s, (k, v) => t(k, v, 'ko'))).find((x) => x.id === 'measure:brightness')!;
    expect(ko.title).toBe('파장에 따라 변화가 다릅니다');
    expect(ko.body).toMatch(/밝기가 절반 정도로 줄어듦/);
  });

  it('gives the ring range for a saturated target and lowers confidence when the ring matters', () => {
    const r = fakeResult([1.55, 1.2, 1.08, 0.87, 0.48, 0.49], { relative: true, altShort: 1.0 });
    const f = buildFindings(r, (v) => ['2025-09-10', '2026-09-09'][v]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.body).toMatch(/depends on how far from the core it is measured: \+\d+(\.\d)? % with a ring 3–5\.5 px from the centre, \+0\.0 % with a ring 5–7\.5 px out/);
    expect(f.confidence).toBe('low');
  });

  it('is low confidence and says so when no comparison star was measured (R Dra case)', () => {
    const r = fakeResult([0.2, 0.15, 0.15, 0.4, 0.5, 0.5], { ctrl: [] });
    const f = buildFindings(r, (v) => ['2025-05-07', '2026-06-15'][v]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.title).toBe('The change depends on colour');
    expect(f.body).toMatch(/ fainter at [\d.–]+ µm and /);
    expect(f.body).toMatch(/No comparison star could be measured here/);
    expect(f.body).not.toMatch(/changed by – %/);
    expect(f.confidence).toBe('low');
  });

  it('reports one number when the two ranges agree', () => {
    const r = fakeResult([0.7, 0.7, 0.7, 0.7, 0.7, 0.7]);
    const f = buildFindings(r, (v) => ['2025-09-10', '2026-09-09'][v]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.title).toBe('Brightness changed at matched wavelengths');
    expect(f.body).toMatch(/^30 % fainter/);
  });

  it('says "too noisy to tell" instead of a huge "stayed the same within" limit', () => {
    const v = brightnessVerdict(1.3, 2.07, []);
    expect(v.significant).toBe(false);
    expect(v.tooNoisy).toBe(true);
    expect(brightnessVerdict(0.98, 0.03, [1.05]).tooNoisy).toBe(false);
    const r = fakeResult([1.3, 1.3, 1.3, 1.3, 1.3, 1.3], { err: 2.0 });
    const f = buildFindings(r, (x) => ['2025-09-10', '2026-09-09'][x]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.title).toBe('Too noisy to tell');
    expect(f.body).toMatch(/too noisy to tell whether it changed/);
    expect(f.body).not.toMatch(/within/);
  });

  it('keeps "no change" for a constant saturated star whose comparison stars scatter (Barnard pattern)', () => {
    const r = fakeResult([0.95, 1.13, 0.99, 0.99, 0.99, 0.96], { relative: true, ctrl: [1.056], err: 0.04, altShort: 1.0 });
    const f = buildFindings(r, (x) => ['2025-08-25', '2026-08-24'][x]).map((s) => renderFinding(s, tEn)).find((x) => x.id === 'measure:brightness')!;
    expect(f.title).toBe('No brightness change measured');
    expect(f.body).not.toMatch(/fainter|brighter/);
  });

  it('finds the extreme wavelength ranges and merges agreeing neighbours', () => {
    const b = bandRatios(ratioRows([1.55, 1.2, 1.08, 0.87, 0.48, 0.49]));
    const e = colourExtremes(b.perDetector)!;
    expect(e.lo.range).toEqual([3.8, 5.0]);
    expect(e.hi.range[0]).toBe(0.75);
    const s = colourSplit(b.short, b.long, [1], [1])!;
    expect(s.colourDependent).toBe(true);
    expect(colourSplit({ ratio: 1, ratioErr: 0.01, n: 2 }, b.long, [], [])).toBeNull();
  });
});
