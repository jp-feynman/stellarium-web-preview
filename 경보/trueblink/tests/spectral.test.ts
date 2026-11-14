// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import type { SkyFrame, SkyGrid, Visit } from '../src/core/types';
import { buildSpectralDifferenceSequence, COLD_FILTER, fitStarScale, rayleighJeansScale } from '../src/core/stack/spectral';

const grid: SkyGrid = { ra0: 133.78, dec0: -7.24, n: 41, scaleArcsec: 3.075 };

function gauss(data: Float32Array, n: number, cx: number, cy: number, amp: number) {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] += amp * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * 1.6 ** 2));
}

/** A field of hot stars (Rayleigh-Jeans: flux ~ 1/lambda^2) plus one cold source seen only beyond 4.1 um. */
function frame(wavelength: number, mjd: number, visit: number, seed: number, coldX = 20): SkyFrame {
  const n = grid.n;
  const data = new Float32Array(n * n);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.02;
  for (let p = 0; p < data.length; p++) data[p] = rnd();
  const rj = (4.0 / wavelength) ** 2;
  gauss(data, n, 8, 9, 6 * rj);
  gauss(data, n, 30, 12, 3 * rj);
  gauss(data, n, 12, 31, 9 * rj);
  gauss(data, n, 33, 33, 4 * rj);
  if (wavelength > 4.1) gauss(data, n, coldX, 20, 1.0);
  return {
    grid,
    data,
    meta: { kind: 'exposure', label: `${wavelength}`, mjd, mjdMin: mjd, mjdMax: mjd, wavelength, waveMin: wavelength - 0.02, waveMax: wavelength + 0.02, detectors: [wavelength < 4.42 ? 5 : 6], nExposures: 1, exposureIds: [`e${seed}`], visit },
  };
}

const visits: Visit[] = [
  { index: 0, mjdMin: 60980, mjdMax: 60990, mjdMid: 60985, exposureIds: [], label: '2025-11-07' },
  { index: 1, mjdMin: 61150, mjdMax: 61160, mjdMid: 61155, exposureIds: [], label: '2026-04-26' },
];

function field(): SkyFrame[] {
  const out: SkyFrame[] = [];
  let seed = 1;
  for (const v of visits) {
    for (const w of [3.84, 3.9, 3.96, 4.02, 4.25, 4.35, 4.5, 4.62, 4.75]) out.push(frame(w, v.mjdMid, v.index, seed++, v.index === 0 ? 20 : 22));
  }
  return out;
}

describe('cold-object spectral difference', () => {
  it('Rayleigh-Jeans scale', () => {
    expect(rayleighJeansScale(4.5, 3.935)).toBeCloseTo(0.7647, 3);
  });

  it('cancels hot stars and keeps the cold source, one frame per visit', () => {
    const seq = buildSpectralDifferenceSequence(field(), visits, COLD_FILTER);
    expect(seq.length).toBe(2);
    const n = grid.n;
    for (const [k, f] of seq.entries()) {
      expect(f.meta.kind).toBe('difference');
      expect(f.meta.visit).toBe(k);
      const star = f.data[31 * n + 12]; // brightest hot star (amplitude about 7 before subtraction)
      const cold = f.data[20 * n + (k === 0 ? 20 : 22)];
      expect(Math.abs(star)).toBeLessThan(0.35); // under 5 % of the star is left
      expect(cold).toBeGreaterThan(0.8); // the cold source survives almost untouched
      expect(f.meta.notes!.join(' ')).toMatch(/ordinary stars cancel/);
    }
    // The cold source moved two pixels east-to-west between the visits: a clean mover on a blank field.
    expect(seq[1].data[20 * n + 20]).toBeLessThan(0.5 * seq[1].data[20 * n + 22]);
  });

  it('fits the scale on field stars and falls back when there are none', () => {
    const frames = field();
    const seq = buildSpectralDifferenceSequence(frames, visits, COLD_FILTER, { scale: 'fit' });
    expect(seq[0].meta.notes!.join(' ')).toMatch(/measured on \d+ bright star pixels/);
    const blank = new Float32Array(100).fill(0.001);
    expect(fitStarScale(blank, blank)).toBeNull();
  });

  it('leaves out visits without both bands and says so', () => {
    const frames = field().filter((f) => !(f.meta.visit === 1 && f.meta.wavelength < 4.1));
    const seq = buildSpectralDifferenceSequence(frames, visits, COLD_FILTER);
    expect(seq.length).toBe(1);
    expect(seq[0].meta.notes!.join(' ')).toMatch(/left out 2026-04-26/);
  });
});
