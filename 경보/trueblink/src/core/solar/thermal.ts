// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Light from an asteroid has two parts. Below about 3 um it is sunlight reflected off the surface. Beyond
// about 3.5-4 um (for a main-belt asteroid) the asteroid's own heat glow takes over: the sunlit surface is
// at 150-300 K and its Planck curve rises steeply through SPHEREx bands 5 and 6. This file models both,
// following the verified reference implementation of our research notes (thermal_models.mjs), and fits the
// one free thermal parameter (the beaming parameter eta) to the measured thermal tail.
//
// Units: wavelength micron, distances au, diameter km, angles degrees, flux density mJy.

import type { PhotPoint } from '../types';
import { solarFluxMjy } from './sun';

const H_PLANCK = 6.62607015e-34;
const C_LIGHT = 2.99792458e8;
const K_BOLTZ = 1.380649e-23;
const SIGMA_SB = 5.670374419e-8;
/** Kilometres per astronomical unit. */
export const AU_KM = 1.495978707e8;
/** Solar constant at 1 au in W m^-2 (modern value). */
export const S0_W_M2 = 1361.0;
/** D = D0 10^(-H/5) / sqrt(pV): the diameter of an asteroid of absolute magnitude H and albedo pV, in km. */
export const D0_KM = 1329.0;
const MJY_PER_SI = 1e29; // 1 W m^-2 Hz^-1 = 1e26 Jy = 1e29 mJy

/** Beaming parameter and phase coefficient of the refined Standard Thermal Model (Lebofsky et al. 1986). */
export const STM_ETA = 0.756;
export const STM_PHASE_MAG_PER_DEG = 0.01;

/** Short caveats to print next to any thermal-model result. */
export const THERMAL_NOTES: readonly string[] = [
  'The beaming parameter eta is an effective number that absorbs shape, spin and surface roughness; it is not a surface property.',
  'On the short-wavelength (Wien) side of the heat glow, 20 % in eta is about a factor 2 in flux at 4-5 um.',
  'The STM (eta 0.756) was tuned at 10 um and over-predicts 4.8 um flux by about 60 % for Ceres; it is shown for comparison only.',
  'Main-belt asteroids seen near 90 degrees from the Sun typically have eta = 1.0 +/- 0.2 (WISE); near-Earth asteroids 1.0-1.8.',
  'The reflected sunlight under the heat glow cannot be measured there; it is extrapolated from 1.7-2.45 um, so its error goes straight into eta.',
  'Every SPHEREx wavelength is observed at a different time: rotation and changing distance can look like spectral structure.',
  'Ceres, Pallas, Vesta and other asteroids brighter than about V 12 saturate SPHEREx; their points are not reliable.',
];

/** Planck function B_nu(T) in W m^-2 Hz^-1 sr^-1 (0 for T <= 0). */
export function planckNu(wavelengthUm: number, tempK: number): number {
  if (!(tempK > 0)) return 0;
  const nu = C_LIGHT / (wavelengthUm * 1e-6);
  const x = (H_PLANCK * nu) / (K_BOLTZ * tempK);
  if (x > 700) return 0;
  return (2 * H_PLANCK * nu ** 3) / C_LIGHT ** 2 / Math.expm1(x);
}

/** Phase integral q = 0.290 + 0.684 G (Bowell et al. 1989); Bond albedo A = q pV. */
export function phaseIntegral(G: number): number {
  return 0.29 + 0.684 * G;
}

/** H-G phase function Phi(alpha): how much fainter the asteroid is at phase angle alpha than at opposition. */
export function hgPhase(phaseDeg: number, G: number): number {
  const t = Math.tan((Math.abs(phaseDeg) * Math.PI) / 360);
  return (1 - G) * Math.exp(-3.33 * t ** 0.63) + G * Math.exp(-1.87 * t ** 1.22);
}

export function diameterFromH(H: number, pV: number): number {
  return (D0_KM * 10 ** (-H / 5)) / Math.sqrt(pV);
}

export function absoluteMagnitude(diameterKm: number, pV: number): number {
  return -5 * Math.log10((diameterKm * Math.sqrt(pV)) / D0_KM);
}

/**
 * Temperature of the point directly below the Sun: absorbed sunlight (1-A) S0 / r^2 balances thermal
 * emission eta eps sigma T^4. A larger eta means a cooler surface (heat spread to the night side or
 * radiated away from the observer).
 */
export function subsolarTemperature(bondAlbedo: number, rAu: number, eta: number, emissivity = 0.9): number {
  return (((1 - bondAlbedo) * S0_W_M2) / (rAu * rAu * eta * emissivity * SIGMA_SB)) ** 0.25;
}

const glCache = new Map<number, { x: Float64Array; w: Float64Array }>();
/** Gauss-Legendre nodes and weights on [-1, 1]. */
function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const hit = glCache.get(n);
  if (hit) return hit;
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let z1: number;
    let pp: number;
    do {
      let p1 = 1;
      let p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      z1 = z;
      z = z1 - p1 / pp;
    } while (Math.abs(z - z1) > 1e-15);
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  const out = { x, w };
  glCache.set(n, out);
  return out;
}

/** Solid angle factor (D / 2 Delta)^2 with D in km and Delta in au. */
function radiusOverDistanceSq(diameterKm: number, deltaAu: number): number {
  return ((0.5 * diameterKm) / (deltaAu * AU_KM)) ** 2;
}

export interface ThermalParams {
  diameterKm: number;
  /** Geometric albedo in V. */
  pV: number;
  /** Beaming parameter. */
  eta: number;
  /** Infrared emissivity, default 0.9. */
  emissivity?: number;
  /** H-G slope parameter (sets the Bond albedo through q), default 0.15. */
  G?: number;
  rAu: number;
  deltaAu: number;
  phaseDeg: number;
}

/**
 * Near-Earth Asteroid Thermal Model (Harris 1998): a sphere whose temperature falls as cos^(1/4) of the
 * angle from the sub-solar point and is zero on the night side, seen at phase angle alpha; the Planck
 * function is integrated over the part of the visible hemisphere that is lit. Returns mJy.
 */
export function neatmFlux(p: ThermalParams, wavelengthUm: number): number {
  const eps = p.emissivity ?? 0.9;
  const G = p.G ?? 0.15;
  const a = (Math.abs(p.phaseDeg) * Math.PI) / 180;
  const tss = subsolarTemperature(phaseIntegral(G) * p.pV, p.rAu, p.eta, eps);
  const n = 24;
  const { x, w } = gaussLegendre(n);
  // Longitude theta from the sub-solar meridian runs over the lit part visible to the observer.
  const t0 = a - Math.PI / 2;
  const t1 = Math.PI / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const th = 0.5 * (t1 - t0) * x[i] + 0.5 * (t1 + t0);
    const wt = 0.5 * (t1 - t0) * w[i];
    const cth = Math.max(Math.cos(th), 0);
    const view = Math.cos(th - a);
    for (let j = 0; j < n; j++) {
      // Latitude 0..pi/2, doubled for the southern hemisphere.
      const ph = 0.25 * Math.PI * (x[j] + 1);
      const wp = 0.25 * Math.PI * w[j];
      const cph = Math.cos(ph);
      sum += wt * wp * planckNu(wavelengthUm, tss * (cth * cph) ** 0.25) * cph * cph * view;
    }
  }
  return eps * radiusOverDistanceSq(p.diameterKm, p.deltaAu) * 2 * sum * MJY_PER_SI;
}

export type StmParams = Omit<ThermalParams, 'eta'> & {
  /** Default 0.756 (Lebofsky et al. 1986). */
  eta?: number;
  /** Thermal phase coefficient in mag per degree, default 0.01. */
  phaseCoeffMagPerDeg?: number;
};

/**
 * Refined Standard Thermal Model (Lebofsky et al. 1986): the same temperature law, computed as if seen at
 * zero phase, then dimmed by 0.01 mag per degree of phase angle. Returns mJy. Historical comparison only.
 */
export function stmFlux(p: StmParams, wavelengthUm: number): number {
  const eps = p.emissivity ?? 0.9;
  const G = p.G ?? 0.15;
  const eta = p.eta ?? STM_ETA;
  const beta = p.phaseCoeffMagPerDeg ?? STM_PHASE_MAG_PER_DEG;
  const tss = subsolarTemperature(phaseIntegral(G) * p.pV, p.rAu, eta, eps);
  const n = 32;
  const { x, w } = gaussLegendre(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const mu = 0.5 * (x[i] + 1);
    sum += 0.5 * w[i] * planckNu(wavelengthUm, tss * mu ** 0.25) * mu;
  }
  return (
    eps * radiusOverDistanceSq(p.diameterKm, p.deltaAu) * 2 * Math.PI * sum *
    10 ** (-0.4 * beta * Math.abs(p.phaseDeg)) * MJY_PER_SI
  );
}

export interface ReflectedParams {
  /** Absolute magnitude (V at 1 au from Sun and observer, zero phase). */
  H: number;
  /** H-G slope parameter, default 0.15. */
  G?: number;
  rAu: number;
  deltaAu: number;
  phaseDeg: number;
  /** Reflectance at this wavelength divided by reflectance in V (1 = grey), default 1. */
  reflectanceRatio?: number;
}

/**
 * Reflected sunlight in mJy. The V-band brightness follows from H and the H-G phase function
 * (V = H + 5 log10(r Delta) - 2.5 log10 Phi); its colour is the Sun's, scaled by
 * solarFluxMjy(lambda) / solarFluxMjy(0.55), times the reflectance ratio. D0 = 1329 km ties H to the
 * solar flux (equivalent to pV (D / 2 Delta)^2 F_sun / r^2). NaN outside the solar table.
 */
export function reflectedFlux(p: ReflectedParams, wavelengthUm: number): number {
  const G = p.G ?? 0.15;
  const ratio = p.reflectanceRatio ?? 1;
  const fV = solarFluxMjy(0.55, p.rAu) * radiusOverDistanceSq(D0_KM, p.deltaAu) * 10 ** (-0.4 * p.H) * hgPhase(p.phaseDeg, G);
  return (fV * solarFluxMjy(wavelengthUm)) / solarFluxMjy(0.55) * ratio;
}

/** A measured point with the asteroid's geometry at that exposure. Full PhotPoint objects fit this type. */
export type AsteroidPoint = Pick<PhotPoint, 'wavelength' | 'flux' | 'fluxErr'> & {
  /** Points with good === false are carried through but not used for normalisation or fits. */
  good?: boolean;
  rAu: number;
  deltaAu: number;
  phaseDeg: number;
};

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/**
 * Turn measured fluxes into relative reflectance: move every point to r = Delta = 1 au and zero phase
 * (H-G phase function, G default 0.15), divide by the solar spectrum, and normalise to 1 at `normaliseAt`
 * (default 1.20 um) using the median of good points within +-0.1 um. The output has the same length and
 * order as the input; points without data (or outside the solar table) come out as NaN. Thermal emission
 * is not removed here, so values beyond about 3 um include the asteroid's heat glow.
 * Throws when no good point lies within 0.1 um of `normaliseAt`.
 */
export function toReflectance(
  points: AsteroidPoint[],
  opts?: { normaliseAt?: number; G?: number },
): { wavelength: number; reflectance: number; err: number }[] {
  const norm = opts?.normaliseAt ?? 1.2;
  const G = opts?.G ?? 0.15;
  const raw = points.map((p) => {
    const k = (p.rAu * p.rAu * p.deltaAu * p.deltaAu) / hgPhase(p.phaseDeg, G) / solarFluxMjy(p.wavelength);
    return { wavelength: p.wavelength, r: p.flux * k, e: p.fluxErr * k };
  });
  const near: number[] = [];
  raw.forEach((q, i) => {
    if (points[i].good !== false && Number.isFinite(q.r) && Math.abs(q.wavelength - norm) <= 0.1) near.push(q.r);
  });
  const n0 = median(near);
  if (!(n0 > 0)) {
    throw new Error(`Cannot normalise the reflectance: no good point within 0.1 um of ${norm} um.`);
  }
  return raw.map((q) => ({
    wavelength: q.wavelength,
    reflectance: Number.isFinite(q.r) ? q.r / n0 : NaN,
    err: Number.isFinite(q.e) ? q.e / n0 : NaN,
  }));
}

/**
 * Wavelength (micron) where `thermal` first overtakes `reflected` between lo and hi; NaN if it never does.
 */
export function crossoverWavelength(
  thermal: (wavelengthUm: number) => number,
  reflected: (wavelengthUm: number) => number,
  lo = 2.0,
  hi = 5.2,
): number {
  const d = (l: number) => thermal(l) - reflected(l);
  const step = 0.01;
  let a = lo;
  let da = d(a);
  for (let b = lo + step; b <= hi + 1e-9; b += step) {
    const db = d(b);
    if (Number.isFinite(da) && Number.isFinite(db) && da < 0 && db >= 0) {
      let x0 = a;
      let x1 = b;
      for (let k = 0; k < 40; k++) {
        const m = 0.5 * (x0 + x1);
        if (d(m) < 0) x0 = m;
        else x1 = m;
      }
      return 0.5 * (x0 + x1);
    }
    a = b;
    da = db;
  }
  return NaN;
}

const usable = (p: AsteroidPoint) =>
  p.good !== false &&
  Number.isFinite(p.wavelength) && Number.isFinite(p.flux) && p.fluxErr > 0 &&
  p.rAu > 0 && p.deltaAu > 0 && Number.isFinite(p.phaseDeg);

/**
 * Fit the beaming parameter eta to the thermal tail, with diameter, pV and H fixed (catalogue values).
 *
 * 1. The reflected continuum: for good points at 1.7-2.45 um, the ratio of measured flux to grey reflected
 *    sunlight (from H, G) is fitted with a weighted straight line in wavelength and extrapolated.
 * 2. The thermal excess (flux minus that continuum) of good points beyond 3.3 um is compared with NEATM;
 *    chi-square is scanned over eta 0.5-2.5 in steps of 0.02 and refined with parabola fits.
 *
 * Returns eta, its 1-sigma error (from the chi-square curvature, scaled up by sqrt(reduced chi-square)
 * when that exceeds 1), the wavelength where thermal equals reflected for the median geometry of the
 * fitted points (crossoverUm, NaN if none in 2-5.2 um), and the total chi-square (n - 1 degrees of
 * freedom). Throws when fewer than 5 usable points lie beyond 3.3 um, fewer than 3 in 1.7-2.45 um, or
 * when the best eta lies on the edge of the 0.5-2.5 search range (no meaningful minimum).
 */
export function fitThermalTail(
  points: AsteroidPoint[],
  fixed: { diameterKm: number; pV: number; H: number; G?: number; emissivity?: number },
): { eta: number; etaErr: number; crossoverUm: number; chi2: number } {
  const G = fixed.G ?? 0.15;
  const good = points.filter(usable);
  const tail = good.filter((p) => p.wavelength > 3.3);
  if (tail.length < 5) {
    throw new Error(`Thermal fit refused: ${tail.length} usable point(s) beyond 3.3 um, at least 5 are needed.`);
  }
  const cont = good.filter((p) => p.wavelength >= 1.7 && p.wavelength <= 2.45);
  if (cont.length < 3) {
    throw new Error(
      `Thermal fit refused: ${cont.length} usable point(s) at 1.7-2.45 um, at least 3 are needed to set the reflected continuum.`,
    );
  }
  const grey = (p: AsteroidPoint, l: number) =>
    reflectedFlux({ H: fixed.H, G, rAu: p.rAu, deltaAu: p.deltaAu, phaseDeg: p.phaseDeg }, l);

  // Weighted straight line ratio = c0 + c1 (lambda - 2), the reflectance relative to grey.
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of cont) {
    const g = grey(p, p.wavelength);
    const y = p.flux / g;
    const wgt = (g / p.fluxErr) ** 2;
    const x = p.wavelength - 2;
    sw += wgt; sx += wgt * x; sy += wgt * y; sxx += wgt * x * x; sxy += wgt * x * y;
  }
  const det = sw * sxx - sx * sx;
  const c1 = det > 0 ? (sw * sxy - sx * sy) / det : 0;
  const c0 = det > 0 ? (sy - c1 * sx) / sw : sy / sw;
  const ratioAt = (l: number) => Math.max(c0 + c1 * (l - 2), 0);
  const excess = tail.map((p) => p.flux - grey(p, p.wavelength) * ratioAt(p.wavelength));

  const chi2At = (eta: number) => {
    let c = 0;
    tail.forEach((p, i) => {
      const m = neatmFlux(
        { diameterKm: fixed.diameterKm, pV: fixed.pV, eta, G, emissivity: fixed.emissivity, rAu: p.rAu, deltaAu: p.deltaAu, phaseDeg: p.phaseDeg },
        p.wavelength,
      );
      c += ((excess[i] - m) / p.fluxErr) ** 2;
    });
    return c;
  };

  const lo = 0.5;
  const hi = 2.5;
  let best = lo;
  let bestC = Infinity;
  for (let e = lo; e <= hi + 1e-9; e += 0.02) {
    const c = chi2At(e);
    if (c < bestC) { bestC = c; best = e; }
  }
  // Successive parabola fits through (eta - h, eta, eta + h) with a shrinking step.
  let eta = best;
  for (const h of [0.02, 0.005, 0.001]) {
    const a = Math.max(lo, eta - h);
    const b = Math.min(hi, eta + h);
    const m = 0.5 * (a + b);
    const ca = chi2At(a), cm = chi2At(m), cb = chi2At(b);
    const den = ca - 2 * cm + cb;
    const hh = 0.5 * (b - a);
    const v = den > 0 ? m + (0.5 * hh * (ca - cb)) / den : [a, m, b][[ca, cm, cb].indexOf(Math.min(ca, cm, cb))];
    eta = Math.min(hi, Math.max(lo, v));
  }
  if (eta <= lo + 1e-3 || eta >= hi - 1e-3) {
    throw new Error(
      `Thermal fit refused: the best beaming parameter sits at the edge of the search range (eta ${eta.toFixed(2)}, allowed ${lo}-${hi}). ` +
        'The reflected continuum extrapolated from 1.7-2.45 um probably does not match this asteroid (for example a 2 um absorption band), or the catalogue size or albedo is off.',
    );
  }
  const chi2 = chi2At(eta);
  const h = 0.005;
  const curv = (chi2At(Math.min(hi, eta + h)) - 2 * chi2 + chi2At(Math.max(lo, eta - h))) / (h * h);
  const dof = Math.max(tail.length - 1, 1);
  const etaErr = curv > 0 ? Math.sqrt(2 / curv) * Math.sqrt(Math.max(1, chi2 / dof)) : NaN;

  const geo = {
    rAu: median(tail.map((p) => p.rAu)),
    deltaAu: median(tail.map((p) => p.deltaAu)),
    phaseDeg: median(tail.map((p) => p.phaseDeg)),
  };
  const crossoverUm = crossoverWavelength(
    (l) => neatmFlux({ diameterKm: fixed.diameterKm, pV: fixed.pV, eta, G, emissivity: fixed.emissivity, ...geo }, l),
    (l) => reflectedFlux({ H: fixed.H, G, ...geo }, l) * ratioAt(l),
  );
  return { eta, etaErr, crossoverUm, chi2 };
}
