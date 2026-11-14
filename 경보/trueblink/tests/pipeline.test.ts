// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Pure planning helpers of the real pipeline (src/app/pipeline/plan.ts).
import { describe, expect, it } from 'vitest';
import { BAND_GROUPS, type DetectorId, type Exposure, type SkyFrame } from '../src/core/types';
import { waveTables } from '../src/core/wave';
import {
  channelRank,
  chooseBalancedVisits,
  groupMidWavelength,
  inBandGroup,
  nearbyMovedPreset,
  orderForLoading,
  predictExposure,
  rescaleForDisplay,
  roundRobin,
  symmetricRange,
} from '../src/app/pipeline/plan';

/** A synthetic exposure whose footprint is a 1.7 deg-ish square around (ra0, dec0), axis-aligned. */
function exp(id: string, det: DetectorId, mjd: number, ra0 = 10, dec0 = 0): Exposure {
  const h = (1020 * 6.15) / 3600;
  // Corners in pixel-corner order (-0.5,-0.5), (2039.5,-0.5), (2039.5,2039.5), (-0.5,2039.5); x grows west (RA down).
  const sRegion = [ra0 + h, dec0 - h, ra0 - h, dec0 - h, ra0 - h, dec0 + h, ra0 + h, dec0 + h];
  return {
    id,
    obsId: id,
    detector: det,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: mjd,
    mjdEnd: mjd,
    mjd,
    url: '',
    s3Key: '',
    sRa: ra0,
    sDec: dec0,
    sRegion,
    emMin: 0,
    emMax: 0,
    pipelineTag: '',
  };
}

function frame(data: number[], kind: SkyFrame['meta']['kind'] = 'stack'): SkyFrame {
  const n = Math.round(Math.sqrt(data.length));
  return {
    grid: { ra0: 0, dec0: 0, n, scaleArcsec: 3 },
    data: Float32Array.from(data),
    meta: { kind, label: 'x', mjd: 0, mjdMin: 0, mjdMax: 0, wavelength: 1, waveMin: 1, waveMax: 1, detectors: [1], nExposures: 1, exposureIds: [] },
  };
}

describe('predictExposure', () => {
  const tables = waveTables();
  it('puts the footprint centre near the detector centre with a finite wavelength in band', () => {
    const p = predictExposure(exp('a', 3, 60000), { ra: 10, dec: 0 }, tables);
    expect(p.usable).toBe(true);
    expect(p.pix![0]).toBeGreaterThan(1000);
    expect(p.pix![0]).toBeLessThan(1040);
    expect(p.wavelength).toBeGreaterThan(1.6);
    expect(p.wavelength).toBeLessThan(2.45);
    expect(p.cubeChannel).toBeGreaterThan(34);
    expect(p.cubeChannel).toBeLessThanOrEqual(51);
  });
  it('marks positions off the detector or within 6 px of the edge as unusable', () => {
    const h = (1020 * 6.15) / 3600;
    expect(predictExposure(exp('b', 1, 60000), { ra: 10, dec: 5 }, tables).usable).toBe(false);
    // 3 px inside the south edge.
    const p = predictExposure(exp('c', 1, 60000), { ra: 10, dec: -h + (3 * 6.15) / 3600 }, tables);
    expect(p.pix).not.toBeNull();
    expect(p.usable).toBe(false);
  });
});

describe('load order', () => {
  it('round-robins lists', () => {
    expect(roundRobin([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });
  it('puts the band group first and alternates visits and channels', () => {
    const list: Exposure[] = [];
    const visitOf = new Map<string, number>();
    const channelOf = new Map<string, number>();
    let k = 0;
    for (const v of [0, 1]) {
      for (const det of [1, 5] as DetectorId[]) {
        for (const ch of [1, 2]) {
          for (let r = 0; r < 2; r++) {
            const id = `v${v}d${det}c${ch}r${r}`;
            list.push(exp(id, det, 60000 + v * 180 + k++ * 0.01));
            visitOf.set(id, v);
            channelOf.set(id, 17 * (det - 1) + ch);
          }
        }
      }
    }
    const cold = BAND_GROUPS.find((g) => g.id === 'cold')!;
    const order = orderForLoading(list, visitOf, channelOf, cold);
    // First 8 are detector 5 (cold group), alternating visits.
    expect(order.slice(0, 8).every((e) => e.detector === 5)).toBe(true);
    expect(order.slice(0, 4).map((e) => visitOf.get(e.id))).toEqual([0, 1, 0, 1]);
    // Both channels of each visit come before any second exposure of a channel.
    const firstRound = order.slice(0, 4).map((e) => channelOf.get(e.id));
    expect(new Set(firstRound).size).toBe(2);
    expect(order).toHaveLength(list.length);
  });
  it('ranks channels so every detector fills evenly', () => {
    const ranked = Array.from({ length: 102 }, (_, i) => i + 1).sort((a, b) => channelRank(a) - channelRank(b));
    const firstSix = ranked.slice(0, 6).map((c) => Math.ceil(c / 17));
    expect(new Set(firstSix).size).toBe(6);
    expect(channelRank(0)).toBeGreaterThan(channelRank(102));
  });
});

describe('band groups and visits', () => {
  it('knows group membership and middle wavelength', () => {
    const cold = BAND_GROUPS.find((g) => g.id === 'cold')!;
    expect(inBandGroup(cold, 5)).toBe(true);
    expect(inBandGroup(cold, 4)).toBe(false);
    expect(groupMidWavelength(cold)).toBeCloseTo((3.809 + 5.002) / 2, 3);
  });
  it('chooses visits that share channels and leaves out partial ones', () => {
    const full = new Set(Array.from({ length: 100 }, (_, i) => i + 1));
    const partial = new Set([1, 2, 200, 201, 202]);
    const m = new Map<number, Set<number>>([
      [0, full],
      [1, new Set([...full].filter((c) => c % 10 !== 0))],
      [2, partial],
      [3, new Set([...full].filter((c) => c > 20))],
    ]);
    const r = chooseBalancedVisits(m);
    expect(r.chosen).toEqual([0, 1, 3]);
    expect(r.leftOut).toEqual([2]);
    expect(r.common.length).toBeGreaterThan(50);
  });
});

describe('display helpers', () => {
  it('gives a symmetric range and ignores NaN', () => {
    const h = symmetricRange([frame([-2, 1, NaN, 0.5]), frame([0, 4, -1, NaN])], 100);
    expect(h).toBe(4);
  });
  it('rescales an external frame without zero-filling NaN', () => {
    const f = rescaleForDisplay(frame([NaN, 10, 20, 30], 'external'), 2);
    expect(Number.isNaN(f.data[0])).toBe(true);
    expect(f.data[2]).toBe(0);
    expect(f.meta.notes!.some((n) => /rescaled/.test(n))).toBe(true);
  });
});

describe('nearbyMovedPreset', () => {
  it('flags coordinates near a fast mover that has left them', () => {
    const presets = [{ id: 'wise0855', name: 'WISE 0855-0714', pos: { ra: 133.79513, dec: -7.24515 }, propagated: { ra: 133.7601, dec: -7.2421 } }];
    const r = nearbyMovedPreset({ ra: 133.79513, dec: -7.24515 }, presets);
    expect(r?.id).toBe('wise0855');
    expect(r!.offsetArcsec).toBeGreaterThan(100);
    // On top of today's position: nothing to say. Far away: nothing either.
    expect(nearbyMovedPreset({ ra: 133.7601, dec: -7.2421 }, presets)).toBeNull();
    expect(nearbyMovedPreset({ ra: 140, dec: -7 }, presets)).toBeNull();
  });
});

// A one-exposure hit (cosmic ray, artefact) in one channel must not show up as a "new source" in a
// balanced epoch: seen live on WISE 0855-0714 (2025-11-07, cold arrays, one exposure at 4.67 um).
import { buildEpochSequence } from '../src/core/stack';
import { CHANNELS } from '../src/core/wave';
import type { SkyGrid, Visit } from '../src/core/types';

describe('balanced epochs reject one-channel artefacts', () => {
  const N = 12;
  const GRID: SkyGrid = { ra0: 133.76, dec0: -7.24, n: N, scaleArcsec: 3.075 };
  const HIT = 3 * N + 9;
  const STAR = 6 * N + 6;
  let id = 0;
  const mk = (c: number, mjd: number, v: number, hit = 0): SkyFrame => {
    const ch = CHANNELS[c - 1];
    const data = new Float32Array(N * N);
    for (let p = 0; p < N * N; p++) data[p] = 0.02 * Math.sin(p * 7.3 + c); // noise-like background
    data[STAR] += 2 + 0.05 * c; // a red star: brighter at longer wavelength
    data[HIT] += hit;
    const name = `E${id++}D${ch.detector}`;
    return {
      grid: GRID,
      data,
      meta: { kind: 'exposure', label: name, mjd, mjdMin: mjd, mjdMax: mjd, wavelength: ch.wavelength, waveMin: ch.waveMin, waveMax: ch.waveMax, detectors: [ch.detector], nExposures: 1, exposureIds: [name], cubeChannels: [c], visit: v },
    };
  };
  const cold = CHANNELS.filter((c) => c.detector >= 5).map((c) => c.cubeChannel);
  const visits: Visit[] = [
    { index: 0, mjdMin: 60980, mjdMax: 60990, mjdMid: 60985, exposureIds: [], label: 'A' },
    { index: 1, mjdMin: 61150, mjdMax: 61160, mjdMid: 61155, exposureIds: [], label: 'B' },
  ];
  const frames = [...cold.map((c, k) => mk(c, 60981 + k * 0.1, 0, k === 7 ? 11 : 0)), ...cold.map((c, k) => mk(c, 61151 + k * 0.1, 1))];
  const seq = buildEpochSequence(frames, visits, BAND_GROUPS.find((g) => g.id === 'cold')!, { balanced: true });

  it('the hit pixel matches the other epoch, the star keeps its flux', () => {
    expect(seq.length).toBe(2);
    expect(Math.abs(seq[0].data[HIT] - seq[1].data[HIT])).toBeLessThan(0.05);
    expect(Math.abs(seq[0].data[STAR] - seq[1].data[STAR])).toBeLessThan(0.05);
    expect(seq[0].data[STAR]).toBeGreaterThan(2);
  });
});
