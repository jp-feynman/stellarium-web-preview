// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import {
  detectorForCubeChannel,
  detectorForWavelength,
  evidenceSteps,
  extent,
  FLAG_INFO,
  flagNames,
  interpAt,
  logTicks,
  median,
  mjdToUtc,
  motionVerdict,
  niceTicks,
  normaliseAt,
  s3HttpsUrl,
  scaleLinear,
  scaleLog,
  sortRows,
  timeSegments,
  timeTicks,
  toCsv,
  weightedMean,
  windowRange,
} from '../src/app/research/helpers';
import { exposuresToCsv } from '../src/app/research/ExposureTable';
import type { ExposureRow } from '../src/app/research/ExposureTable';
import { en, ko } from '../src/app/research/strings';
import { FLAG_BITS, FLAG_MASKS } from '../src/core/types';

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and ends lines with CRLF', () => {
    const csv = toCsv([
      { a: 'plain', b: 1.5 },
      { a: 'with, comma', b: -2 },
      { a: 'say "hi"', b: 0 },
      { a: 'two\nlines', b: 3 },
    ]);
    expect(csv).toBe('a,b\r\nplain,1.5\r\n"with, comma",-2\r\n"say ""hi""",0\r\n"two\nlines",3\r\n');
  });
  it('writes NaN and missing values as empty cells, never zero', () => {
    const csv = toCsv([{ x: NaN, y: undefined as number | undefined, z: Infinity, w: true }], ['x', 'y', 'z', 'w']);
    expect(csv.split('\r\n')[1]).toBe(',,,true');
  });
  it('respects the column order and handles no rows', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('b,a\r\n2,1\r\n');
    expect(toCsv([] as { a: number }[], ['a'])).toBe('a\r\n');
  });
  it('exports exposure rows with UTC time and an S3 https link', () => {
    const row: ExposureRow = {
      id: '2025W19_1B_0116_1D3',
      obsId: '2025W19_1B_0116_1',
      detector: 3,
      mjd: 60800.5,
      wavelength: 1.9,
      bandwidth: 0.046,
      cubeChannel: 42,
      release: 'dr1',
      collection: 'spherex_dr1',
      s3Key: 'dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits',
      status: 'loaded',
    };
    const lines = exposuresToCsv([row]).trim().split('\r\n');
    expect(lines[0]).toBe('id,obsId,detector,mjd,utc,wavelength,bandwidth,cubeChannel,release,collection,flagsSummary,status,url');
    expect(lines[1]).toContain('2025-05-05 12:00:00');
    expect(lines[1].endsWith('https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits')).toBe(true);
  });
});

describe('scales and ticks', () => {
  it('maps linearly and logarithmically', () => {
    const s = scaleLinear(0, 10, 100, 200);
    expect(s(5)).toBe(150);
    const l = scaleLog(1, 100, 0, 200);
    expect(l(10)).toBeCloseTo(100, 9);
    expect(Number.isNaN(l(-1))).toBe(true);
  });
  it('makes round ticks', () => {
    expect(niceTicks(0.7, 5.1, 9)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(logTicks(0.3, 40)).toEqual([0.5, 1, 2, 5, 10, 20]);
    expect(logTicks(0.01, 1000)).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
  });
  it('pads extents and survives empty input', () => {
    expect(extent([])).toEqual([0, 1]);
    const [lo, hi] = extent([1, 2, NaN]);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(2);
  });
  it('labels time ticks with calendar-aligned UTC dates', () => {
    const t = timeTicks(60800.3, 60814.2, 4);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.length).toBeLessThanOrEqual(4);
    for (const k of t) expect(Number.isInteger(k.mjd)).toBe(true);
    const long = timeTicks(60800, 61200, 6);
    for (const k of long) expect(k.label.endsWith('-01')).toBe(true);
    expect(mjdToUtc(60800.5, true)).toBe('2025-05-05 12:00:00');
    expect(mjdToUtc(NaN)).toBe('–');
  });
});

describe('sorting and windowing', () => {
  const rows = [
    { k: 'b10', v: 3 },
    { k: 'b2', v: NaN },
    { k: 'a', v: 1 },
    { k: 'c', v: 2 },
  ];
  it('sorts numbers with NaN last in both directions', () => {
    expect(sortRows(rows, 'v', 'asc').map((r) => r.k)).toEqual(['a', 'c', 'b10', 'b2']);
    expect(sortRows(rows, 'v', 'desc').map((r) => r.k)).toEqual(['b10', 'c', 'a', 'b2']);
  });
  it('sorts strings naturally', () => {
    expect(sortRows(rows, 'k', 'asc').map((r) => r.k)).toEqual(['a', 'b2', 'b10', 'c']);
  });
  it('windows 3000 rows to a small slice', () => {
    const w = windowRange(30000, 360, 30, 3000, 8);
    expect(w.start).toBe(992);
    expect(w.end).toBe(1000 + 13 + 8);
    expect(w.end - w.start).toBeLessThan(40);
    expect(windowRange(0, 360, 30, 5)).toEqual({ start: 0, end: 5 });
    expect(windowRange(0, 360, 30, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('statistics and verdicts', () => {
  it('computes an inverse-variance weighted mean', () => {
    const s = weightedMean([1, 3], [1, 1]);
    expect(s.mean).toBe(2);
    expect(s.err).toBeCloseTo(1 / Math.sqrt(2), 12);
    expect(s.chi2r).toBe(2);
    const w = weightedMean([1, 2, NaN], [0.1, 1, 1]);
    expect(w.n).toBe(2);
    expect(w.mean).toBeCloseTo((100 + 2) / 101, 12);
    expect(weightedMean([], []).n).toBe(0);
  });
  it('median ignores NaN', () => {
    expect(median([3, NaN, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('calls a motion significant only above 3 x max(control median, error)', () => {
    const controls = [{ total: 20 }, { total: 30 }, { total: 25 }];
    expect(motionVerdict(10000, 50, controls)).toMatchObject({ significant: true, threshold: 150, controlMedian: 25 });
    expect(motionVerdict(70, 5, controls)).toMatchObject({ significant: false, threshold: 75 });
    expect(motionVerdict(80, 5, controls).significant).toBe(true);
    expect(motionVerdict(10, 4, []).threshold).toBe(12);
    expect(motionVerdict(10, 4, []).significant).toBe(false);
  });
  it('normalises spectra at 1.2 um by interpolation', () => {
    expect(interpAt([1, 2], [10, 20], 1.2)).toBeCloseTo(12, 12);
    const n = normaliseAt([1.0, 1.4, 2.0], [0.9, 1.1, 1.3], 1.2);
    expect(n[0]).toBeCloseTo(0.9, 12);
    expect(n[1]).toBeCloseTo(1.1, 12);
    expect(normaliseAt([2, 3], [1, 1], 1.2).every(Number.isNaN)).toBe(true);
  });
  it('splits time into visit panels at gaps', () => {
    const segs = timeSegments([60800, 60801, 60809, 60990, 61000]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ mjdMin: 60800, mjdMax: 60809 });
    const viaVisits = timeSegments([], [{ index: 1, mjdMin: 61000, mjdMax: 61010, label: 'b' }, { index: 0, mjdMin: 60800, mjdMax: 60810, label: 'a' }]);
    expect(viaVisits.map((s) => s.visit)).toEqual([0, 1]);
  });
});

describe('flags, detectors and strings', () => {
  it('lists all 23 flags with groups, SOURCE and OUTLIER as information only', () => {
    expect(FLAG_INFO).toHaveLength(23);
    expect(FLAG_INFO.map((f) => f.name).sort()).toEqual(Object.keys(FLAG_BITS).sort());
    expect(FLAG_INFO.find((f) => f.name === 'SOURCE')!.group).toBe('info');
    expect(FLAG_INFO.find((f) => f.name === 'OUTLIER')!.group).toBe('info');
    expect(FLAG_INFO.find((f) => f.name === 'SOURCE')!.inPhotometryMask).toBe(false);
    const phot = FLAG_INFO.filter((f) => f.inPhotometryMask).reduce((m, f) => m | (1 << f.bit), 0);
    expect(phot).toBe(FLAG_MASKS.photometry);
    expect(flagNames((1 << 1) | (1 << 21))).toEqual(['OVERFLOW', 'SOURCE']);
  });
  it('maps wavelengths and cube channels to detectors', () => {
    expect(detectorForWavelength(0.8)).toBe(1);
    expect(detectorForWavelength(4.6)).toBe(6);
    expect(detectorForWavelength(6)).toBe(0);
    expect(detectorForCubeChannel(17)).toBe(1);
    expect(detectorForCubeChannel(18)).toBe(2);
    expect(detectorForCubeChannel(102)).toBe(6);
  });
  it('builds the evidence ladder', () => {
    expect(evidenceSteps('classified').map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo']);
  });
  it('has a meaning for every flag and a Korean entry for every English key', () => {
    for (const f of FLAG_INFO) expect((en as Record<string, string>)[`flag.${f.name}`]).toBeTruthy();
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });
  it('builds encoded S3 links', () => {
    expect(s3HttpsUrl('/qr3/a b.fits')).toBe('https://nasa-irsa-spherex.s3.amazonaws.com/qr3/a%20b.fits');
  });
});
