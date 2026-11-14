// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import type { BandGroup, NativeCutout, SkyFrame, SkyGrid, Visit } from '../src/core/types';
import { CHANNELS } from '../src/core/wave';
import {
  buildEpochSequence,
  buildMatchedPairs,
  buildSweepSequence,
  differenceFrame,
  displayRange,
  nearestChannelWithAllVisits,
  nearestChannelWithMostVisits,
  NOTE_MIXED,
  NOTE_SWEEP,
  robustStats,
  selectBalanced,
  stackFrames,
  summarizeCoverage,
} from '../src/core/stack';

const N = 16;
const GRID: SkyGrid = { ra0: 133.76, dec0: -7.24, n: N, scaleArcsec: 3.075 };
const COLD: BandGroup = { id: 'cold', label: 'Cold', detectors: [5, 6] };
const SRC = 8 * N + 8;

let counter = 0;

/** A single-exposure frame in cube channel c: flat background plus an optional point source. */
function frame(
  c: number,
  mjd: number,
  opts: { bg?: number; src?: number; at?: number; visit?: number; fill?: (p: number) => number } = {},
): SkyFrame {
  const ch = CHANNELS[c - 1];
  const data = new Float32Array(N * N).fill(opts.bg ?? 0);
  if (opts.fill) for (let p = 0; p < N * N; p++) data[p] = opts.fill(p);
  if (opts.src !== undefined) data[opts.at ?? SRC] += opts.src;
  const id = `X${counter++}D${ch.detector}`;
  return {
    grid: GRID,
    data,
    meta: {
      kind: 'exposure',
      label: id,
      mjd,
      mjdMin: mjd - 0.001,
      mjdMax: mjd + 0.001,
      wavelength: ch.wavelength,
      waveMin: ch.waveMin,
      waveMax: ch.waveMax,
      detectors: [ch.detector],
      nExposures: 1,
      exposureIds: [id],
      cubeChannels: [c],
      ...(opts.visit !== undefined ? { visit: opts.visit } : {}),
    },
  };
}

function visit(index: number, mjdMin: number, mjdMax: number, label: string): Visit {
  return { index, mjdMin, mjdMax, mjdMid: (mjdMin + mjdMax) / 2, exposureIds: [], label };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Deterministic pseudo-random normal numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (1664525 * s + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

describe('robustStats', () => {
  it('median, MAD and sigma ignore NaN', () => {
    const s = robustStats(new Float32Array([1, 2, 3, 4, 100, NaN]));
    expect(s.median).toBe(3);
    expect(s.mad).toBe(1);
    expect(s.sigma).toBeCloseTo(1.4826, 6);
  });
  it('all-NaN input gives NaN', () => {
    const s = robustStats(new Float32Array([NaN, NaN]));
    expect(Number.isNaN(s.median) && Number.isNaN(s.mad) && Number.isNaN(s.sigma)).toBe(true);
  });
});

describe('stackFrames', () => {
  it('sigclip rejects a cosmic-ray hit that the mean keeps', () => {
    const fs = range(0, 6).map((i) => frame(80, 60000 + i * 0.1, { bg: 10 + 0.01 * i }));
    fs[3].data[SRC] = 1000;
    const clip = stackFrames(fs, { method: 'sigclip' });
    const mean = stackFrames(fs, { method: 'mean' });
    const med = stackFrames(fs, { method: 'median' });
    expect(clip.data[SRC]).toBeCloseTo(10.03, 4);
    expect(clip.weight![SRC]).toBeCloseTo(6 / 7, 6);
    expect(clip.weight![0]).toBe(1);
    expect(mean.data[SRC]).toBeGreaterThan(100);
    expect(med.data[SRC]).toBeCloseTo(10.04, 4);
  });

  it('sigclip with fewer than 5 samples is the plain mean', () => {
    const fs = [frame(80, 1, { bg: 1 }), frame(80, 2, { bg: 1 }), frame(80, 3, { bg: 1 }), frame(80, 4, { bg: 101 })];
    expect(stackFrames(fs).data[0]).toBeCloseTo(26, 6);
  });

  it('NaN samples are skipped and all-NaN pixels stay NaN with weight 0', () => {
    const a = frame(80, 60000, { bg: 2 });
    const b = frame(81, 60001, { bg: 4 });
    a.data[5] = NaN;
    a.data[6] = NaN;
    b.data[6] = NaN;
    const s = stackFrames([a, b], { method: 'mean' });
    expect(s.data[0]).toBe(3);
    expect(s.data[5]).toBe(4);
    expect(s.weight![5]).toBe(0.5);
    expect(Number.isNaN(s.data[6])).toBe(true);
    expect(s.weight![6]).toBe(0);
    expect(s.data.some((v) => v === 0)).toBe(false);
  });

  it('merges metadata', () => {
    const s = stackFrames([frame(80, 60000), frame(90, 60002)], { label: 'my stack' });
    expect(s.meta.kind).toBe('stack');
    expect(s.meta.label).toBe('my stack');
    expect(s.meta.mjd).toBeCloseTo(60001, 9);
    expect(s.meta.mjdMin).toBeCloseTo(59999.999, 6);
    expect(s.meta.mjdMax).toBeCloseTo(60002.001, 6);
    expect(s.meta.wavelength).toBeCloseTo((CHANNELS[79].wavelength + CHANNELS[89].wavelength) / 2, 9);
    expect(s.meta.waveMin).toBeCloseTo(CHANNELS[79].waveMin, 9);
    expect(s.meta.waveMax).toBeCloseTo(CHANNELS[89].waveMax, 9);
    expect(s.meta.detectors).toEqual([5, 6]);
    expect(s.meta.cubeChannels).toEqual([80, 90]);
    expect(s.meta.nExposures).toBe(2);
    expect(s.meta.exposureIds).toHaveLength(2);
  });

  it('refuses frames on different grids', () => {
    const a = frame(80, 1);
    const b = { ...frame(80, 2), grid: { ...GRID, ra0: 10 } };
    expect(() => stackFrames([a, b])).toThrow(/SkyGrid/);
    expect(() => stackFrames([])).toThrow(/no frames/);
  });
});

describe('buildEpochSequence', () => {
  // A source whose brightness depends on wavelength (flux = channel number) but never on time.
  const flux = (c: number) => c;
  const V: Visit[] = [visit(0, 60600, 60614, '2024-12-01'), visit(1, 60780, 60794, '2025-05-30'), visit(2, 60960, 60974, '2025-11-26')];
  function make(): SkyFrame[] {
    const fs: SkyFrame[] = [];
    // Visit 0: channels 69-86, plus the short (faint) channels 69-72 three more times.
    for (const c of [...range(69, 86), ...range(69, 72), ...range(69, 72), ...range(69, 72)]) {
      fs.push(frame(c, 60600 + (c - 69) * 0.5, { bg: 0, src: flux(c) }));
    }
    // Visit 1: channels 75-95, plus the long (bright) channels 90-95 twice more.
    for (const c of [...range(75, 95), ...range(90, 95), ...range(90, 95)]) {
      fs.push(frame(c, 60781 + (c - 75) * 0.5, { bg: 0, src: flux(c) }));
    }
    // Visit 2: only three exposures, so it is dropped.
    for (const c of [80, 81, 82]) fs.push(frame(c, 60962, { bg: 0, src: flux(c) }));
    // An exposure from another array is ignored by the "cold" group.
    fs.push(frame(10, 60601, { src: 999 }));
    return fs;
  }

  it('balanced frames have the same effective bandpass and equal fluxes', () => {
    const seq = buildEpochSequence(make(), V, COLD);
    expect(seq).toHaveLength(2);
    // Common channels 75..86: equal-weight mean of 75..86 = 80.5 at both dates.
    expect(seq[0].data[SRC]).toBeCloseTo(80.5, 4);
    expect(seq[1].data[SRC]).toBeCloseTo(80.5, 4);
    expect(seq[0].meta.wavelength).toBeCloseTo(seq[1].meta.wavelength, 9);
    expect(seq[0].meta.cubeChannels).toEqual(range(75, 86));
    expect(seq[1].meta.cubeChannels).toEqual(range(75, 86));
    expect(seq.map((f) => f.meta.visit)).toEqual([0, 1]);
    expect(seq[0].data[0]).toBe(0);
    expect(seq[0].weight![SRC]).toBe(1);
  });

  it('unbalanced frames differ because the wavelength mix differs', () => {
    const seq = buildEpochSequence(make(), V, COLD, { balanced: false });
    expect(seq).toHaveLength(2);
    expect(Math.abs(seq[0].data[SRC] - seq[1].data[SRC])).toBeGreaterThan(5);
    for (const f of seq) expect(f.meta.notes).toContain(NOTE_MIXED);
  });

  it('labels and notes', () => {
    const seq = buildEpochSequence(make(), V, COLD);
    const f = seq[0];
    expect(f.meta.label).toMatch(/^2024-12-01 · arrays 5\+6 · \d\.\d-\d\.\d um · 12 exp$/);
    expect(seq[1].meta.label).toMatch(/^2025-05-30 · arrays 5\+6 · .* · 12 exp$/);
    const notes = f.meta.notes!.join(' | ');
    expect(notes).toMatch(/like-with-like: 12 common channels, \d\.\d\d-\d\.\d\d um/);
    expect(notes).toMatch(/dropped 2025-11-26 \(3 exp\)/);
    expect(notes).toMatch(/used 12 of 30 exposures/);
    expect(notes).not.toContain(NOTE_MIXED);
  });

  it('falls back with a warning when fewer than 3 channels are common', () => {
    const fs = [
      ...range(70, 75).map((c) => frame(c, 60601, { src: c })),
      ...range(90, 95).map((c) => frame(c, 60782, { src: c })),
    ];
    const seq = buildEpochSequence(fs, V, COLD);
    expect(seq).toHaveLength(2);
    for (const f of seq) expect(f.meta.notes).toContain(NOTE_MIXED);
    expect(seq[0].data[SRC]).toBeCloseTo(72.5, 4);
  });

  it('assigns visits by time when meta.visit is unset, and honours an explicit visit', () => {
    const fs = range(75, 80).map((c) => frame(c, 60790, { src: 1 }));
    fs.push(frame(81, 50000, { src: 1, visit: 1 }));
    const seq = buildEpochSequence(fs, V, COLD, { minExposures: 1 });
    expect(seq).toHaveLength(1);
    expect(seq[0].meta.visit).toBe(1);
    expect(seq[0].meta.nExposures).toBe(7);
  });

  it('respects the group wavelength window', () => {
    const seq = buildEpochSequence(make(), V, { ...COLD, waveMax: 4.42 }, { balanced: false });
    for (const f of seq) expect(f.meta.detectors).toEqual([5]);
  });
});

describe('sweep, matched pairs and coverage', () => {
  const V: Visit[] = [visit(0, 60600, 60614, '2024-12-01'), visit(1, 60780, 60794, '2025-05-30')];
  const fs = [
    frame(90, 60601, { src: 5 }),
    frame(72, 60602, { src: 1 }),
    frame(80, 60603, { src: 3 }),
    frame(80, 60604, { src: 3 }),
    frame(80, 60785, { src: 4 }),
    frame(85, 60786, { src: 2 }),
  ];

  it('sweep is ordered by wavelength and says it is not time', () => {
    const sw = buildSweepSequence(fs, V[0]);
    expect(sw.map((f) => f.meta.cubeChannels![0])).toEqual([72, 80, 80, 90]);
    for (const f of sw) {
      expect(f.meta.label).toContain(NOTE_SWEEP);
      expect(f.meta.label).toMatch(/^\d\.\d{3} um · array \d/);
      expect(f.meta.notes).toContain(NOTE_SWEEP);
    }
  });

  it('matched pairs give one frame per visit in one channel', () => {
    const mp = buildMatchedPairs(fs, V, 80);
    expect(mp).toHaveLength(2);
    expect(mp[0].data[SRC]).toBe(3);
    expect(mp[1].data[SRC]).toBe(4);
    expect(mp[0].meta.label).toMatch(/^2024-12-01 · channel 80 · \d\.\d{3} um · 2 exp$/);
    expect(mp[1].meta.nExposures).toBe(1);
    expect(nearestChannelWithAllVisits(fs, V, 5.0)).toBe(80);
    expect(nearestChannelWithAllVisits(fs.slice(0, 2), V, 4.0)).toBe(72);
    expect(nearestChannelWithAllVisits([fs[0], fs[5]], V, 4.0)).toBeNull();
    // No channel in every visit: fall back to the one seen in the most visits (or null if none is seen twice).
    expect(nearestChannelWithMostVisits(fs, V, 5.0)).toBe(nearestChannelWithAllVisits(fs, V, 5.0));
    expect(nearestChannelWithMostVisits([fs[0], fs[5]], V, 4.0)).toBeNull();
  });

  it('coverage summary lists channels and counts per visit', () => {
    const cov = summarizeCoverage(fs, V);
    expect(cov).toHaveLength(2);
    expect(cov[0]).toMatchObject({ visit: 0, label: '2024-12-01', nFrames: 4, channels: [72, 80, 90], counts: [1, 2, 1] });
    expect(cov[1]).toMatchObject({ visit: 1, nFrames: 2, channels: [80, 85], counts: [1, 1] });
  });
});

describe('differenceFrame', () => {
  it('a moving source leaves a positive/negative dipole', () => {
    const at1 = 8 * N + 5;
    const at2 = 8 * N + 9;
    const a = frame(80, 60600, { bg: 1, src: 50, at: at1 });
    const b = frame(80, 60780, { bg: 1, src: 50, at: at2 });
    b.data[0] = NaN;
    const d = differenceFrame(a, b);
    expect(d.data[at1]).toBe(50);
    expect(d.data[at2]).toBe(-50);
    expect(d.data[1]).toBe(0);
    expect(Number.isNaN(d.data[0])).toBe(true);
    expect(d.meta.kind).toBe('difference');
    expect(d.meta.label).toBe('A minus B');
    expect(d.meta.notes).toEqual([`A: ${a.meta.label}`, `B: ${b.meta.label}`]);
  });

  it('warns when A and B were built from different channels', () => {
    const d = differenceFrame(frame(80, 1), frame(81, 2), 'custom');
    expect(d.meta.label).toBe('custom');
    expect(d.meta.notes!.some((n) => /different spectral channels/.test(n))).toBe(true);
  });
});

describe('displayRange', () => {
  function sky(seed: number, level = 0, sigma = 1): SkyFrame {
    const g = rng(seed);
    const f = frame(80, 60600 + seed, { fill: () => level + sigma * g() });
    f.data[3 * N + 3] = 200; // a star
    return f;
  }

  it('is pooled over all frames, order independent and robust to one cosmic ray', () => {
    const fs = range(1, 8).map((s) => sky(s));
    const r = displayRange(fs);
    expect(r.lo).toBeGreaterThan(-1.5);
    expect(r.lo).toBeLessThan(-0.5);
    expect(r.hi).toBeGreaterThan(2);
    expect(r.hi).toBeLessThan(r.lo + 300);
    expect(displayRange([...fs].reverse())).toEqual(r);
    const hit = sky(99);
    hit.data[10] = 1e6;
    const r2 = displayRange([...fs, hit]);
    expect(Math.abs(r2.lo - r.lo)).toBeLessThan(0.2);
    expect(r2.hi).toBeLessThan(1000);
  });

  it('uses one range for a faint and a bright frame (never per frame)', () => {
    const faint = frame(80, 1, { fill: (p) => (p % 7) * 0.01 });
    const bright = frame(80, 2, { fill: (p) => 100 + (p % 7) });
    const r = displayRange([faint, bright]);
    expect(r.hi).toBeGreaterThan(100);
    expect(r.lo).toBeLessThan(100);
  });

  it('handles all-NaN and constant input', () => {
    const empty = frame(80, 1, { fill: () => NaN });
    expect(displayRange([empty])).toEqual({ lo: 0, hi: 1 });
    expect(displayRange([])).toEqual({ lo: 0, hi: 1 });
    const flat = displayRange([frame(80, 1, { bg: 5 })]);
    expect(flat.hi).toBeGreaterThan(flat.lo);
    const pct = displayRange([sky(3)], { loPercentile: 1, hiPercentile: 99 });
    expect(pct.lo).toBeLessThan(-1.5);
  });
});

describe('selectBalanced', () => {
  it('keeps only channels shared by every well-sampled visit', () => {
    const V: Visit[] = [visit(0, 60600, 60614, '2024-12-01'), visit(1, 60780, 60794, '2025-05-30'), visit(2, 60960, 60974, '2025-11-26')];
    const cut = (c: number, mjd: number, dw = 0): NativeCutout => {
      const ch = CHANNELS[c - 1];
      return {
        exposure: { id: `E${counter++}D${ch.detector}`, detector: ch.detector, mjd },
        header: { mjdAvg: mjd },
        cubeChannel: c,
        wavelength: ch.wavelength + dw,
        bandwidth: ch.bandwidth,
      } as unknown as NativeCutout;
    };
    const cs = [
      ...range(70, 80).map((c) => cut(c, 60601)),
      ...range(75, 85).map((c) => cut(c, 60781, c === 76 ? 0.05 : 0)),
      cut(77, 60961),
      cut(20, 60601),
    ];
    const r = selectBalanced(cs, V, COLD);
    // 76 is common but its wavelength in visit 1 is shifted by more than half a bandwidth.
    expect(r.commonChannels).toEqual([75, 77, 78, 79, 80]);
    expect([...r.byVisit.keys()]).toEqual([0, 1]);
    expect(r.byVisit.get(0)!.map((c) => c.cubeChannel)).toEqual([75, 77, 78, 79, 80]);
    const loose = selectBalanced(cs, V, COLD, { tolerance: 10 });
    expect(loose.commonChannels).toEqual(range(75, 80));
  });
});
