// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Pure (no DOM, no network) analysis of one measured asteroid file from public/data/asteroids:
// reflectance spectrum, broad Bus-DeMeo group, thermal-tail fit per visit and the model curves that
// AsteroidPanel draws. Everything is computed from the measured points with core/solar.

import classMeansJson from '../../../public/data/busdemeo_class_means.json';
import {
  BUS_DEMEO_GROUPS,
  classifyBusDemeo,
  crossoverWavelength,
  fitThermalTail,
  neatmFlux,
  reflectedFlux,
  toReflectance,
  type AsteroidPoint,
  type TaxonomyResult,
} from '../../core/solar';
import type { ReflectancePoint, ReflectanceTemplate, ThermalModel } from '../research';

// ---------------------------------------------------------------- data file types

export interface CatalogueFact<T = number> {
  value: T;
  source: string;
  note?: string;
}

export interface AsteroidCatalogue {
  taxonomy?: { value: string; system: string; source: string };
  diameterKm?: CatalogueFact;
  albedoV?: CatalogueFact;
  H?: CatalogueFact;
  G?: CatalogueFact;
  rotationPeriodH?: CatalogueFact;
  retrieved: string;
}

export interface AsteroidVisitInfo {
  index: number;
  from: string;
  to: string;
  mjdMin: number;
  mjdMax: number;
  nExposures: number;
  nMeasurements: number;
  nKept: number;
}

export interface AsteroidFilePoint {
  wavelength_um: number;
  bandwidth_um: number;
  flux_mJy: number;
  err_mJy: number;
  mjd: number;
  obs_id: string;
  detector: number;
  r_au: number;
  delta_au: number;
  phase_deg: number;
  flags: number;
  flag_names: string[];
  kept: boolean;
  reject_reasons: string[];
  visit: number;
  lightcurve_factor: number;
  s3_key: string;
}

export interface AsteroidFile {
  schema: string;
  number: number;
  name: string;
  designation: string;
  catalogue: AsteroidCatalogue;
  provenance: {
    summary: string;
    method: string;
    measuredBy: string;
    date: string;
    release: string;
    geometry: string;
    nExposures: number;
    nMeasurements: number;
    nKept: number;
    firstDate: string;
    lastDate: string;
    visits: AsteroidVisitInfo[];
    lightcurve: string;
    errors: string;
  };
  units: Record<string, string>;
  points: AsteroidFilePoint[];
}

export interface AsteroidIndexEntry {
  id: string;
  number: number;
  name: string;
  file: string;
  nExposures: number;
  catalogueType?: string;
}

// ---------------------------------------------------------------- analysis

/** Default H-G slope when the catalogue has none (the IAU standard value). */
export const DEFAULT_G = 0.15;
/** Error floor added in quadrature for the template match (rotation and calibration scatter; core/solar's recommendation). */
export const TAXONOMY_ERROR_FLOOR = 0.03;
/** Beaming-parameter range drawn as the thermal band. */
export const ETA_BAND: [number, number] = [0.8, 1.2];
/** Longest wavelength used for reflectance: beyond it the asteroid's own heat is not subtracted. */
export const REFLECTANCE_MAX_UM = 2.45;

interface ClassMeans {
  wave_um: number[];
  classes: Record<string, { complex: string; mean: number[] }>;
}
const MEANS = classMeansJson as unknown as ClassMeans;

export interface VisitThermal {
  visit: number;
  nTail: number;
  eta?: number;
  etaErr?: number;
  crossoverUm?: number;
  refused?: string;
}

export interface AsteroidAnalysis {
  name: string;
  /** Reflectance of the kept points at 0.75-2.45 um, normalised to 1 at 1.2 um. */
  reflectance: ReflectancePoint[];
  /** Best and runner-up class means (templates), labelled by the caller. */
  templates: { cls: string; group: string; role: 'best' | 'runnerUp'; template: ReflectanceTemplate }[];
  taxonomy: TaxonomyResult;
  /** Bus-DeMeo group of the catalogue type (e.g. 'C' -> 'C/X-like'), when it maps to one. */
  catalogueGroup?: string;
  thermal?: ThermalModel;
  /** Visit shown in the thermal plot. */
  thermalVisit?: number;
  /** Why there is no thermal plot at all (missing catalogue size or albedo). */
  thermalUnavailable?: string;
  thermalByVisit: VisitThermal[];
  G: number;
  gFromCatalogue: boolean;
  lightcurveApplied: boolean;
  nReflectance: number;
}

/** Map a catalogue taxonomic type to the broad group core/solar reports (undefined when it has none). */
export function catalogueGroupOf(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const t = type.trim().split(/[\s(]/)[0];
  return BUS_DEMEO_GROUPS[t] ?? BUS_DEMEO_GROUPS[t.charAt(0)];
}

/** Turn file points into core/solar AsteroidPoints, optionally dividing out the fitted rotation factor. */
export function toAsteroidPoints(file: AsteroidFile, lightcurve: boolean): (AsteroidPoint & { visit: number; mjd: number })[] {
  return file.points.map((p) => {
    const lc = lightcurve && p.lightcurve_factor > 0 ? p.lightcurve_factor : 1;
    return {
      wavelength: p.wavelength_um,
      flux: p.flux_mJy / lc,
      fluxErr: p.err_mJy / lc,
      good: p.kept && Number.isFinite(p.flux_mJy) && Number.isFinite(p.err_mJy),
      rAu: p.r_au,
      deltaAu: p.delta_au,
      phaseDeg: p.phase_deg,
      visit: p.visit,
      mjd: p.mjd,
    };
  });
}

function median(v: number[]): number {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function templateOf(cls: string): ReflectanceTemplate | null {
  const c = MEANS.classes[cls];
  if (!c) return null;
  return { label: cls, wavelength: MEANS.wave_um.slice(), reflectance: c.mean.slice() };
}

export function analyseAsteroid(file: AsteroidFile, opts: { lightcurve?: boolean; visit?: number } = {}): AsteroidAnalysis {
  const lightcurve = opts.lightcurve ?? true;
  const cat = file.catalogue;
  const G = cat.G?.value ?? DEFAULT_G;
  const pts = toAsteroidPoints(file, lightcurve);

  // Reflectance over the whole data set (every point carries its own distances and phase).
  const refl = toReflectance(pts, { normaliseAt: 1.2, G });
  const reflectance: ReflectancePoint[] = [];
  refl.forEach((r, i) => {
    const p = pts[i];
    if (p.good && p.wavelength <= REFLECTANCE_MAX_UM && Number.isFinite(r.reflectance) && Number.isFinite(r.err)) reflectance.push(r);
  });
  reflectance.sort((a, b) => a.wavelength - b.wavelength);

  const taxonomy = classifyBusDemeo(reflectance, { errorFloor: TAXONOMY_ERROR_FLOOR });
  const templates: AsteroidAnalysis['templates'] = [];
  const best = taxonomy.ranked[0];
  if (best) {
    const tb = templateOf(best.cls);
    if (tb) templates.push({ cls: best.cls, group: best.group, role: 'best', template: { ...tb, highlight: true } });
    const next = taxonomy.ranked.find((r) => r.group !== best.group);
    const tn = next ? templateOf(next.cls) : null;
    if (next && tn) templates.push({ cls: next.cls, group: next.group, role: 'runnerUp', template: tn });
  }

  // Thermal tail, one fit per visit (geometry changes between visits).
  const visits = [...new Set(pts.map((p) => p.visit))].sort((a, b) => a - b);
  const D = cat.diameterKm?.value;
  const pV = cat.albedoV?.value;
  const H = cat.H?.value;
  const thermalByVisit: VisitThermal[] = [];
  let thermalUnavailable: string | undefined;
  if (!(D && D > 0 && pV && pV > 0 && H !== undefined && Number.isFinite(H))) {
    thermalUnavailable = 'catalogue diameter, albedo or H not available';
  } else {
    for (const v of visits) {
      const vp = pts.filter((p) => p.visit === v);
      const nTail = vp.filter((p) => p.good && p.wavelength > 3.3).length;
      try {
        const fit = fitThermalTail(vp, { diameterKm: D, pV, H, G });
        thermalByVisit.push({ visit: v, nTail, eta: fit.eta, etaErr: fit.etaErr, crossoverUm: Number.isFinite(fit.crossoverUm) ? fit.crossoverUm : undefined });
      } catch (e) {
        thermalByVisit.push({ visit: v, nTail, refused: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  let thermal: ThermalModel | undefined;
  let thermalVisit: number | undefined;
  if (!thermalUnavailable && D && pV && H !== undefined) {
    // Show the requested visit, else the one with a successful fit and the most tail points.
    const ranked = [...thermalByVisit].sort((a, b) => Number(b.eta !== undefined) - Number(a.eta !== undefined) || b.nTail - a.nTail);
    thermalVisit = opts.visit !== undefined && visits.includes(opts.visit) ? opts.visit : ranked[0]?.visit;
    const vp = pts.filter((p) => p.visit === thermalVisit && p.good);
    if (vp.length > 0) {
      const geo = { rAu: median(vp.map((p) => p.rAu)), deltaAu: median(vp.map((p) => p.deltaAu)), phaseDeg: median(vp.map((p) => p.phaseDeg)) };
      // Reflected sunlight: the grey H-G prediction scaled to the measured 1.7-2.45 um points of this visit.
      const cont = vp.filter((p) => p.wavelength >= 1.7 && p.wavelength <= 2.45);
      const ratio = median(cont.map((p) => p.flux / reflectedFlux({ H, G, rAu: p.rAu, deltaAu: p.deltaAu, phaseDeg: p.phaseDeg }, p.wavelength)));
      const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      const refl = (l: number) => reflectedFlux({ H, G, ...geo, reflectanceRatio: scale }, l);
      const therm = (eta: number) => (l: number) => neatmFlux({ diameterKm: D, pV, eta, G, ...geo }, l);
      const wl: number[] = [];
      for (let l = 0.75; l <= 5.1 + 1e-9; l += 0.02) wl.push(Math.round(l * 1000) / 1000);
      const hiF = therm(ETA_BAND[0]);
      const loF = therm(ETA_BAND[1]);
      const c1 = crossoverWavelength(hiF, refl);
      const c2 = crossoverWavelength(loF, refl);
      const fit = thermalByVisit.find((f) => f.visit === thermalVisit);
      thermal = {
        wavelength: wl,
        reflected: wl.map(refl),
        thermalLo: wl.map(loF),
        thermalHi: wl.map(hiF),
        // Each point moved to the visit's median distance from SPHEREx (flux scales as 1 / delta^2).
        measured: vp.map((p) => {
          const k = (p.deltaAu / geo.deltaAu) ** 2;
          return { wavelength: p.wavelength, flux: p.flux * k, err: p.fluxErr * k };
        }),
        crossoverUm: Number.isFinite(c1) && Number.isFinite(c2) ? [Math.min(c1, c2), Math.max(c1, c2)] : undefined,
        eta: fit?.eta,
        etaErr: fit?.etaErr,
      };
    }
  }

  return {
    name: `(${file.number}) ${file.name}`,
    reflectance,
    templates,
    taxonomy,
    catalogueGroup: catalogueGroupOf(cat.taxonomy?.value),
    thermal,
    thermalVisit,
    thermalUnavailable,
    thermalByVisit,
    G,
    gFromCatalogue: cat.G !== undefined,
    lightcurveApplied: lightcurve && file.points.some((p) => Math.abs(p.lightcurve_factor - 1) > 1e-9),
    nReflectance: reflectance.length,
  };
}
