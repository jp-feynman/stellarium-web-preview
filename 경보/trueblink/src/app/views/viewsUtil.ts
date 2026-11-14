// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Pure helpers for the sky map and the 3D stack panels (no DOM; unit-tested in viewsUtil.test.ts).
import type { SkyFrame, SkyPos, TargetInfo } from '../../core/types';
import { CHANNELS, type SpectralChannel } from '../../core/wave';
import { PRESETS } from '../../core/archive';
import { propagateSource } from '../../core/astrometry';
import { BLANK_FRAMES } from '../../gl/globe/tiles';

/** MJD of epoch J2026.0 (the epoch the sky-map markers are drawn at). */
export const MJD_2026 = 51544.5 + 26 * 365.25;

/** The 100 cube channels that have an all-sky image (cube frames 50 and 51 are blank in DR1), blue to red. */
export function mapChannels(): SpectralChannel[] {
  return CHANNELS.filter((c) => !BLANK_FRAMES.includes(c.cubeChannel - 1)).sort((a, b) => a.wavelength - b.wavelength || a.cubeChannel - b.cubeChannel);
}

/** The usable channel whose central wavelength is closest to `um` (default 1.2 microns). */
export function channelNear(um = 1.2, list: SpectralChannel[] = mapChannels()): SpectralChannel {
  let best = list[0];
  for (const c of list) if (Math.abs(c.wavelength - um) < Math.abs(best.wavelength - um)) best = c;
  return best;
}

export interface PresetMarker {
  id: string;
  ra: number;
  dec: number;
  /** Short label for the map. */
  label: string;
  /** Name handed to onPick (resolvable by the pipeline: Sesame name or the preset's own name). */
  pickName: string;
  challenge: boolean;
}

/** Short map labels (the archive names are long, e.g. "Epsilon Indi B (Ba+Bb)"). */
const SHORT: Record<string, string> = {
  barnard: "Barnard's Star",
  epsIndB: 'Eps Indi B',
  wise0855: 'WISE 0855−0714',
  rwaur: 'RW Aur',
  rdra: 'R Dra',
  nep: 'NEP deep field',
  ecliptic: 'Ecliptic field',
  coma: 'Coma cluster',
};

/** Markers for every preset (five challenge targets plus the comparison fields), positions at `mjd`. */
export function presetMarkers(mjd = MJD_2026): PresetMarker[] {
  return PRESETS.map((p) => {
    const pos = propagateSource({ ra: p.ra, dec: p.dec, epoch: p.epoch, pmRa: p.pmRa, pmDec: p.pmDec, parallax: p.parallax }, mjd);
    return {
      id: `preset:${p.id}`,
      ra: pos.ra,
      dec: pos.dec,
      label: SHORT[p.id] ?? p.name,
      pickName: p.challenge ? p.sesameName ?? p.name : p.name,
      challenge: p.challenge,
    };
  });
}

/** Up to `cap` items evenly spread over the list (keeps the first and the last). */
export function sampleEvenly<T>(list: T[], cap: number): T[] {
  const n = list.length;
  if (n <= cap) return list.slice();
  if (cap <= 0) return [];
  if (cap === 1) return [list[0]];
  const out: T[] = [];
  for (let k = 0; k < cap; k++) out.push(list[Math.round((k * (n - 1)) / (cap - 1))]);
  return out;
}

/** Single-exposure frames for the cube: time ordered, evenly sampled down to `cap`, only on the first frame's grid. */
export function exposureStack(frames: Iterable<SkyFrame>, cap = 240): SkyFrame[] {
  const all = [...frames].filter((f) => f && f.data && f.grid);
  if (all.length === 0) return [];
  const n = all[0].grid.n;
  const same = all.filter((f) => f.grid.n === n && f.data.length === n * n);
  same.sort((a, b) => a.meta.mjd - b.meta.mjd);
  return sampleEvenly(same, cap);
}

/** True when the target has a catalogue proper motion worth drawing (above 1 mas/yr). */
export function hasProperMotion(t: TargetInfo | null | undefined): t is TargetInfo {
  if (!t) return false;
  const pm = Math.hypot(t.pmRa ?? 0, t.pmDec ?? 0);
  return Number.isFinite(pm) && pm > 1;
}

/** Predicted path [ra, dec, mjd] of the target over the frames' time span (proper motion + parallax). */
export function predictedTrack(target: TargetInfo, frames: SkyFrame[], steps = 160): [number, number, number][] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of frames) {
    const a = Number.isFinite(f.meta.mjdMin) ? f.meta.mjdMin : f.meta.mjd;
    const b = Number.isFinite(f.meta.mjdMax) ? f.meta.mjdMax : f.meta.mjd;
    if (Number.isFinite(a)) lo = Math.min(lo, a);
    if (Number.isFinite(b)) hi = Math.max(hi, b);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi - lo < 1e-6) hi = lo + 1e-6;
  const n = Math.max(2, Math.floor(steps));
  const src = { ra: target.ra, dec: target.dec, epoch: target.epoch, pmRa: target.pmRa, pmDec: target.pmDec, parallax: target.parallax };
  const out: [number, number, number][] = [];
  for (let k = 0; k < n; k++) {
    const mjd = lo + ((hi - lo) * k) / (n - 1);
    const p = propagateSource(src, mjd);
    out.push([p.ra, p.dec, mjd]);
  }
  return out;
}

/** Field of view (degrees) after one zoom step in (factor < 1) or out (factor > 1), clamped. */
export function zoomFov(fov: number, factor: number, min = 1.5, max = 100): number {
  return Math.min(max, Math.max(min, fov * factor));
}

/** Readable field of view, e.g. "60°" or "2.5°" or "45'". */
export function formatFov(fovDeg: number): string {
  if (fovDeg >= 10) return `${Math.round(fovDeg)}°`;
  if (fovDeg >= 2) return `${fovDeg.toFixed(1)}°`;
  return `${Math.round(fovDeg * 60)}′`;
}

/** Same sky position to within ~1 arcsec. */
export function samePos(a: SkyPos | null | undefined, b: SkyPos | null | undefined): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.dec - b.dec) < 3e-4 && Math.abs(((a.ra - b.ra + 540) % 360) - 180) * Math.cos((a.dec * Math.PI) / 180) < 3e-4;
}
