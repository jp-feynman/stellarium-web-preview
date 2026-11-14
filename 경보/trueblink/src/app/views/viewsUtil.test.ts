// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import type { SkyFrame, TargetInfo } from '../../core/types';
import { channelNear, exposureStack, hasProperMotion, mapChannels, MJD_2026, predictedTrack, presetMarkers, sampleEvenly, samePos, zoomFov } from './viewsUtil';

function frame(mjd: number, n = 4): SkyFrame {
  return {
    grid: { ra0: 10, dec0: 0, n, scaleArcsec: 3 },
    data: new Float32Array(n * n),
    meta: { kind: 'exposure', label: '', mjd, mjdMin: mjd, mjdMax: mjd, wavelength: 1, waveMin: 1, waveMax: 1, detectors: [1], nExposures: 1, exposureIds: [] },
  };
}

describe('views helpers', () => {
  it('skips the two blank cube frames and defaults near 1.2 um', () => {
    const ch = mapChannels();
    expect(ch.length).toBe(100);
    expect(ch.some((c) => c.cubeChannel === 51 || c.cubeChannel === 52)).toBe(false);
    for (let k = 1; k < ch.length; k++) expect(ch[k].wavelength).toBeGreaterThanOrEqual(ch[k - 1].wavelength);
    const d = channelNear(1.2);
    expect(Math.abs(d.wavelength - 1.2)).toBeLessThan(0.03);
  });

  it('places the preset markers at J2026 (Barnard has moved about 270 arcsec north since J2000)', () => {
    const m = presetMarkers(MJD_2026);
    expect(m.length).toBeGreaterThanOrEqual(5);
    expect(m.filter((x) => x.challenge).length).toBe(5);
    const b = m.find((x) => x.id === 'preset:barnard')!;
    // 10.36 arcsec/yr north over 26 years = 269 arcsec = 0.0748 deg (parallax adds < 1 arcsec).
    expect(b.dec - 4.6934104643651775).toBeGreaterThan(0.073);
    expect(b.dec - 4.6934104643651775).toBeLessThan(0.0765);
    expect(b.pickName).toBe("Barnard's Star");
  });

  it('samples evenly and keeps the ends', () => {
    const a = Array.from({ length: 1000 }, (_, k) => k);
    const s = sampleEvenly(a, 240);
    expect(s.length).toBe(240);
    expect(s[0]).toBe(0);
    expect(s[239]).toBe(999);
    expect(new Set(s).size).toBe(240);
    expect(sampleEvenly([1, 2, 3], 240)).toEqual([1, 2, 3]);
  });

  it('orders exposure frames by time and drops other grids', () => {
    const fs = [frame(60300), frame(60100), frame(60200, 8)];
    const out = exposureStack(fs);
    expect(out.map((f) => f.meta.mjd)).toEqual([60100, 60300]);
  });

  it('predicts a track over the frames span only for moving targets', () => {
    const t: TargetInfo = { id: 'x', name: 'x', ra: 100, dec: 20, epoch: 2025.5, pmRa: 0, pmDec: 3600_000 };
    expect(hasProperMotion(t)).toBe(true);
    expect(hasProperMotion({ ...t, pmDec: 0 })).toBe(false);
    const tr = predictedTrack(t, [frame(60800), frame(61165.25)], 3);
    expect(tr.length).toBe(3);
    expect(tr[0][2]).toBe(60800);
    // 3600 arcsec/yr = 1 deg/yr north.
    expect(tr[2][1] - tr[0][1]).toBeCloseTo(1, 2);
  });

  it('clamps zoom and compares positions', () => {
    expect(zoomFov(2, 0.5)).toBe(1.5);
    expect(zoomFov(80, 2)).toBe(100);
    expect(samePos({ ra: 359.99999, dec: 0 }, { ra: 0.00001, dec: 0 })).toBe(true);
    expect(samePos({ ra: 10, dec: 0 }, { ra: 10.01, dec: 0 })).toBe(false);
  });
});
