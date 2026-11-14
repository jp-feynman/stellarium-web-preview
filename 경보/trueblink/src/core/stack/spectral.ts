// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Spectral difference ("cold-object filter").
//
// Ordinary stars are thousands of degrees hot, so between 3.8 and 5 microns their light follows the
// smooth Rayleigh-Jeans tail: brightness falls as 1 / wavelength^2. A very cold object (a brown dwarf of
// a few hundred kelvin, like WISE 0855-0714) is completely different: methane swallows its light near
// 3.3-3.9 microns and it shines through a window at 4.2-4.8 microns. So if we take an image made from the
// 4.2-4.8 micron exposures and subtract a scaled image made from the 3.82-4.05 micron exposures, ordinary
// stars cancel and cold objects stay. This is the same idea as the WISE "W1 - W2" colour that found the
// coldest brown dwarfs, done with SPHEREx's own narrow channels, one frame per visit, so the result can
// be blinked over time.

import type { SkyFrame, Visit } from '../types';
import { robustStats, stackFrames } from './index';

export interface SpectralBand {
  /** Wavelength limits in microns. */
  min: number;
  max: number;
}

export interface SpectralFilter {
  id: string;
  label: string;
  /** Band where the objects of interest are bright. */
  on: SpectralBand;
  /** Reference band that carries ordinary stars but little of the objects of interest. */
  off: SpectralBand;
}

/** Cold brown dwarfs and other objects with deep methane absorption: bright at 4.2-4.8 um, dark at 3.8-4.05 um. */
export const COLD_FILTER: SpectralFilter = {
  id: 'cold',
  label: 'Cold-object filter (4.2-4.8 um minus scaled 3.82-4.05 um)',
  on: { min: 4.2, max: 4.8 },
  off: { min: 3.82, max: 4.05 },
};

export interface SpectralDifferenceOptions {
  /**
   * Scale applied to the reference band. 'fit' (default) measures it on the bright field stars of each
   * visit and falls back to the Rayleigh-Jeans value; 'rj' always uses (lambda_off / lambda_on)^2;
   * a number forces a value.
   */
  scale?: number | 'fit' | 'rj';
  /** Minimum exposures required in each band of a visit (default 3). */
  minExposures?: number;
}

function inBand(f: SkyFrame, band: SpectralBand): boolean {
  const w = f.meta.wavelength;
  return Number.isFinite(w) && w >= band.min && w <= band.max;
}

function visitOfFrame(f: SkyFrame, visits: Visit[]): number {
  if (typeof f.meta.visit === 'number') return f.meta.visit;
  for (const v of visits) {
    if (f.meta.mjd >= v.mjdMin - 0.5 && f.meta.mjd <= v.mjdMax + 0.5) return v.index;
  }
  return -1;
}

/** Rayleigh-Jeans flux-density ratio F_nu(on) / F_nu(off) for a hot source: (lambda_off / lambda_on)^2. */
export function rayleighJeansScale(lambdaOn: number, lambdaOff: number): number {
  return (lambdaOff / lambdaOn) ** 2;
}

/**
 * Measure the on/off scale from the field itself: the median ratio over pixels that are clearly bright
 * in the reference band (ordinary stars). Returns null when there are too few such pixels.
 */
export function fitStarScale(on: Float32Array, off: Float32Array, minPixels = 12): { scale: number; pixels: number } | null {
  const stats = robustStats(off);
  if (!(stats.sigma > 0)) return null;
  const threshold = stats.median + 6 * stats.sigma;
  const ratios: number[] = [];
  for (let p = 0; p < off.length; p++) {
    const o = off[p];
    const a = on[p];
    if (Number.isFinite(o) && Number.isFinite(a) && o > threshold) ratios.push(a / o);
  }
  if (ratios.length < minPixels) return null;
  ratios.sort((x, y) => x - y);
  const mid = ratios.length >> 1;
  const scale = ratios.length % 2 ? ratios[mid] : 0.5 * (ratios[mid - 1] + ratios[mid]);
  if (!Number.isFinite(scale) || scale <= 0.2 || scale >= 3) return null;
  return { scale, pixels: ratios.length };
}

/**
 * One spectral-difference frame per visit: stack(on band) - scale * stack(off band).
 * `frames` are single-exposure frames on one SkyGrid (background already removed). Visits that lack
 * exposures in either band are left out and named in a note on the frames that remain.
 */
export function buildSpectralDifferenceSequence(
  frames: SkyFrame[],
  visits: Visit[],
  filter: SpectralFilter = COLD_FILTER,
  opts: SpectralDifferenceOptions = {},
): SkyFrame[] {
  const minExp = opts.minExposures ?? 3;
  const mode = opts.scale ?? 'fit';
  const out: SkyFrame[] = [];
  const dropped: string[] = [];
  for (const visit of visits) {
    const mine = frames.filter((f) => visitOfFrame(f, visits) === visit.index);
    const onFrames = mine.filter((f) => inBand(f, filter.on));
    const offFrames = mine.filter((f) => inBand(f, filter.off));
    if (onFrames.length < minExp || offFrames.length < minExp) {
      if (mine.length) dropped.push(visit.label);
      continue;
    }
    const on = stackFrames(onFrames, { method: 'sigclip' });
    const off = stackFrames(offFrames, { method: 'sigclip' });
    const rj = rayleighJeansScale(on.meta.wavelength, off.meta.wavelength);
    let scale = rj;
    let how = 'Rayleigh-Jeans value for ordinary stars';
    if (typeof mode === 'number') {
      scale = mode;
      how = 'set by hand';
    } else if (mode === 'fit') {
      const fit = fitStarScale(on.data, off.data);
      if (fit) {
        scale = fit.scale;
        how = `measured on ${fit.pixels} bright star pixels of this field (Rayleigh-Jeans would be ${rj.toFixed(2)})`;
      }
    }
    const n = on.data.length;
    const data = new Float32Array(n);
    const weight = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const a = on.data[p];
      const b = off.data[p];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        data[p] = a - scale * b;
        weight[p] = Math.min(on.weight ? on.weight[p] : 1, off.weight ? off.weight[p] : 1);
      } else {
        data[p] = NaN;
        weight[p] = 0;
      }
    }
    const onRange = `${filter.on.min.toFixed(2)}-${filter.on.max.toFixed(2)}`;
    const offRange = `${filter.off.min.toFixed(2)}-${filter.off.max.toFixed(2)}`;
    out.push({
      grid: on.grid,
      data,
      weight,
      meta: {
        kind: 'difference',
        label: `${visit.label} · cold filter · ${onRange} minus ${scale.toFixed(2)} x ${offRange} um`,
        mjd: on.meta.mjd,
        mjdMin: Math.min(on.meta.mjdMin, off.meta.mjdMin),
        mjdMax: Math.max(on.meta.mjdMax, off.meta.mjdMax),
        wavelength: on.meta.wavelength,
        waveMin: filter.on.min,
        waveMax: filter.on.max,
        detectors: [...new Set([...on.meta.detectors, ...off.meta.detectors])].sort((a, b) => a - b),
        nExposures: on.meta.nExposures + off.meta.nExposures,
        exposureIds: [...on.meta.exposureIds, ...off.meta.exposureIds],
        visit: visit.index,
        cubeChannels: on.meta.cubeChannels,
        notes: [
          'spectral difference: ordinary stars cancel, objects that are bright only beyond 4.2 um remain',
          'what remains is not always cold: dusty young stars stay bright, and T dwarfs (brightest near 4 um) turn dark',
          `${onFrames.length} exposures at ${onRange} um minus ${scale.toFixed(3)} x ${offFrames.length} at ${offRange} um; scale: ${how}`,
        ],
      },
    });
  }
  if (dropped.length) {
    for (const f of out) f.meta.notes!.push(`left out ${dropped.join(', ')}: too few exposures in one of the two bands`);
  }
  return out;
}
