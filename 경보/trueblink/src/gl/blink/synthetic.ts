// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Synthetic blink sequence for demos and tests: a small north-up grid with noise, fixed stars, one
// source moving 1 pixel per frame (westward, i.e. towards larger column index), one source fading,
// a bright star in the north-east corner (orientation check) and a patch with no data.

import type { Overlay, SkyFrame, SkyGrid } from '../../core/types';
import { gridPixToSky } from '../../core/wcs';

export interface SyntheticScene {
  grid: SkyGrid;
  frames: SkyFrame[];
  overlays: Overlay[];
  /** Grid pixel of the mover in each frame. */
  mover: [number, number][];
  /** Grid pixel of the north-east marker star (high row, low column). */
  northEastStar: [number, number];
  fader: [number, number];
  /** Inclusive pixel box with no data in frame 2: [i0, j0, i1, j1]. */
  nanPatch: [number, number, number, number];
}

/** Small deterministic PRNG (mulberry32) so screenshots are reproducible. */
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

function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Add a point source with a Gaussian PSF (SPHEREx PSFs are about 1.2-1.5 pixels FWHM). */
function addStar(data: Float32Array, n: number, ci: number, cj: number, amp: number, sigma = 0.75): void {
  const R = Math.ceil(4 * sigma);
  for (let j = Math.max(0, Math.floor(cj) - R); j <= Math.min(n - 1, Math.ceil(cj) + R); j++) {
    for (let i = Math.max(0, Math.floor(ci) - R); i <= Math.min(n - 1, Math.ceil(ci) + R); i++) {
      const d2 = (i - ci) ** 2 + (j - cj) ** 2;
      data[j * n + i] += amp * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

export function syntheticScene(seed = 7): SyntheticScene {
  const n = 61;
  const grid: SkyGrid = { ra0: 133.79, dec0: -7.245, n, scaleArcsec: 6.15 };
  const r = rng(seed);
  const stars: [number, number, number][] = [];
  for (let k = 0; k < 12; k++) {
    stars.push([3 + r() * (n - 6), 3 + r() * (n - 6), 0.4 + 4 * r() ** 2]);
  }
  const northEastStar: [number, number] = [4, 56];
  const fader: [number, number] = [44, 16];
  const faderAmp = [4, 2.5, 1.2, 0.4];
  const mover: [number, number][] = [0, 1, 2, 3].map((k) => [24 + k, 32]);
  const nanPatch: [number, number, number, number] = [46, 40, 54, 48];
  const dates = ['2025-05-06', '2025-11-11', '2026-05-02', '2026-11-05'];
  const waves = [4.61, 4.6, 4.62, 4.61];

  const frames: SkyFrame[] = dates.map((date, k) => {
    const data = new Float32Array(n * n);
    for (let p = 0; p < data.length; p++) data[p] = 0.3 + 0.03 * gauss(r);
    for (const [i, j, a] of stars) addStar(data, n, i, j, a);
    addStar(data, n, northEastStar[0], northEastStar[1], 12);
    addStar(data, n, fader[0], fader[1], faderAmp[k]);
    addStar(data, n, mover[k][0], mover[k][1], 3);
    if (k === 2) {
      const [i0, j0, i1, j1] = nanPatch;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[j * n + i] = NaN;
    }
    if (k === 3) {
      // A strip along the south edge that this visit did not cover.
      for (let j = 0; j < 3; j++) for (let i = 0; i < n; i++) data[j * n + i] = NaN;
    }
    const mjd = Date.parse(`${date}T00:00:00Z`) / 86400000 + 40587;
    return {
      grid,
      data,
      meta: {
        kind: 'stack',
        label: `${date} · D6 · ${waves[k].toFixed(2)} um · 12 exp`,
        mjd,
        mjdMin: mjd - 3,
        mjdMax: mjd + 3,
        wavelength: waves[k],
        waveMin: waves[k] - 0.02,
        waveMax: waves[k] + 0.02,
        detectors: [6],
        nExposures: 12,
        exposureIds: [],
        visit: k,
      },
    };
  });

  const sky = (i: number, j: number) => gridPixToSky(grid, i, j);
  const overlays: Overlay[] = [];
  mover.forEach(([i, j], k) => {
    const [ra, dec] = sky(i, j);
    overlays.push({ id: `mover-${k}`, kind: 'circle', ra, dec, sizeArcsec: 14, color: '#ffb454', frameIndex: k, data: { frame: k } });
  });
  const path = mover.map(([i, j]) => sky(i, j - 4));
  overlays.push({ id: 'track', kind: 'track', ra: path[0][0], dec: path[0][1], path, color: '#5ad1e6', text: 'track' });
  const [lra, ldec] = sky(mover[0][0] - 3, mover[0][1] + 5);
  overlays.push({ id: 'mover-label', kind: 'label', ra: lra, dec: ldec, text: 'Mover', color: '#ffb454' });
  const [fra, fdec] = sky(fader[0], fader[1]);
  overlays.push({ id: 'fader', kind: 'cross', ra: fra, dec: fdec, sizeArcsec: 18, text: 'Fader', color: '#f2c14e' });
  const [nra, ndec] = sky(northEastStar[0], northEastStar[1]);
  overlays.push({ id: 'ne', kind: 'box', ra: nra, dec: ndec, sizeArcsec: 16, text: 'NE star', color: '#5fd38d' });
  return { grid, frames, overlays, mover, northEastStar, fader, nanPatch };
}
