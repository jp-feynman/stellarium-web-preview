// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// MockPipeline: fills the store with SYNTHETIC frames so every screen can be judged before the real
// data pipeline is wired in. Visit dates and exposure counts follow the real archive (IRSA SIA,
// 2026-11-14, tests/fixtures/targets.json); positions use real catalogue proper motions; the pixels,
// photometry and findings are made up and the UI says so (store.demo = true).
import {
  BAND_GROUPS,
  DETECTOR_BANDS,
  mjdToIsoDate,
  mjdToJyear,
  type DetectorId,
  type Exposure,
  type FrameMeta,
  type Overlay,
  type PhotPoint,
  type SkyFrame,
  type SkyGrid,
  type SkyPos,
  type Stretch,
  type TargetInfo,
  type Visit,
} from '../core/types';
import { skyToGridPix } from '../core/wcs';
import { findPreset, PRESETS, type PresetId } from './presets';
import { sharedRange } from './render2d';
import type { AppPipeline } from './seams';
import { useApp, type Finding } from './store';

// ------------------------------------------------------------------ tiny deterministic random numbers

function hashString(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

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

const g = (x: number, mu: number, w: number) => Math.exp(-0.5 * ((x - mu) / w) ** 2);

// ------------------------------------------------------------------ visit tables (real dates, MJD UTC)

interface VisitDef {
  mjdMin: number;
  mjdMax: number;
  n: number;
}

function deepVisits(): VisitDef[] {
  // R Draconis sits in the north deep field: monthly groups, about 1,640 exposures in all.
  const out: VisitDef[] = [];
  for (let k = 0; k < 10; k++) {
    const m = 60812 + k * 47;
    out.push({ mjdMin: m, mjdMax: m + 6, n: 160 + ((k * 7) % 11) });
  }
  return out;
}

const VISIT_TABLE: Record<PresetId, VisitDef[]> = {
  barnard: [
    { mjdMin: 60902.865, mjdMax: 60923.107, n: 108 },
    { mjdMin: 61110.091, mjdMax: 61140.03, n: 113 },
    { mjdMin: 61268.631, mjdMax: 61285.257, n: 117 },
  ],
  epsIndB: [
    { mjdMin: 60789.856, mjdMax: 60836.19, n: 122 },
    { mjdMin: 60946.964, mjdMax: 60991.858, n: 146 },
    { mjdMin: 61148.845, mjdMax: 61164.117, n: 75 },
    { mjdMin: 61305.227, mjdMax: 61315.478, n: 120 },
  ],
  wise0855: [
    { mjdMin: 60800.7, mjdMax: 60801.519, n: 30 },
    { mjdMin: 60979.723, mjdMax: 60993.913, n: 110 },
    { mjdMin: 61151.198, mjdMax: 61174.287, n: 100 },
  ],
  rwaur: [
    { mjdMin: 60919.42, mjdMax: 60938.232, n: 112 },
    { mjdMin: 61091.72, mjdMax: 61111.002, n: 114 },
    { mjdMin: 61285.097, mjdMax: 61299.896, n: 110 },
  ],
  rdra: deepVisits(),
};

const GENERIC_VISITS: VisitDef[] = [
  { mjdMin: 60900, mjdMax: 60914, n: 112 },
  { mjdMin: 61085, mjdMax: 61099, n: 110 },
  { mjdMin: 61268, mjdMax: 61281, n: 108 },
];

// ------------------------------------------------------------------ synthetic scene

interface Source {
  name?: string;
  ra: number;
  dec: number;
  /** Julian year of ra/dec. */
  epoch: number;
  pmRa: number;
  pmDec: number;
  /** Peak surface brightness (MJy/sr) as a function of wavelength (microns). */
  sed: (um: number) => number;
  /** Brightness factor as a function of MJD (variables). */
  vary?: (mjd: number) => number;
  /** Peak above which the detector overflows: those pixels become NaN (saturated core). */
  saturate?: number;
  role: 'target' | 'field' | 'neighbour';
}

export interface Scene {
  key: string;
  presetId: PresetId | null;
  target: TargetInfo | null;
  center: SkyPos;
  sources: Source[];
  visits: Visit[];
  exposures: Exposure[];
  /** Wavelength at the target for each exposure id. */
  expWave: Map<string, number>;
}

const SAT = 600;
const PSF_FWHM_ARCSEC = 8;
const GRID_SCALE = 3.075;
const NOISE_1EXP = 0.08;
const NOISE_FLOOR = 0.02;

function sourcePos(s: Source, mjd: number): SkyPos {
  const dt = mjdToJyear(mjd) - s.epoch;
  const dec = s.dec + (s.pmDec * dt) / 3.6e6;
  const ra = s.ra + (s.pmRa * dt) / 3.6e6 / Math.cos((s.dec * Math.PI) / 180);
  return { ra: ((ra % 360) + 360) % 360, dec };
}

function targetSources(id: PresetId | null, t: TargetInfo | null): Source[] {
  if (!t || !id) return [];
  const base = { ra: t.ra, dec: t.dec, epoch: t.epoch, pmRa: t.pmRa ?? 0, pmDec: t.pmDec ?? 0, role: 'target' as const, name: t.name };
  switch (id) {
    case 'barnard':
      // Red dwarf: peaks near 1.2 um, saturates the detector at every wavelength.
      return [{ ...base, sed: (l) => 8000 * (l < 1.2 ? l / 1.2 : (1.2 / l) ** 1.5), saturate: SAT }];
    case 'epsIndB':
      // T dwarfs: bright near 1.25 um and 4.3 um, methane absorption in between.
      return [{ ...base, sed: (l) => 4 * g(l, 1.25, 0.15) + 3 * g(l, 1.6, 0.1) + 1.5 * g(l, 2.1, 0.12) + 8 * g(l, 4.3, 0.5) + 0.3 }];
    case 'wise0855':
      // About 250 K: practically nothing short of 3.8 um. Plus the real G = 16.3 Gaia star it is passing.
      return [
        { ...base, sed: (l) => (l > 3.8 ? 0.45 * g(l, 4.6, 0.45) : 0.004) },
        {
          name: 'Gaia DR3 5756956644387831296',
          ra: 133.75818,
          dec: -7.24116,
          epoch: 2016,
          pmRa: 0,
          pmDec: 0,
          role: 'neighbour',
          sed: (l) => 0.9 * (l < 1.2 ? 1 : (1.2 / l) ** 2),
        },
      ];
    case 'rwaur':
      // Young star with a warm disk; demo fade (the real data: about half as bright at 4-5 um, brighter at short wavelengths).
      return [
        {
          ...base,
          sed: (l) => 150 * (l < 1.2 ? l / 1.2 : 1.2 / l) + 120 * Math.min(1, l / 3),
          vary: (m) => 1 - 0.5 * Math.min(1, Math.max(0, (m - 60929) / (61292 - 60929))),
        },
      ];
    case 'rdra':
      // Mira variable, period about 245 days; very bright and saturated.
      return [
        {
          ...base,
          sed: (l) => 20000 * (l < 1.6 ? l / 1.6 : (1.6 / l) ** 1.5),
          vary: (m) => 1 + 0.5 * Math.sin((2 * Math.PI * (m - 60850)) / 245),
          saturate: SAT,
        },
      ];
  }
}

function fieldStars(seedKey: string, center: SkyPos, fovArcsec: number): Source[] {
  const r = rng(hashString(seedKey));
  const half = (fovArcsec * 0.65) / 3600;
  const cosd = Math.cos((center.dec * Math.PI) / 180);
  const out: Source[] = [];
  const count = Math.round(28 + (fovArcsec / 180) ** 2 * 22);
  for (let k = 0; k < count; k++) {
    const amp = 0.08 * Math.exp(r() * Math.log(80));
    const peak = 0.8 + r() * 0.9;
    out.push({
      ra: center.ra + ((r() * 2 - 1) * half) / cosd,
      dec: center.dec + (r() * 2 - 1) * half,
      epoch: 2016,
      pmRa: 0,
      pmDec: 0,
      role: 'field',
      sed: (l) => amp * (l < peak ? l / peak : (peak / l) ** 2),
    });
  }
  return out;
}

function makeExposures(defs: VisitDef[], key: string, deep: boolean): { visits: Visit[]; exposures: Exposure[]; expWave: Map<string, number> } {
  const r = rng(hashString(`${key}:exp`));
  const dets: DetectorId[] = [1, 4, 2, 5, 3, 6];
  const visits: Visit[] = [];
  const exposures: Exposure[] = [];
  const expWave = new Map<string, number>();
  defs.forEach((d, vi) => {
    const ids: string[] = [];
    for (let k = 0; k < d.n; k++) {
      const det = dets[k % 6];
      const mjd = d.mjdMin + ((d.mjdMax - d.mjdMin) * k) / Math.max(1, d.n - 1);
      const obsId = `MOCK_V${vi + 1}_${String(Math.floor(k / 2)).padStart(4, '0')}`;
      const id = `${obsId}D${det}`;
      const band = DETECTOR_BANDS[det];
      const release = mjd >= 61176 ? 'qr3' : 'dr1';
      exposures.push({
        id,
        obsId,
        detector: det,
        collection: `spherex_${release}${deep ? '_deep' : ''}`,
        release,
        mjdStart: mjd - 0.00066,
        mjdEnd: mjd + 0.00066,
        mjd,
        url: '',
        s3Key: `mock/${release}/${id}.fits`,
        sRa: 0,
        sDec: 0,
        sRegion: [],
        emMin: band.min,
        emMax: band.max,
        pipelineTag: 'mock',
      });
      expWave.set(id, band.min + (band.max - band.min) * r());
      ids.push(id);
    }
    const mid = (d.mjdMin + d.mjdMax) / 2;
    visits.push({ index: vi, mjdMin: d.mjdMin, mjdMax: d.mjdMax, mjdMid: mid, exposureIds: ids, label: mjdToIsoDate(mid) });
  });
  return { visits, exposures, expWave };
}

export function buildScene(input: { name?: string; ra?: number; dec?: number }, fovArcsec: number): Scene | null {
  const preset = input.name ? findPreset(input.name) : null;
  if (input.name && !preset && (input.ra === undefined || input.dec === undefined)) return null;
  const target = preset ? preset.target : null;
  const defs = preset ? VISIT_TABLE[preset.id] : GENERIC_VISITS;
  const key = preset ? preset.id : `${input.ra?.toFixed(3)},${input.dec?.toFixed(3)}`;
  const { visits, exposures, expWave } = makeExposures(defs, key, preset?.id === 'rdra');
  const midMjd = (visits[0].mjdMid + visits[visits.length - 1].mjdMid) / 2;
  const tSources = targetSources(preset?.id ?? null, target);
  const center = tSources.length > 0 ? sourcePos(tSources[0], midMjd) : { ra: input.ra ?? 0, dec: input.dec ?? 0 };
  const sources = [...tSources, ...fieldStars(key, center, Math.max(fovArcsec, 180))];
  return { key, presetId: preset?.id ?? null, target, center, sources, visits, exposures, expWave };
}

// ------------------------------------------------------------------ frames

function makeGrid(center: SkyPos, fovArcsec: number): SkyGrid {
  const n = Math.max(16, Math.min(256, Math.round(fovArcsec / GRID_SCALE)));
  return { ra0: center.ra, dec0: center.dec, n, scaleArcsec: GRID_SCALE };
}

/** Wavelengths (microns) sampled for a band group: six per detector across its range. */
function groupWavelengths(groupId: string): number[] {
  const grp = BAND_GROUPS.find((b) => b.id === groupId) ?? BAND_GROUPS[0];
  const out: number[] = [];
  for (const d of grp.detectors) {
    const b = DETECTOR_BANDS[d];
    for (let k = 0; k < 6; k++) out.push(b.min + ((b.max - b.min) * (k + 0.5)) / 6);
  }
  return out;
}

interface RenderOpts {
  mjd: number;
  waves: number[];
  nExp: number;
  seed: string;
  /** Fraction of the east side with no data (frame edge). */
  edge?: number;
  cosmic?: boolean;
  streak?: boolean;
}

function renderSky(scene: Scene, grid: SkyGrid, o: RenderOpts): Float32Array {
  const n = grid.n;
  const data = new Float32Array(n * n);
  const sat = new Uint8Array(n * n);
  const r = rng(hashString(o.seed));
  const sigma = Math.sqrt(NOISE_1EXP ** 2 / Math.max(1, o.nExp) + NOISE_FLOOR ** 2);
  for (let k = 0; k < data.length; k++) data[k] = sigma * gauss(r);
  const psf = PSF_FWHM_ARCSEC / 2.3548 / grid.scaleArcsec;
  const rad = Math.ceil(psf * 5);
  for (const s of scene.sources) {
    const p = sourcePos(s, o.mjd);
    const [ci, cj] = skyToGridPix(grid, p.ra, p.dec);
    if (ci < -rad || cj < -rad || ci > n + rad || cj > n + rad) continue;
    let peak = 0;
    for (const w of o.waves) peak += s.sed(w);
    peak = (peak / o.waves.length) * (s.vary ? s.vary(o.mjd) : 1);
    // Saturation happens per exposure; the brightest single-wavelength peak decides it.
    const maxPeak = s.saturate ? Math.max(...o.waves.map((w) => s.sed(w))) * (s.vary ? s.vary(o.mjd) : 1) : 0;
    for (let j = Math.max(0, Math.floor(cj - rad)); j <= Math.min(n - 1, Math.ceil(cj + rad)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rad)); i <= Math.min(n - 1, Math.ceil(ci + rad)); i++) {
        const prof = Math.exp(-((i - ci) ** 2 + (j - cj) ** 2) / (2 * psf * psf));
        data[j * n + i] += peak * prof;
        if (s.saturate && maxPeak * prof > s.saturate) sat[j * n + i] = 1;
      }
    }
  }
  if (o.cosmic) {
    const ci = Math.floor(n * (0.2 + 0.6 * r()));
    const cj = Math.floor(n * (0.2 + 0.6 * r()));
    data[cj * n + ci] += 40;
    if (ci + 1 < n) data[cj * n + ci + 1] += 12;
  }
  if (o.streak) {
    // A satellite crossing: a straight line through the field.
    const a = 0.35 + 0.4 * r();
    for (let i = 0; i < n; i++) {
      const j = Math.round(n * 0.15 + i * a);
      if (j >= 0 && j < n) data[j * n + i] += 1.2;
    }
  }
  for (let k = 0; k < data.length; k++) if (sat[k]) data[k] = NaN;
  if (o.edge) {
    const cut = Math.floor(n * o.edge);
    for (let j = 0; j < n; j++) for (let i = 0; i < cut; i++) data[j * n + i] = NaN;
  }
  return data;
}

function fmtWave(a: number, b: number): string {
  return Math.abs(a - b) < 0.005 ? `${a.toFixed(2)} um` : `${a.toFixed(2)}-${b.toFixed(2)} um`;
}

function meta(p: Omit<FrameMeta, 'label'> & { label?: string }): FrameMeta {
  const d0 = mjdToIsoDate(p.mjdMin);
  const d1 = mjdToIsoDate(p.mjdMax);
  const date = d0 === d1 ? d0 : `${d0} to ${d1}`;
  return { ...p, label: p.label ?? `${date} · ${fmtWave(p.waveMin, p.waveMax)} · ${p.nExposures} exp` };
}

function satNotes(scene: Scene): string[] {
  return scene.sources.some((s) => s.role === 'target' && s.saturate) ? ['saturated core (blank pixels)'] : [];
}

function visitExposures(scene: Scene, v: Visit, detectors: number[]): Exposure[] {
  const ids = new Set(v.exposureIds);
  return scene.exposures.filter((e) => ids.has(e.id) && detectors.includes(e.detector));
}

function epochFrame(scene: Scene, grid: SkyGrid, v: Visit, groupId: string, balanced: boolean): SkyFrame {
  const grp = BAND_GROUPS.find((b) => b.id === groupId) ?? BAND_GROUPS[0];
  let waves = groupWavelengths(groupId);
  const notes = [...satNotes(scene)];
  if (!balanced) {
    // Without balancing each visit keeps whatever channels it happened to get.
    const r = rng(hashString(`${scene.key}:unbal:${v.index}`));
    waves = waves.filter(() => r() > 0.3);
    if (waves.length === 0) waves = groupWavelengths(groupId).slice(0, 1);
    notes.push('wavelength mix differs between frames');
  }
  const exps = visitExposures(scene, v, grp.detectors);
  const edge = scene.presetId === 'wise0855' && v.index === 0 ? 0.24 : undefined;
  if (edge) notes.push('frame edge: part of this frame has no data');
  if (exps.length < 12) notes.push(`only ${exps.length} exposures`);
  const data = renderSky(scene, grid, { mjd: v.mjdMid, waves, nExp: exps.length, seed: `${scene.key}:ep:${v.index}:${groupId}:${balanced}`, edge });
  return {
    grid,
    data,
    meta: meta({
      kind: 'stack',
      mjd: v.mjdMid,
      mjdMin: v.mjdMin,
      mjdMax: v.mjdMax,
      wavelength: waves.reduce((a, b) => a + b, 0) / waves.length,
      waveMin: Math.min(...waves),
      waveMax: Math.max(...waves),
      detectors: grp.detectors,
      nExposures: exps.length,
      exposureIds: exps.map((e) => e.id),
      visit: v.index,
      notes,
    }),
  };
}

function singleFrame(scene: Scene, grid: SkyGrid, e: Exposure, wave: number, visit: number, extra: Partial<RenderOpts> = {}): SkyFrame {
  const data = renderSky(scene, grid, { mjd: e.mjd, waves: [wave], nExp: 1, seed: `${scene.key}:x:${e.id}`, ...extra });
  const notes = [...satNotes(scene)];
  if (extra.cosmic) notes.push('cosmic ray hit');
  if (extra.streak) notes.push('satellite streak');
  return {
    grid,
    data,
    meta: meta({
      kind: 'exposure',
      mjd: e.mjd,
      mjdMin: e.mjd,
      mjdMax: e.mjd,
      wavelength: wave,
      waveMin: wave,
      waveMax: wave,
      detectors: [e.detector],
      nExposures: 1,
      exposureIds: [e.id],
      visit,
      notes,
    }),
  };
}

function differenceOf(a: SkyFrame, b: SkyFrame): SkyFrame {
  const data = new Float32Array(a.data.length);
  for (let k = 0; k < data.length; k++) data[k] = a.data[k] - b.data[k];
  const notes = [...new Set([...(a.meta.notes ?? []), ...(b.meta.notes ?? [])])];
  return {
    grid: a.grid,
    data,
    meta: {
      ...a.meta,
      kind: 'difference',
      label: `${mjdToIsoDate(a.meta.mjd)} minus ${mjdToIsoDate(b.meta.mjd)} · ${fmtWave(a.meta.waveMin, a.meta.waveMax)}`,
      mjdMin: Math.min(a.meta.mjdMin, b.meta.mjdMin),
      mjdMax: Math.max(a.meta.mjdMax, b.meta.mjdMax),
      nExposures: a.meta.nExposures + b.meta.nExposures,
      exposureIds: [...a.meta.exposureIds, ...b.meta.exposureIds],
      notes,
    },
  };
}

export interface MockSequence {
  frames: SkyFrame[];
  stretch: Partial<Stretch>;
}

/** Build the frames of one sequence for a scene. Exported for tests. */
export function buildMockSequence(
  scene: Scene,
  fovArcsec: number,
  opts: { sequence: string; bandGroupId: string; balanced: boolean; referenceVisit: number | null },
): MockSequence {
  const grid = makeGrid(scene.center, fovArcsec);
  const visits = scene.visits;
  const ref = visits.find((v) => v.index === opts.referenceVisit) ?? visits[0];
  const grp = BAND_GROUPS.find((b) => b.id === opts.bandGroupId) ?? BAND_GROUPS[0];
  let frames: SkyFrame[] = [];
  switch (opts.sequence) {
    case 'pairs': {
      // The same wavelength at every visit: pick the middle of the group's longest-wavelength detector.
      const det = grp.detectors[grp.detectors.length - 1];
      const band = DETECTOR_BANDS[det];
      const wave = (band.min + band.max) / 2;
      frames = visits.map((v, k) => {
        const exps = visitExposures(scene, v, [det]);
        const e = exps[Math.floor(exps.length / 2)] ?? scene.exposures[0];
        const w = wave + (k % 2 === 0 ? 0.004 : -0.003) * band.max;
        return singleFrame(scene, grid, e, w, v.index, { cosmic: k === 0, streak: k === 1 });
      });
      break;
    }
    case 'sweep': {
      const v = visits.reduce((a, b) => (b.exposureIds.length > a.exposureIds.length ? b : a), visits[0]);
      const per = grp.detectors.length > 2 ? 2 : 6;
      for (const d of grp.detectors) {
        const band = DETECTOR_BANDS[d];
        const exps = visitExposures(scene, v, [d]);
        for (let k = 0; k < per; k++) {
          const e = exps[Math.floor(((k + 0.5) / per) * exps.length)] ?? exps[0] ?? scene.exposures[0];
          frames.push(singleFrame(scene, grid, e, band.min + ((band.max - band.min) * (k + 0.5)) / per, v.index));
        }
      }
      frames.sort((a, b) => a.meta.wavelength - b.meta.wavelength);
      break;
    }
    case 'difference': {
      const stacks = visits.map((v) => epochFrame(scene, grid, v, opts.bandGroupId, opts.balanced));
      const refFrame = stacks[visits.indexOf(ref)];
      frames = stacks.filter((f) => f !== refFrame).map((f) => differenceOf(f, refFrame));
      const lim = Math.max(0.05, sharedAbs(frames));
      return { frames, stretch: { lo: -lim, hi: lim, mode: 'linear', colormap: 'diverging' } };
    }
    case 'thenNow': {
      const first = visits[0];
      const last = visits[visits.length - 1];
      frames = [epochFrame(scene, grid, first, opts.bandGroupId, opts.balanced), epochFrame(scene, grid, last, opts.bandGroupId, opts.balanced)];
      break;
    }
    default:
      frames = visits.map((v) => epochFrame(scene, grid, v, opts.bandGroupId, opts.balanced));
  }
  const { lo, hi } = sharedRange(frames, 2, 99.2);
  return { frames, stretch: { lo, hi, mode: 'asinh', q: 4, colormap: 'gray' } };
}

function sharedAbs(frames: SkyFrame[]): number {
  const vals: number[] = [];
  for (const f of frames) for (let k = 0; k < f.data.length; k += 3) if (Number.isFinite(f.data[k])) vals.push(Math.abs(f.data[k]));
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.995)] ?? 1;
}

// ------------------------------------------------------------------ photometry, overlays, findings

function photometry(scene: Scene, src: Source | null): PhotPoint[] {
  const r = rng(hashString(`${scene.key}:phot`));
  return scene.exposures.map((e) => {
    const wave = scene.expWave.get(e.id) ?? (e.emMin + e.emMax) / 2;
    const peak = src ? src.sed(wave) * (src.vary ? src.vary(e.mjd) : 1) : 0;
    const flux = peak * 0.89 * 2.6; // MJy/sr per pixel to mJy, times the PSF footprint in SPHEREx pixels
    const err = 0.03 * Math.abs(flux) + 0.04;
    const saturated = !!(src?.saturate && peak > src.saturate);
    const visit = scene.visits.find((v) => v.exposureIds.includes(e.id))?.index;
    return {
      exposureId: e.id,
      obsId: e.obsId,
      detector: e.detector,
      mjd: e.mjd,
      wavelength: wave,
      bandwidth: wave / DETECTOR_BANDS[e.detector].R,
      cubeChannel: 0,
      flux: flux + err * gauss(r),
      fluxErr: err,
      method: 'aperture',
      flags: saturated ? (1 << 1) | (1 << 21) : 1 << 21,
      saturated,
      good: !saturated,
      snr: Math.abs(flux) / err,
      visit,
    };
  });
}

function overlaysFor(scene: Scene): Overlay[] {
  const out: Overlay[] = [];
  scene.sources.forEach((s, k) => {
    if (s.role === 'field' && k % 2 === 1) return; // a catalogue is never complete
    const at2016 = sourcePos(s, 57388.5); // 2016.0, the Gaia DR3 epoch
    out.push({
      id: `gaia:${k}`,
      kind: 'circle',
      ra: at2016.ra,
      dec: at2016.dec,
      sizeArcsec: 9,
      text: s.role === 'target' ? `${s.name} (Gaia 2016)` : undefined,
    });
  });
  const t = scene.sources.find((s) => s.role === 'target');
  if (t) {
    const path = scene.visits.map((v) => {
      const p = sourcePos(t, v.mjdMid);
      return [p.ra, p.dec] as [number, number];
    });
    out.push({ id: 'track:target', kind: 'track', ra: path[0][0], dec: path[0][1], path, color: '#ffb454' });
    if (t.saturate) {
      const p = sourcePos(t, scene.visits[0].mjdMid);
      out.push({ id: 'flags:sat', kind: 'box', ra: p.ra, dec: p.dec, sizeArcsec: 10, color: '#ff6b6b', text: 'OVERFLOW' });
    }
  }
  return out;
}

function findingsFor(scene: Scene): Finding[] {
  switch (scene.presetId) {
    case 'barnard':
      return [
        { id: 'motion', kind: 'motion', title: 'finding.motion.title', body: 'finding.motion.body', value: '10.7 ± 0.6 arcsec/yr', reference: '10.39 arcsec/yr (Gaia DR3)', confidence: 'high' },
        { id: 'sat', kind: 'note', title: 'finding.sat.title', body: 'finding.sat.body', confidence: 'high' },
        { id: 'colour', kind: 'spectrum', title: 'finding.colour.title', body: 'finding.colour.body', confidence: 'high' },
      ];
    case 'wise0855':
      return [
        { id: 'motion', kind: 'motion', title: 'finding.motion.title', body: 'finding.motion.blend.body', value: '8.6 ± 1.8 arcsec/yr', reference: '8.1 arcsec/yr', confidence: 'low' },
      ];
    case 'epsIndB':
      return [
        { id: 'motion', kind: 'motion', title: 'finding.slow.title', body: 'finding.slow.body', value: '4.5 ± 0.8 arcsec/yr', reference: '4.7 arcsec/yr', confidence: 'medium' },
      ];
    case 'rwaur':
      return [
        { id: 'fade', kind: 'brightness', title: 'finding.fade.title', body: 'finding.fade.body', value: '0.52 ± 0.04 (2026-09 / 2025-09)', reference: '≈ 0.5', confidence: 'high' },
      ];
    case 'rdra':
      return [
        { id: 'pulse', kind: 'brightness', title: 'finding.pulse.title', body: 'finding.pulse.body', value: '2.7× (max / min)', reference: 'Mira, P ≈ 245 d', confidence: 'medium' },
        { id: 'sat', kind: 'note', title: 'finding.sat.title', body: 'finding.sat.body', confidence: 'high' },
        { id: 'colour', kind: 'spectrum', title: 'finding.colour.title', body: 'finding.colour.body', confidence: 'high' },
      ];
    default:
      return [{ id: 'none', kind: 'note', title: 'finding.none.title', body: 'finding.none.body', confidence: 'medium' }];
  }
}

// ------------------------------------------------------------------ the pipeline

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    }, { once: true });
  });

export interface MockOptions {
  /** Multiplies every simulated delay (0 = instant, for tests). */
  delayScale?: number;
}

export class MockPipeline implements AppPipeline {
  private scene: Scene | null = null;
  private ctrl: AbortController | null = null;
  private delay: number;

  constructor(opts: MockOptions = {}) {
    this.delay = opts.delayScale ?? 1;
  }

  async open(input: { name?: string; ra?: number; dec?: number; label?: string }): Promise<void> {
    this.cancel();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const st = useApp.getState();
    st.reset();
    st.setSourceLabel(input.label ?? '');
    st.setDemo(true);
    st.setQuery(input.name ?? (input.ra !== undefined ? `${input.ra.toFixed(4)} ${input.dec?.toFixed(4)}` : ''));
    try {
      st.setStatus({ phase: 'resolving', message: input.name ?? '', loaded: 0, total: 0 });
      await sleep(250 * this.delay, ctrl.signal);
      const scene = buildScene(input, useApp.getState().fovArcsec);
      if (!scene) {
        throw new Error(`Could not find a target named "${input.name}". The demo knows the five challenge targets; coordinates work anywhere.`);
      }
      this.scene = scene;
      st.setTarget(scene.target);
      st.setCenter(scene.center);
      st.setStatus({ phase: 'searching', message: undefined });
      await sleep(350 * this.delay, ctrl.signal);
      st.setExposures(scene.exposures);
      st.setVisits(scene.visits);
      const total = scene.exposures.length;
      st.setStatus({ phase: 'loading', loaded: 0, total });
      const steps = 10;
      for (let k = 1; k <= steps; k++) {
        await sleep(90 * this.delay, ctrl.signal);
        useApp.getState().setStatus({ loaded: Math.round((total * k) / steps) });
      }
      this.rebuildSequence();
      st.setOverlays(overlaysFor(scene));
      const target = scene.sources.find((s) => s.role === 'target') ?? null;
      st.setSpectrum(photometry(scene, target));
      st.setFindings(findingsFor(scene));
      st.setWarnings([]);
      st.setStatus({ phase: 'ready', loaded: total, total, message: undefined });
    } catch (e) {
      // A cancelled run leaves the status to cancel() or to the newer open() that replaced it.
      if ((e as Error).name === 'AbortError' || this.ctrl !== ctrl) return;
      useApp.getState().setStatus({ phase: 'error', message: (e as Error).message });
    } finally {
      if (this.ctrl === ctrl) this.ctrl = null;
    }
  }

  setFov(arcsec: number): void {
    useApp.getState().setFov(arcsec);
    const sc = this.scene;
    if (sc) {
      // Re-scatter field stars so a wider field is not empty at the edges.
      const fov = useApp.getState().fovArcsec;
      sc.sources = [...sc.sources.filter((s) => s.role !== 'field'), ...fieldStars(sc.key, sc.center, Math.max(fov, 180))];
      useApp.getState().setOverlays(overlaysFor(sc));
    }
    this.rebuildSequence();
  }

  rebuildSequence(): void {
    if (!this.scene) return;
    const s = useApp.getState();
    const seq = buildMockSequence(this.scene, s.fovArcsec, {
      sequence: s.sequence,
      bandGroupId: s.bandGroupId,
      balanced: s.balanced,
      referenceVisit: s.referenceVisit,
    });
    // Keep the user's colour map unless switching into or out of signed (difference) data.
    const keep = seq.stretch.colormap !== 'diverging' && s.stretch.colormap !== 'diverging';
    s.setStretch({ ...seq.stretch, ...(keep ? { colormap: s.stretch.colormap, invert: s.stretch.invert } : {}) });
    s.setFrames(seq.frames);
  }

  async measureAt(pos: SkyPos): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    const st = useApp.getState();
    st.pick(pos);
    // Nearest synthetic source within 12 arcsec of the click (at the mid epoch), else blank sky.
    const mid = scene.visits[Math.floor(scene.visits.length / 2)].mjdMid;
    let best: Source | null = null;
    let bestD = 12;
    for (const s of scene.sources) {
      const p = sourcePos(s, mid);
      const d = Math.hypot((p.ra - pos.ra) * Math.cos((pos.dec * Math.PI) / 180), p.dec - pos.dec) * 3600;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const pts = photometry(scene, best);
    st.setSpectrum(pts);
    const others = st.findings.filter((f) => f.id !== 'pick');
    st.setFindings([
      ...others,
      {
        id: 'pick',
        kind: 'note',
        title: 'finding.pick.title',
        body: best ? 'finding.pick.body' : 'finding.pick.blank',
        value: `${pts.filter((p) => p.good).length} / ${pts.length}`,
        confidence: best ? 'medium' : 'low',
      },
    ]);
  }

  cancel(): void {
    if (!this.ctrl) return;
    this.ctrl.abort();
    this.ctrl = null;
    useApp.getState().setStatus({ phase: 'idle', message: 'cancelled', loaded: 0, total: 0 });
  }
}

/** Ids of the presets the mock knows (all five challenge targets). */
export const MOCK_PRESET_IDS = PRESETS.map((p) => p.id);
