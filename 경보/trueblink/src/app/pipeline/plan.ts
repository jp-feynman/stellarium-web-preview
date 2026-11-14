// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Pure planning helpers of the real data pipeline (no DOM, no network; unit-tested in tests/pipeline.test.ts):
// predicted wavelength per exposure, load order, preset proximity, and display stretches.
import { angularSepArcsec } from '../../core/wcs';
import { approxPixFromRegion, cubeChannelAt, waveAt, type WaveTable } from '../../core/wave';
import { DETECTOR_BANDS, type BandGroup, type Exposure, type SkyFrame, type SkyPos, type Visit } from '../../core/types';

/** Pixels closer than this to the detector edge are not worth a download (the cutout would be mostly empty). */
export const EDGE_SKIP_PX = 6;
const NPIX = 2040;

export interface Prediction {
  /** Predicted full-frame pixel of the field centre (0-based), or null when off the detector. */
  pix: [number, number] | null;
  wavelength: number;
  cubeChannel: number;
  /** False when the position is off the detector or within EDGE_SKIP_PX of its edge. */
  usable: boolean;
}

/** Where the field centre lands on each exposure and at which wavelength, from the SIA footprint alone. */
export function predictExposure(e: Exposure, pos: SkyPos, tables: Record<number, WaveTable>): Prediction {
  const pix = approxPixFromRegion(e.sRegion, pos.ra, pos.dec);
  if (!pix) return { pix: null, wavelength: NaN, cubeChannel: 0, usable: false };
  const [x, y] = pix;
  const usable = x >= EDGE_SKIP_PX - 0.5 && y >= EDGE_SKIP_PX - 0.5 && x <= NPIX - 0.5 - EDGE_SKIP_PX && y <= NPIX - 0.5 - EDGE_SKIP_PX;
  const table = tables[e.detector];
  const cx = Math.min(NPIX - 1, Math.max(0, x));
  const cy = Math.min(NPIX - 1, Math.max(0, y));
  const wavelength = table ? waveAt(table, cx, cy).wavelength : NaN;
  return { pix, wavelength, cubeChannel: cubeChannelAt(e.detector, cx, cy), usable };
}

/** True when the exposure's detector belongs to the band group (and its predicted wavelength to the window, if any). */
export function inBandGroup(group: BandGroup, detector: number, wavelength?: number): boolean {
  if (!group.detectors.includes(detector)) return false;
  if (wavelength !== undefined && Number.isFinite(wavelength)) {
    if (group.waveMin !== undefined && wavelength < group.waveMin) return false;
    if (group.waveMax !== undefined && wavelength > group.waveMax) return false;
  }
  return true;
}

/** Interleave several lists: a[0], b[0], c[0], a[1], b[1], ... */
export function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let k = 0; k < max; k++) for (const l of lists) if (k < l.length) out.push(l[k]);
  return out;
}

/**
 * Load order: exposures of the current band group first, then the rest. Within each part the visits
 * take turns, and within a visit the spectral channels take turns, so a capped or half-finished load
 * still gives every date the same spread of wavelengths (what a like-with-like blink needs).
 */
export function orderForLoading(
  exposures: Exposure[],
  visitOf: Map<string, number>,
  channelOf: Map<string, number>,
  group: BandGroup,
  wavelengthOf?: Map<string, number>,
): Exposure[] {
  const first: Exposure[] = [];
  const rest: Exposure[] = [];
  for (const e of exposures) (inBandGroup(group, e.detector, wavelengthOf?.get(e.id)) ? first : rest).push(e);
  return [...interleave(first, visitOf, channelOf), ...interleave(rest, visitOf, channelOf)];
}

/** Order in which a detector's 17 channels are visited: spread out, so a cut-short round still spans the band. */
const SPREAD = [9, 1, 17, 5, 13, 3, 11, 7, 15, 2, 10, 6, 14, 4, 12, 8, 16];

/**
 * Sort key of a cube channel within one load round: the same channel position on every detector first
 * (so all six arrays fill evenly), spread over each detector's band; off-nominal (0) last. The order is
 * identical for every visit, so a capped load still gives the dates channels in common.
 */
export function channelRank(cubeChannel: number): number {
  if (cubeChannel < 1 || cubeChannel > 102) return 1e6;
  const det = Math.ceil(cubeChannel / 17);
  const ch = cubeChannel - 17 * (det - 1);
  return SPREAD.indexOf(ch) * 10 + det;
}

function interleave(list: Exposure[], visitOf: Map<string, number>, channelOf: Map<string, number>): Exposure[] {
  const byVisit = new Map<number, Exposure[]>();
  for (const e of list) {
    const v = visitOf.get(e.id) ?? -1;
    const arr = byVisit.get(v);
    if (arr) arr.push(e);
    else byVisit.set(v, [e]);
  }
  const perVisit: Exposure[][] = [];
  for (const v of [...byVisit.keys()].sort((a, b) => a - b)) {
    const byChan = new Map<number, Exposure[]>();
    for (const e of byVisit.get(v)!) {
      const c = channelOf.get(e.id) ?? 0;
      const arr = byChan.get(c);
      if (arr) arr.push(e);
      else byChan.set(c, [e]);
    }
    const chans = [...byChan.keys()].sort((a, b) => channelRank(a) - channelRank(b));
    // Within one channel, take exposures in time order so the visit's span is sampled too.
    perVisit.push(roundRobin(chans.map((c) => byChan.get(c)!.sort((a, b) => a.mjd - b.mjd))));
  }
  return roundRobin(perVisit);
}

/** Middle wavelength (microns) of a band group, for picking the matched-pair channel. */
export function groupMidWavelength(group: BandGroup): number {
  const lo = group.waveMin ?? Math.min(...group.detectors.map((d) => DETECTOR_BANDS[d]?.min ?? Infinity));
  const hi = group.waveMax ?? Math.max(...group.detectors.map((d) => DETECTOR_BANDS[d]?.max ?? -Infinity));
  return (lo + hi) / 2;
}

/** The visit with the most frames among `frames` (ties: the later visit). */
export function visitWithMostFrames(frames: SkyFrame[], visits: Visit[], visitOf: Map<string, number>): Visit | null {
  const counts = new Map<number, number>();
  for (const f of frames) {
    const v = f.meta.visit ?? visitOf.get(f.meta.exposureIds[0] ?? '');
    if (v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: Visit | null = null;
  let bestN = 0;
  for (const v of visits) {
    const n = counts.get(v.index) ?? 0;
    if (n > 0 && n >= bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Symmetric display range for signed (difference) frames: +-the given percentile of |value|. */
export function symmetricRange(frames: SkyFrame[], percentile = 99.5): number {
  const sample: number[] = [];
  let total = 0;
  for (const f of frames) total += f.data.length;
  const stride = Math.max(1, Math.ceil(total / 200000));
  for (const f of frames) for (let i = 0; i < f.data.length; i += stride) if (Number.isFinite(f.data[i])) sample.push(Math.abs(f.data[i]));
  if (!sample.length) return 1;
  sample.sort((a, b) => a - b);
  const v = sample[Math.min(sample.length - 1, Math.floor((percentile / 100) * sample.length))];
  return v > 0 ? v : 1;
}

/**
 * Put an external survey frame (other units) on the same display scale as SPHEREx frames: its sky
 * median maps to 0 and its 99.7th percentile to `hi`. For display only; the note says so.
 */
export function rescaleForDisplay(frame: SkyFrame, hi: number): SkyFrame {
  const vals: number[] = [];
  for (const v of frame.data) if (Number.isFinite(v)) vals.push(v);
  if (!vals.length) return frame;
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  const top = vals[Math.min(vals.length - 1, Math.floor(0.997 * vals.length))];
  const k = top > med ? hi / (top - med) : 1;
  const data = new Float32Array(frame.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Number.isFinite(frame.data[i]) ? (frame.data[i] - med) * k : NaN;
  const notes = [...(frame.meta.notes ?? []), 'older survey, rescaled for display (not MJy/sr)'];
  return { ...frame, data, meta: { ...frame.meta, notes } };
}

export interface NearPreset {
  id: string;
  name: string;
  /** Separation between the typed position and the preset's position at `mjd`, arcsec. */
  offsetArcsec: number;
  /** The preset's position at `mjd`. */
  pos: SkyPos;
}

/**
 * When typed coordinates fall within `radiusArcsec` of a preset target whose position today is more than
 * `minOffsetArcsec` away (a fast mover at old catalogue coordinates), say so.
 */
export function nearbyMovedPreset(
  pos: SkyPos,
  presets: { id: string; name: string; pos: SkyPos; propagated: SkyPos }[],
  radiusArcsec = 300,
  minOffsetArcsec = 20,
): NearPreset | null {
  let best: NearPreset | null = null;
  for (const p of presets) {
    const dNow = angularSepArcsec(pos.ra, pos.dec, p.propagated.ra, p.propagated.dec);
    const dCat = angularSepArcsec(pos.ra, pos.dec, p.pos.ra, p.pos.dec);
    if (Math.min(dNow, dCat) > radiusArcsec) continue;
    if (dNow <= minOffsetArcsec) continue;
    if (!best || dNow < best.offsetArcsec) best = { id: p.id, name: p.name, offsetArcsec: dNow, pos: p.propagated };
  }
  return best;
}

/** MJD of a JavaScript time (default: now). */
export function mjdNow(ms: number = Date.now()): number {
  return ms / 86400000 + 40587;
}

/**
 * Balanced epochs need spectral channels that every date shares. With many visits (some of them partial)
 * the intersection can shrink to nothing, so pick visits greedily: start with the best-covered visit and
 * add the others (best-covered first) while the shared channel set keeps at least `minCommon` channels and
 * at least `keepFraction` of what it had. Returns the chosen visit indices and the ones left out.
 */
export function chooseBalancedVisits(
  channelsByVisit: Map<number, Set<number>>,
  opts: { minCommon?: number; keepFraction?: number; minFrames?: number; framesByVisit?: Map<number, number> } = {},
): { chosen: number[]; leftOut: number[]; common: number[] } {
  const minCommon = opts.minCommon ?? 3;
  const keep = opts.keepFraction ?? 0.3;
  const minFrames = opts.minFrames ?? 4;
  const cand = [...channelsByVisit.entries()]
    .filter(([v, s]) => s.size > 0 && (opts.framesByVisit?.get(v) ?? s.size) >= minFrames)
    .sort((a, b) => b[1].size - a[1].size || a[0] - b[0]);
  if (!cand.length) return { chosen: [], leftOut: [], common: [] };
  let common = new Set(cand[0][1]);
  const chosen = [cand[0][0]];
  const leftOut: number[] = [];
  for (const [v, s] of cand.slice(1)) {
    const inter = new Set([...common].filter((c) => s.has(c)));
    if (inter.size >= minCommon && inter.size >= keep * common.size) {
      common = inter;
      chosen.push(v);
    } else leftOut.push(v);
  }
  return { chosen: chosen.sort((a, b) => a - b), leftOut: leftOut.sort((a, b) => a - b), common: [...common].sort((a, b) => a - b) };
}
