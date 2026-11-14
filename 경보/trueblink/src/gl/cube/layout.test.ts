// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import type { SkyFrame, Stretch } from '../../core/types';
import { computeLayout, dateRangeLabel, mjdToStackPos, tickIndices } from './layout';
import { CUBE_NO_DATA, cubeAlpha, cubeLevel, packLayers } from './stretch';

const grid = { ra0: 10, dec0: 20, n: 3, scaleArcsec: 6 };

function frame(mjd: number, wavelength: number, visit?: number, data?: number[]): SkyFrame {
  return {
    grid,
    data: Float32Array.from(data ?? new Array(9).fill(0)),
    meta: {
      kind: 'exposure',
      label: `f ${mjd}`,
      mjd,
      mjdMin: mjd,
      mjdMax: mjd,
      wavelength,
      waveMin: wavelength,
      waveMax: wavelength,
      detectors: [1],
      nExposures: 1,
      exposureIds: [],
      visit,
    },
  };
}

describe('cube layout, time axis', () => {
  // Three visits of 4 frames, six months apart, given out of order.
  const frames: SkyFrame[] = [];
  for (const [v, t0] of [
    [2, 61166],
    [0, 60800],
    [1, 60983],
  ]) {
    for (let k = 3; k >= 0; k--) frames.push(frame(t0 + 3 * k, 1 + k, v));
  }
  const L = computeLayout(frames, 'time');

  it('orders slices by time and spans 0..1', () => {
    const t = L.order.map((k) => frames[k].meta.mjd);
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(L.pos[0]).toBe(0);
    expect(L.pos[L.pos.length - 1]).toBe(1);
  });

  it('places slices by rank inside a visit and leaves a fixed larger gap between visits', () => {
    expect(L.groups.length).toBe(3);
    const step = L.pos[1] - L.pos[0];
    expect(L.pos[2] - L.pos[1]).toBeCloseTo(step, 12);
    const gap = L.pos[4] - L.pos[3];
    expect(gap).toBeGreaterThanOrEqual(3.9 * step);
    expect(L.pos[8] - L.pos[7]).toBeCloseTo(gap, 12);
  });

  it('labels one tick per visit with its dates, in time order', () => {
    expect(L.ticks.length).toBe(3);
    expect(L.ticks[0].text.startsWith('2025-05-')).toBe(true);
    expect(L.ticks.map((t) => t.pos)).toEqual([...L.ticks.map((t) => t.pos)].sort((a, b) => a - b));
    expect(L.ticks[0].text).toContain('4 frames');
  });

  it('maps epochs to the stack: exact on slices, inside the gap between visits, clamped outside', () => {
    for (let k = 0; k < L.order.length; k++) expect(mjdToStackPos(L, frames, frames[L.order[k]].meta.mjd)).toBeCloseTo(L.pos[k], 12);
    const mid = mjdToStackPos(L, frames, 60900);
    expect(mid).toBeGreaterThan(L.pos[3]);
    expect(mid).toBeLessThan(L.pos[4]);
    expect(mjdToStackPos(L, frames, 50000)).toBe(0);
    expect(mjdToStackPos(L, frames, 70000)).toBe(1);
  });

  it('splits visits by gaps when frames carry no visit index', () => {
    const fr = [frame(100, 1), frame(101, 1), frame(150, 1), frame(152, 1), frame(153, 1)];
    const l2 = computeLayout(fr, 'time');
    expect(l2.groups.map((g) => g.last - g.first + 1)).toEqual([2, 3]);
  });

  it('uses dated ticks along a single visit', () => {
    const fr = Array.from({ length: 20 }, (_, k) => frame(60800 + k * 0.5, 1));
    const l3 = computeLayout(fr, 'time', { maxTicks: 5 });
    expect(l3.groups.length).toBe(1);
    expect(l3.ticks.length).toBe(5);
    expect(l3.ticks[0].pos).toBe(0);
  });
});

describe('cube layout, wavelength axis', () => {
  it('orders by wavelength with uniform spacing and micron labels', () => {
    const fr = [frame(1, 4.2), frame(2, 0.8), frame(3, 2.4)];
    const L = computeLayout(fr, 'wavelength');
    expect(L.order).toEqual([1, 2, 0]);
    expect(L.pos).toEqual([0, 0.5, 1]);
    expect(L.ticks.map((t) => t.text)).toEqual(['0.80 µm', '2.40 µm', '4.20 µm']);
  });

  it('handles empty and single inputs', () => {
    expect(computeLayout([], 'wavelength').order).toEqual([]);
    expect(computeLayout([frame(1, 2)], 'time').pos).toEqual([0.5]);
  });
});

describe('helpers', () => {
  it('tickIndices keeps first and last', () => {
    expect(tickIndices(100, 4)).toEqual([0, 33, 66, 99]);
    expect(tickIndices(3, 8)).toEqual([0, 1, 2]);
  });
  it('dateRangeLabel', () => {
    expect(dateRangeLabel(60800, 60800.4)).toBe('2025-05-05');
    expect(dateRangeLabel(60800, 60811)).toBe('2025-05-05 to 05-16');
  });
});

describe('cube stretch and packing', () => {
  const s: Stretch = { lo: 0, hi: 10, mode: 'linear', q: 10, invert: false, colormap: 'gray' };
  it('levels and opacity: sky transparent, sources opaque, NaN no data', () => {
    expect(cubeLevel(5, s)).toBeCloseTo(0.5);
    expect(cubeLevel(-3, s)).toBe(0);
    expect(cubeLevel(20, s)).toBe(1);
    expect(Number.isNaN(cubeLevel(NaN, s))).toBe(true);
    expect(cubeAlpha(cubeLevel(0.5, s))).toBe(0);
    expect(cubeAlpha(1)).toBe(1);
    expect(cubeAlpha(NaN)).toBe(0);
    const a = { ...s, mode: 'asinh' as const };
    expect(cubeLevel(1, a)).toBeGreaterThan(0.1);
    expect(cubeLevel(10, a)).toBeCloseTo(1, 12);
  });
  it('packs layers in slice order with a sentinel for NaN, never zero', () => {
    const f0 = frame(1, 1, 0, [1, 2, 3, 4, NaN, 6, 7, 8, 9]);
    const f1 = frame(2, 1, 0, [9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const packed = packLayers([f0, f1], [1, 0], 0, 2, 3);
    expect(Array.from(packed.slice(0, 9))).toEqual(new Array(9).fill(9));
    expect(packed[9 + 4]).toBe(Math.fround(CUBE_NO_DATA));
    expect(packed[9 + 5]).toBe(6);
  });
});
