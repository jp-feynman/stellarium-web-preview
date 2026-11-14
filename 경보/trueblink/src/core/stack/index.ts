// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Turning many single-exposure frames into honest sequences.
//
// Why this module exists: SPHEREx looks at the sky through a linear variable filter, so every exposure
// of a given sky position sees it at a different wavelength. During one visit (about two weeks) a
// position is observed in roughly 55-60 exposures, each by one dichroic pair of detectors, which together
// sample all 102 spectral channels once or twice. Six months later the next visit samples them again,
// but not necessarily with the same mix. If we simply stacked "everything from each visit" and blinked
// the stacks, a source with a steep spectrum would appear to brighten or fade only because one visit
// happened to contain more long-wavelength exposures. That is colour, not change.
//
// The cure is "like with like": for each visit we use only the spectral channels that every visit has,
// average the exposures inside each channel first, and then average the channel means with equal weight.
// Every epoch frame then has the same effective bandpass, so any remaining difference is real change
// (or noise), not a different wavelength mix.
//
// All functions here are pure: no network, no DOM. Frames share one SkyGrid. NaN means "no data".

import type { BandGroup, FrameMeta, NativeCutout, SkyFrame, SkyGrid, Visit } from '../types';
import { mjdToIsoDate } from '../types';
import { CHANNELS, channelForWavelength } from '../wave';

export type StackMethod = 'mean' | 'median' | 'sigclip';

/** Clip threshold (in robust sigma) and the minimum number of samples before clipping is attempted. */
const CLIP_SIGMA = 3;
const CLIP_MIN_SAMPLES = 5;
/** Balanced epochs: clip single-channel outliers beyond this many robust sigma, when at least this many channels. */
const CROSS_CHANNEL_SIGMA = 8;
const CROSS_CHANNEL_MIN = 8;
/** Gaussian-equivalent scale of the median absolute deviation. */
const MAD_TO_SIGMA = 1.4826;
/** Fewer common channels than this and a "balanced" sequence is no longer meaningful. */
const MIN_COMMON_CHANNELS = 3;
/**
 * In a balanced epoch frame a pixel is kept only when at least this fraction of the common channels
 * has data there. Missing channels change the effective bandpass at that pixel, so we refuse to
 * pretend when too many are missing.
 */
const MIN_CHANNEL_COVERAGE = 0.75;
/** Frames this many days outside a visit's time span are still assigned to it. */
const VISIT_SLACK_DAYS = 2;
/** Target number of pooled samples for display-range statistics. */
const DISPLAY_SAMPLES = 200_000;
/** Same-channel wavelengths that differ by more than this fraction of the bandwidth get a note. */
const WAVE_SHIFT_NOTE = 0.5;

export const NOTE_MIXED = 'wavelength mix differs between dates';
export const NOTE_SWEEP = 'colour sweep, not time';

// ---------------------------------------------------------------------------------------------------
// Robust statistics

/** Median of the first n entries of a scratch array (sorts them in place). NaN when n = 0. */
function medianInPlace(buf: Float64Array, n: number): number {
  if (n === 0) return NaN;
  const s = buf.subarray(0, n);
  s.sort();
  const h = n >> 1;
  return n % 2 ? s[h] : 0.5 * (s[h - 1] + s[h]);
}

/**
 * Median, median absolute deviation and the equivalent Gaussian sigma (1.4826 MAD) of the finite values.
 * NaN (and +-Infinity) entries are ignored. All three are NaN when there is no finite value.
 */
export function robustStats(data: Float32Array): { median: number; mad: number; sigma: number } {
  const buf = new Float64Array(data.length);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) buf[n++] = v;
  }
  if (n === 0) return { median: NaN, mad: NaN, sigma: NaN };
  const median = medianInPlace(buf, n);
  for (let i = 0; i < n; i++) buf[i] = Math.abs(buf[i] - median);
  const mad = medianInPlace(buf, n);
  return { median, mad, sigma: MAD_TO_SIGMA * mad };
}

/** Percentile (0..100) of an ascending-sorted array with linear interpolation. */
function percentileSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const i = Math.floor(pos);
  const t = pos - i;
  return i + 1 < n ? sorted[i] * (1 - t) + sorted[i + 1] * t : sorted[i];
}

/**
 * Combine k finite samples (vals[0..k)) into one value. Returns the value and how many samples were
 * used (k minus clipped ones). `work` is scratch space of at least k entries.
 */
function combine(vals: Float64Array, k: number, method: StackMethod, work: Float64Array): [number, number] {
  if (k === 0) return [NaN, 0];
  if (method === 'median') {
    for (let i = 0; i < k; i++) work[i] = vals[i];
    return [medianInPlace(work, k), k];
  }
  if (method === 'sigclip' && k >= CLIP_MIN_SAMPLES) {
    // Cosmic-ray hits and other one-off outliers sit far from the median of the other exposures.
    for (let i = 0; i < k; i++) work[i] = vals[i];
    const med = medianInPlace(work, k);
    for (let i = 0; i < k; i++) work[i] = Math.abs(vals[i] - med);
    const sigma = MAD_TO_SIGMA * medianInPlace(work, k);
    const lim = sigma > 0 ? CLIP_SIGMA * sigma : 1e-12 * Math.abs(med);
    let sum = 0;
    let used = 0;
    for (let i = 0; i < k; i++) {
      if (Math.abs(vals[i] - med) <= lim) {
        sum += vals[i];
        used++;
      }
    }
    return used ? [sum / used, used] : [med, k];
  }
  let sum = 0;
  for (let i = 0; i < k; i++) sum += vals[i];
  return [sum / k, k];
}

// ---------------------------------------------------------------------------------------------------
// Small helpers

function sameGrid(a: SkyGrid, b: SkyGrid): boolean {
  return (
    a.n === b.n &&
    Math.abs(a.ra0 - b.ra0) < 1e-9 &&
    Math.abs(a.dec0 - b.dec0) < 1e-9 &&
    Math.abs(a.scaleArcsec - b.scaleArcsec) < 1e-9
  );
}

function assertSameGrid(frames: SkyFrame[], where: string): SkyGrid {
  const grid = frames[0].grid;
  for (const f of frames) {
    if (!sameGrid(grid, f.grid)) {
      throw new Error(`${where}: all frames must share one SkyGrid (reproject them onto the same grid first)`);
    }
    if (f.data.length !== grid.n * grid.n) {
      throw new Error(`${where}: frame "${f.meta.label}" has ${f.data.length} pixels, expected ${grid.n * grid.n}`);
    }
  }
  return grid;
}

function uniqSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/**
 * The single cube channel (1..102) an exposure frame was taken in, or 0 when unknown or when the frame
 * already mixes several channels. Falls back to the nominal channel nearest the frame's wavelength.
 */
export function frameCubeChannel(f: SkyFrame): number {
  const cc = f.meta.cubeChannels;
  if (cc && cc.length) return cc.length === 1 ? cc[0] : 0;
  if (f.meta.detectors.length === 1 && Number.isFinite(f.meta.wavelength)) {
    return channelForWavelength(f.meta.detectors[0], f.meta.wavelength)?.cubeChannel ?? 0;
  }
  return 0;
}

function channelInfo(c: number): { wavelength: number; bandwidth: number } | null {
  const row = CHANNELS.find((r) => r.cubeChannel === c);
  return row ? { wavelength: row.wavelength, bandwidth: row.bandwidth } : null;
}

function fmtUm(x: number, d: number): string {
  return x.toFixed(d);
}

/** "3.8-5.0 um" for a wide span, "4.11-4.14 um" for a narrow one. */
function fmtRange(lo: number, hi: number): string {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '? um';
  const d = hi - lo >= 0.3 ? 1 : 2;
  const a = fmtUm(lo, d);
  const b = fmtUm(hi, d);
  return a === b ? `${a} um` : `${a}-${b} um`;
}

function fmtArrays(dets: number[]): string {
  if (!dets.length) return 'arrays ?';
  return dets.length === 1 ? `array ${dets[0]}` : `arrays ${dets.join('+')}`;
}

function sortedVisits(visits: Visit[]): Visit[] {
  return [...visits].sort((a, b) => a.mjdMid - b.mjdMid);
}

/**
 * Which visit an item belongs to: an explicit index wins, then a listed exposure id, then time
 * (inside the visit's span, with a little slack). Undefined when nothing fits.
 */
function makeVisitFinder(visits: Visit[]) {
  const byId = new Map<string, number>();
  const known = new Set<number>();
  for (const v of visits) {
    known.add(v.index);
    for (const id of v.exposureIds) byId.set(id, v.index);
  }
  return (explicit: number | undefined, ids: string[], mjd: number): number | undefined => {
    if (explicit !== undefined && known.has(explicit)) return explicit;
    for (const id of ids) {
      const v = byId.get(id);
      if (v !== undefined) return v;
    }
    if (!Number.isFinite(mjd)) return undefined;
    let best: number | undefined;
    let bestD = Infinity;
    for (const v of visits) {
      const d = mjd < v.mjdMin ? v.mjdMin - mjd : mjd > v.mjdMax ? mjd - v.mjdMax : 0;
      if (d < bestD) {
        bestD = d;
        best = v.index;
      }
    }
    return bestD <= VISIT_SLACK_DAYS ? best : undefined;
  };
}

function framesByVisit(frames: SkyFrame[], visits: Visit[]): Map<number, SkyFrame[]> {
  const find = makeVisitFinder(visits);
  const out = new Map<number, SkyFrame[]>();
  for (const f of frames) {
    const v = find(f.meta.visit, f.meta.exposureIds, f.meta.mjd);
    if (v === undefined) continue;
    const list = out.get(v);
    if (list) list.push(f);
    else out.set(v, [f]);
  }
  return out;
}

function inGroup(group: BandGroup) {
  return (detectors: number[], wavelength: number): boolean => {
    if (!detectors.length || !detectors.every((d) => group.detectors.includes(d))) return false;
    if (group.waveMin !== undefined && !(wavelength >= group.waveMin)) return false;
    if (group.waveMax !== undefined && !(wavelength <= group.waveMax)) return false;
    return true;
  };
}

/** Cube channels (non-zero) present in every one of the given lists. */
function intersectChannels(lists: number[][]): number[] {
  if (!lists.length) return [];
  let common = new Set(lists[0].filter((c) => c > 0));
  for (const l of lists.slice(1)) {
    const s = new Set(l);
    common = new Set([...common].filter((c) => s.has(c)));
  }
  return [...common].sort((a, b) => a - b);
}

function withNotes(meta: FrameMeta, notes: (string | null | undefined)[]): FrameMeta {
  const all = [...(meta.notes ?? [])];
  for (const n of notes) if (n && !all.includes(n)) all.push(n);
  return { ...meta, notes: all.length ? all : undefined };
}

/** Merge the metadata of frames that are combined into one (stack or difference). */
function mergeMeta(frames: SkyFrame[], kind: FrameMeta['kind']): FrameMeta {
  let mjdSum = 0;
  let mjdN = 0;
  let waveSum = 0;
  let waveN = 0;
  let mjdMin = Infinity;
  let mjdMax = -Infinity;
  let waveMin = Infinity;
  let waveMax = -Infinity;
  let nExp = 0;
  const dets: number[] = [];
  const ids: string[] = [];
  const chans: number[] = [];
  let anyChan = false;
  const notes: string[] = [];
  const visitSet = new Set<number | undefined>();
  for (const f of frames) {
    const m = f.meta;
    if (Number.isFinite(m.mjd)) {
      mjdSum += m.mjd;
      mjdN++;
    }
    if (Number.isFinite(m.wavelength)) {
      waveSum += m.wavelength;
      waveN++;
    }
    mjdMin = Math.min(mjdMin, Number.isFinite(m.mjdMin) ? m.mjdMin : m.mjd);
    mjdMax = Math.max(mjdMax, Number.isFinite(m.mjdMax) ? m.mjdMax : m.mjd);
    waveMin = Math.min(waveMin, Number.isFinite(m.waveMin) ? m.waveMin : m.wavelength);
    waveMax = Math.max(waveMax, Number.isFinite(m.waveMax) ? m.waveMax : m.wavelength);
    nExp += m.nExposures || 0;
    dets.push(...m.detectors);
    ids.push(...m.exposureIds);
    if (m.cubeChannels) {
      anyChan = true;
      chans.push(...m.cubeChannels);
    } else {
      const c = frameCubeChannel(f);
      if (c > 0) {
        anyChan = true;
        chans.push(c);
      }
    }
    for (const n of m.notes ?? []) if (!notes.includes(n)) notes.push(n);
    visitSet.add(m.visit);
  }
  const visit = visitSet.size === 1 ? [...visitSet][0] : undefined;
  return {
    kind,
    label: '',
    mjd: mjdN ? mjdSum / mjdN : NaN,
    mjdMin: Number.isFinite(mjdMin) ? mjdMin : NaN,
    mjdMax: Number.isFinite(mjdMax) ? mjdMax : NaN,
    wavelength: waveN ? waveSum / waveN : NaN,
    waveMin: Number.isFinite(waveMin) ? waveMin : NaN,
    waveMax: Number.isFinite(waveMax) ? waveMax : NaN,
    detectors: uniqSorted(dets),
    nExposures: nExp,
    exposureIds: [...new Set(ids)],
    ...(visit !== undefined ? { visit } : {}),
    ...(anyChan ? { cubeChannels: uniqSorted(chans) } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function defaultStackLabel(m: FrameMeta, date?: string): string {
  const d = date ?? (Number.isFinite(m.mjd) ? mjdToIsoDate(m.mjd) : '?');
  return `${d} · ${fmtArrays(m.detectors)} · ${fmtRange(m.waveMin, m.waveMax)} · ${m.nExposures} exp`;
}

// ---------------------------------------------------------------------------------------------------
// Stacking

/**
 * Per-pixel combination of frames on one grid. NaN samples are ignored. 'sigclip' (the default) is
 * the mean after rejecting values more than 3 robust sigma from the median, applied only where at least
 * 5 samples exist (with fewer it is the plain mean). The output weight is the fraction of the input
 * frames that contributed to each pixel.
 */
export function stackFrames(frames: SkyFrame[], opts: { method?: StackMethod; label?: string } = {}): SkyFrame {
  if (!frames.length) throw new Error('stackFrames: no frames to stack');
  const grid = assertSameGrid(frames, 'stackFrames');
  const method = opts.method ?? 'sigclip';
  const nf = frames.length;
  const npix = grid.n * grid.n;
  const data = new Float32Array(npix);
  const weight = new Float32Array(npix);
  const vals = new Float64Array(nf);
  const work = new Float64Array(nf);
  const arrays = frames.map((f) => f.data);
  for (let p = 0; p < npix; p++) {
    let k = 0;
    for (let f = 0; f < nf; f++) {
      const v = arrays[f][p];
      if (Number.isFinite(v)) vals[k++] = v;
    }
    const [value, used] = combine(vals, k, method, work);
    data[p] = value;
    weight[p] = used / nf;
  }
  const meta = mergeMeta(frames, 'stack');
  meta.label = opts.label ?? defaultStackLabel(meta);
  return { grid, data, weight, meta };
}

// ---------------------------------------------------------------------------------------------------
// Epoch sequences (one frame per visit)

interface VisitBucket {
  visit: Visit;
  frames: SkyFrame[];
}

/**
 * One frame per visit for a band group. Balanced (default): only spectral channels present in every
 * visit are used, frames are averaged within each channel and the channel means are averaged with equal
 * weight, so every date has the same effective bandpass. Visits with fewer than `minExposures` frames
 * (default 4) are dropped and named in a note. Unbalanced: a plain stack of each visit's frames,
 * flagged with a warning that the wavelength mix differs between dates.
 */
export function buildEpochSequence(
  frames: SkyFrame[],
  visits: Visit[],
  group: BandGroup,
  opts: { balanced?: boolean; method?: StackMethod; minExposures?: number } = {},
): SkyFrame[] {
  const balanced = opts.balanced ?? true;
  const method = opts.method ?? 'sigclip';
  const minExp = Math.max(1, opts.minExposures ?? 4);
  const ok = inGroup(group);
  const selected = frames.filter((f) => ok(f.meta.detectors, f.meta.wavelength));
  if (!selected.length) return [];
  assertSameGrid(selected, 'buildEpochSequence');

  const byVisit = framesByVisit(selected, visits);
  const buckets: VisitBucket[] = sortedVisits(visits)
    .filter((v) => (byVisit.get(v.index)?.length ?? 0) > 0)
    .map((v) => ({ visit: v, frames: byVisit.get(v.index)! }));
  if (!buckets.length) return [];

  let kept = buckets.filter((b) => b.frames.length >= minExp);
  const dropped = buckets.filter((b) => b.frames.length < minExp);
  const commonNotes: string[] = [];
  if (!kept.length) {
    kept = buckets;
    commonNotes.push(`fewer than ${minExp} exposures on every date`);
  } else if (dropped.length) {
    commonNotes.push(
      `dropped ${dropped.map((b) => `${b.visit.label} (${b.frames.length} exp)`).join(', ')}: fewer than ${minExp} exposures`,
    );
  }

  const plain = (extra: string[]): SkyFrame[] =>
    kept.map((b) => {
      const s = stackFrames(b.frames, { method });
      const meta = withNotes({ ...s.meta, visit: b.visit.index }, [...commonNotes, ...extra]);
      meta.label = defaultStackLabel(meta, b.visit.label);
      return { ...s, meta };
    });

  if (!balanced) return plain([NOTE_MIXED]);

  const common = intersectChannels(kept.map((b) => b.frames.map(frameCubeChannel)));
  if (common.length < MIN_COMMON_CHANNELS) {
    return plain([NOTE_MIXED, `only ${common.length} spectral channel${common.length === 1 ? '' : 's'} in common`]);
  }

  const commonSet = new Set(common);
  const used = kept.flatMap((b) => b.frames.filter((f) => commonSet.has(frameCubeChannel(f))));
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of used) {
    lo = Math.min(lo, Number.isFinite(f.meta.waveMin) ? f.meta.waveMin : f.meta.wavelength);
    hi = Math.max(hi, Number.isFinite(f.meta.waveMax) ? f.meta.waveMax : f.meta.wavelength);
  }
  const likeNote = `like-with-like: ${common.length} common channels, ${lo.toFixed(2)}-${hi.toFixed(2)} um`;

  const out = kept.map((b) => balancedEpoch(b, common, method));
  // Effective wavelengths should agree; the year-2 half-channel shift can move them a little.
  const effs = out.map((f) => f.meta.wavelength).sort((a, b) => a - b);
  const effMed = effs[effs.length >> 1];
  return out.map((f, i) => {
    const b = kept[i];
    const extra: string[] = [likeNote];
    if (f.meta.nExposures < b.frames.length) {
      extra.push(`used ${f.meta.nExposures} of ${b.frames.length} exposures (channels shared by all dates)`);
    }
    const dw = f.meta.wavelength - effMed;
    if (Math.abs(dw) > 0.005 * effMed) {
      extra.push(`effective wavelength ${dw > 0 ? '+' : ''}${dw.toFixed(3)} um from the other dates`);
    }
    const meta = withNotes(f.meta, [...commonNotes, ...extra]);
    meta.label = defaultStackLabel(meta, b.visit.label);
    return { ...f, meta };
  });
}

/** Equal-weight average of per-channel means for one visit. */
function balancedEpoch(b: VisitBucket, common: number[], method: StackMethod): SkyFrame {
  const perChannel: SkyFrame[] = [];
  const contributing: SkyFrame[] = [];
  for (const c of common) {
    const fs = b.frames.filter((f) => frameCubeChannel(f) === c);
    contributing.push(...fs);
    perChannel.push(stackFrames(fs, { method }));
  }
  const grid = perChannel[0].grid;
  const npix = grid.n * grid.n;
  const nc = perChannel.length;
  const data = new Float32Array(npix);
  const weight = new Float32Array(npix);
  const need = Math.ceil(MIN_CHANNEL_COVERAGE * nc);
  const vals = new Float64Array(nc);
  const work = new Float64Array(nc);
  for (let p = 0; p < npix; p++) {
    let sum = 0;
    let k = 0;
    for (let c = 0; c < nc; c++) {
      const v = perChannel[c].data[p];
      if (Number.isFinite(v)) {
        vals[k] = v;
        sum += v;
        k++;
      }
    }
    // Most channels hold one or two exposures, so a cosmic-ray hit or a one-exposure artefact survives
    // the per-channel stack and would show as a "new source" in one epoch. Drop single channels that sit
    // far outside the spread of the others (a real spectrum varies smoothly, so its spread is wide).
    if (k >= CROSS_CHANNEL_MIN) {
      for (let i = 0; i < k; i++) work[i] = vals[i];
      const med = medianInPlace(work, k);
      for (let i = 0; i < k; i++) work[i] = Math.abs(vals[i] - med);
      const lim = CROSS_CHANNEL_SIGMA * MAD_TO_SIGMA * medianInPlace(work, k);
      if (lim > 0) {
        let s2 = 0;
        let k2 = 0;
        for (let i = 0; i < k; i++) {
          if (Math.abs(vals[i] - med) <= lim) {
            s2 += vals[i];
            k2++;
          }
        }
        if (k2 >= k - Math.max(1, Math.floor(k / 10))) {
          sum = (s2 * k) / k2; // keep the per-pixel channel count (and so the weight) unchanged
        }
      }
    }
    if (k >= need && k > 0) {
      data[p] = sum / k;
      weight[p] = k / nc;
    } else {
      data[p] = NaN;
      weight[p] = 0;
    }
  }
  const meta = mergeMeta(contributing, 'stack');
  // Each channel counts once, however many exposures it had: the effective wavelength is the plain
  // mean of the channel wavelengths, identical for every visit that shares the same channels.
  let wsum = 0;
  for (const s of perChannel) wsum += s.meta.wavelength;
  meta.wavelength = wsum / nc;
  meta.cubeChannels = [...common];
  meta.visit = b.visit.index;
  return { grid, data, weight, meta };
}

// ---------------------------------------------------------------------------------------------------
// Colour sweep and matched pairs

/**
 * The frames of one visit ordered by wavelength. This shows a spectrum, not a change over time, and
 * every frame says so.
 */
export function buildSweepSequence(frames: SkyFrame[], visit: Visit): SkyFrame[] {
  const byVisit = framesByVisit(frames, [visit]);
  const fs = [...(byVisit.get(visit.index) ?? [])].sort((a, b) => a.meta.wavelength - b.meta.wavelength);
  return fs.map((f) => {
    const m = f.meta;
    const c = frameCubeChannel(f);
    const label = `${m.wavelength.toFixed(3)} um · ${fmtArrays(m.detectors)}${c ? ` · ch ${c}` : ''} · ${visit.label} (${NOTE_SWEEP})`;
    return { ...f, meta: withNotes({ ...m, visit: visit.index, label }, [NOTE_SWEEP]) };
  });
}

/** Mean wavelength per visit of the frames in one cube channel. */
function channelWavelengths(byVisit: Map<number, SkyFrame[]>, c: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [v, fs] of byVisit) {
    const sel = fs.filter((f) => frameCubeChannel(f) === c && Number.isFinite(f.meta.wavelength));
    if (sel.length) out.set(v, sel.reduce((s, f) => s + f.meta.wavelength, 0) / sel.length);
  }
  return out;
}

/**
 * One frame per visit for a single cube channel: the stack of that channel's exposures within the
 * visit. This is the cleanest time comparison SPHEREx offers (same filter strip, same wavelength).
 */
export function buildMatchedPairs(frames: SkyFrame[], visits: Visit[], cubeChannel: number): SkyFrame[] {
  const sel = frames.filter((f) => frameCubeChannel(f) === cubeChannel);
  if (!sel.length) return [];
  assertSameGrid(sel, 'buildMatchedPairs');
  const byVisit = framesByVisit(sel, visits);
  const info = channelInfo(cubeChannel);
  const out: SkyFrame[] = [];
  let refWave: number | undefined;
  for (const v of sortedVisits(visits)) {
    const fs = byVisit.get(v.index);
    if (!fs?.length) continue;
    const s = stackFrames(fs, { method: 'sigclip' });
    const notes: string[] = [];
    if (refWave === undefined) refWave = s.meta.wavelength;
    else if (info && Math.abs(s.meta.wavelength - refWave) > WAVE_SHIFT_NOTE * info.bandwidth) {
      const dw = s.meta.wavelength - refWave;
      notes.push(`wavelength ${dw > 0 ? '+' : ''}${dw.toFixed(3)} um from the first date (half a channel or more)`);
    }
    const meta = withNotes({ ...s.meta, visit: v.index, cubeChannels: [cubeChannel] }, notes);
    meta.label = `${v.label} · channel ${cubeChannel} · ${s.meta.wavelength.toFixed(3)} um · ${s.meta.nExposures} exp`;
    out.push({ ...s, meta });
  }
  return out;
}

/**
 * The cube channel nearest to `wavelength` (microns) that has at least one frame in every visit that
 * has any frames at all. Null when no channel is shared by all of them.
 */
export function nearestChannelWithAllVisits(frames: SkyFrame[], visits: Visit[], wavelength: number): number | null {
  const byVisit = framesByVisit(frames, visits);
  const lists = [...byVisit.values()].filter((l) => l.length).map((l) => l.map(frameCubeChannel));
  const common = intersectChannels(lists);
  let best: number | null = null;
  let bestD = Infinity;
  for (const c of common) {
    const w = channelInfo(c)?.wavelength;
    if (w === undefined) continue;
    const d = Math.abs(w - wavelength);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Fallback for nearestChannelWithAllVisits when no channel is shared by every visit (short extra
 * visits of a few exposures): the channel seen in the most visits (at least two), nearest to
 * `wavelength` among those. Null when no channel is seen twice.
 */
export function nearestChannelWithMostVisits(frames: SkyFrame[], visits: Visit[], wavelength: number): number | null {
  const byVisit = framesByVisit(frames, visits);
  const count = new Map<number, number>();
  for (const list of byVisit.values()) {
    for (const c of new Set(list.map(frameCubeChannel))) if (c > 0) count.set(c, (count.get(c) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 1;
  let bestD = Infinity;
  for (const [c, n] of count) {
    const w = channelInfo(c)?.wavelength;
    if (w === undefined) continue;
    const d = Math.abs(w - wavelength);
    if (n > bestN || (n === bestN && best !== null && d < bestD)) {
      best = c;
      bestN = n;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------
// Differences and display range

/**
 * a - b where both frames have data (NaN elsewhere). The notes carry both labels and a warning when the
 * two frames were built from different spectral channels, because then the difference mixes colour
 * with change.
 */
export function differenceFrame(a: SkyFrame, b: SkyFrame, label?: string): SkyFrame {
  const grid = assertSameGrid([a, b], 'differenceFrame');
  const npix = grid.n * grid.n;
  const data = new Float32Array(npix);
  const weight = new Float32Array(npix);
  for (let p = 0; p < npix; p++) {
    const va = a.data[p];
    const vb = b.data[p];
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      data[p] = va - vb;
      const wa = a.weight ? a.weight[p] : 1;
      const wb = b.weight ? b.weight[p] : 1;
      weight[p] = Math.min(wa, wb);
    } else {
      data[p] = NaN;
      weight[p] = 0;
    }
  }
  const meta = mergeMeta([a, b], 'difference');
  delete meta.visit;
  const notes = [`A: ${a.meta.label}`, `B: ${b.meta.label}`];
  const ca = a.meta.cubeChannels;
  const cb = b.meta.cubeChannels;
  if (!ca || !cb) {
    notes.push('spectral channels of A or B unknown: the difference may mix colour with change');
  } else {
    const sa = uniqSorted(ca).join(',');
    const sb = uniqSorted(cb).join(',');
    if (sa !== sb) notes.push('A and B use different spectral channels: the difference mixes colour with change');
  }
  meta.notes = notes;
  meta.label = label ?? 'A minus B';
  return { grid, data, weight, meta };
}

/**
 * One display range for a whole sequence (never per frame, or a fading source would look constant).
 * lo = median - 1 sigma of the pooled pixels (the sky background dominates them), hi = the 99.7th
 * percentile of pooled finite values. Pass loPercentile to use a percentile for lo instead.
 * Always returns finite lo < hi, even for all-NaN input.
 */
export function displayRange(
  frames: SkyFrame[],
  opts: { loPercentile?: number; hiPercentile?: number } = {},
): { lo: number; hi: number } {
  const hiP = opts.hiPercentile ?? 99.7;
  let total = 0;
  for (const f of frames) total += f.data.length;
  // The same stride inside every frame keeps the sample independent of frame order.
  const stride = Math.max(1, Math.ceil(total / DISPLAY_SAMPLES));
  const sample: number[] = [];
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += stride) {
      const v = d[i];
      if (Number.isFinite(v)) sample.push(v);
    }
  }
  if (!sample.length) return { lo: 0, hi: 1 };
  const sorted = Float64Array.from(sample).sort();
  const st = robustStats(Float32Array.from(sample));
  let lo = opts.loPercentile !== undefined ? percentileSorted(sorted, opts.loPercentile) : st.median - st.sigma;
  let hi = percentileSorted(sorted, hiP);
  if (!Number.isFinite(lo)) lo = sorted[0];
  if (!Number.isFinite(hi)) hi = sorted[sorted.length - 1];
  if (!(hi > lo)) {
    const span = st.sigma > 0 ? st.sigma : Math.abs(lo) * 0.1 || 1;
    hi = lo + span;
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------------------
// Working on native cutouts and coverage summaries

/**
 * Pick, per visit, the native cutouts whose cube channel is shared by every visit (visits with fewer
 * than `minExposures` cutouts of the group, default 4, are left out). `tolerance` (default 0.5, in
 * units of the channel bandwidth) drops a channel when its mean wavelength in some visit differs from
 * the all-visit mean by more than that, as can happen with the half-channel shift of the second year.
 */
export function selectBalanced(
  cutouts: NativeCutout[],
  visits: Visit[],
  group: BandGroup,
  opts: { tolerance?: number; minExposures?: number } = {},
): { byVisit: Map<number, NativeCutout[]>; commonChannels: number[] } {
  const tol = opts.tolerance ?? 0.5;
  const minExp = Math.max(1, opts.minExposures ?? 4);
  const ok = inGroup(group);
  const find = makeVisitFinder(visits);
  const all = new Map<number, NativeCutout[]>();
  for (const c of cutouts) {
    if (!ok([c.exposure.detector], c.wavelength)) continue;
    const mjd = Number.isFinite(c.header?.mjdAvg) ? c.header.mjdAvg : c.exposure.mjd;
    const v = find(undefined, [c.exposure.id], mjd);
    if (v === undefined) continue;
    const l = all.get(v);
    if (l) l.push(c);
    else all.set(v, [c]);
  }
  const kept = [...all.entries()].filter(([, l]) => l.length >= minExp);
  let common = intersectChannels(kept.map(([, l]) => l.map((c) => c.cubeChannel)));
  common = common.filter((ch) => {
    const means = kept.map(([, l]) => {
      const s = l.filter((c) => c.cubeChannel === ch);
      return s.reduce((a, c) => a + c.wavelength, 0) / s.length;
    });
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    const bw = channelInfo(ch)?.bandwidth ?? Math.max(...kept.flatMap(([, l]) => l.filter((c) => c.cubeChannel === ch).map((c) => c.bandwidth)));
    return means.every((m) => Math.abs(m - mean) <= tol * bw);
  });
  const set = new Set(common);
  const byVisit = new Map<number, NativeCutout[]>();
  for (const v of sortedVisits(visits)) {
    const l = kept.find(([idx]) => idx === v.index);
    if (l) byVisit.set(v.index, l[1].filter((c) => set.has(c.cubeChannel)));
  }
  return { byVisit, commonChannels: common };
}

/** Per-visit spectral coverage for the UI chart. `channels` and `counts` are parallel arrays. */
export interface CoverageRow {
  visit: number;
  label: string;
  mjdMid: number;
  nFrames: number;
  channels: number[];
  counts: number[];
}

/**
 * For every visit (in time order): which cube channels have frames and how many. Frames without a
 * known single channel are counted in nFrames but not in the channel lists.
 */
export function summarizeCoverage(frames: SkyFrame[], visits: Visit[]): CoverageRow[] {
  const byVisit = framesByVisit(frames, visits);
  return sortedVisits(visits).map((v) => {
    const fs = byVisit.get(v.index) ?? [];
    const counts = new Map<number, number>();
    for (const f of fs) {
      const c = frameCubeChannel(f);
      if (c > 0) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const channels = [...counts.keys()].sort((a, b) => a - b);
    return {
      visit: v.index,
      label: v.label,
      mjdMid: v.mjdMid,
      nFrames: fs.length,
      channels,
      counts: channels.map((c) => counts.get(c)!),
    };
  });
}
