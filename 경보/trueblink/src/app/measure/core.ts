// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Pure measurement helpers (no DOM, no store): photometry and centroids on the wings of saturated
// stars, per-visit aggregation of positions, motion fits with honest errors, comparison-star
// selection, significance rules and compass directions. Unit-tested in tests/measure.test.ts.

import { fitMotion, propagateSource, type MotionFit } from '../../core/astrometry';
import { sigmaClippedStats } from '../../core/phot';
import type { CatalogSource, NativeCutout, PhotPoint, SkyPos, TargetInfo } from '../../core/types';
import { FLAG_MASKS, UJY_PER_MJYSR_ARCSEC2 } from '../../core/types';
import { pixToSky, skyToPix, tanDeproject, tanProject, angularSepArcsec } from '../../core/wcs';
import { median, motionVerdict } from '../research/helpers';

/** Pixels never used for wing work: the official photometry mask plus OVERFLOW (SOURCE / OUTLIER are not in it). */
export const WING_BAD_MASK = FLAG_MASKS.photometry | FLAG_MASKS.saturation;

const FLUX_FLOOR = 0.03;

function localPix(c: NativeCutout, pos: SkyPos): [number, number] {
  const [x, y] = skyToPix(c.header.wcs, pos.ra, pos.dec);
  return [x - c.x0, y - c.y0];
}

function pixValue(c: NativeCutout, k: number): number {
  const v = c.image[k];
  if (c.zodi) {
    const z = c.zodi[k];
    return Number.isFinite(z) ? v - z : v;
  }
  return v;
}

function usablePix(c: NativeCutout, k: number, bad: number): boolean {
  if (c.flags && c.flags[k] & bad) return false;
  return Number.isFinite(pixValue(c, k));
}

/** Sigma-clipped background in a ring around (lx, ly), in local pixel units. */
export function ringBackground(c: NativeCutout, lx: number, ly: number, rin: number, rout: number, bad = WING_BAD_MASK): { median: number; sigma: number; n: number } {
  const vals: number[] = [];
  for (let j = Math.max(0, Math.floor(ly - rout)); j <= Math.min(c.ny - 1, Math.ceil(ly + rout)); j++) {
    for (let i = Math.max(0, Math.floor(lx - rout)); i <= Math.min(c.nx - 1, Math.ceil(lx + rout)); i++) {
      const d = Math.hypot(i - lx, j - ly);
      if (d < rin || d > rout) continue;
      const k = j * c.nx + i;
      if (!usablePix(c, k, bad)) continue;
      vals.push(pixValue(c, k));
    }
  }
  return sigmaClippedStats(vals);
}

/** Does the target's core look saturated in this cutout (NaN or OVERFLOW/BLOOM within 1.5 px)? */
export function coreSaturated(c: NativeCutout, pos: SkyPos): boolean {
  const [lx, ly] = localPix(c, pos);
  for (let j = Math.floor(ly - 2); j <= Math.ceil(ly + 2); j++) {
    for (let i = Math.floor(lx - 2); i <= Math.ceil(lx + 2); i++) {
      if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) continue;
      if (Math.hypot(i - lx, j - ly) > 1.5) continue;
      const k = j * c.nx + i;
      if (c.flags && c.flags[k] & FLAG_MASKS.saturation) return true;
      if (!Number.isFinite(c.image[k])) return true;
    }
  }
  return false;
}

/**
 * Relative photometry on the wings of a (saturated) star: mean background-subtracted surface
 * brightness in a ring 2-4.5 px from the centre (NaN, OVERFLOW/BLOOM and other bad pixels skipped),
 * times the ring area, in mJy-like units. Only ratios of these numbers at the same wavelength mean
 * anything; the result is NOT the star's flux.
 */
export function wingPhot(c: NativeCutout, pos: SkyPos, opts?: { rin?: number; rout?: number }): PhotPoint {
  const rin = opts?.rin ?? 2;
  const rout = opts?.rout ?? 4.5;
  const [lx, ly] = localPix(c, pos);
  const bkg = ringBackground(c, lx, ly, Math.max(7, rout + 2.5), Math.max(11, rout + 6.5));
  let sum = 0;
  let n = 0;
  let nominal = 0;
  let flags = 0;
  let outside = false;
  for (let j = Math.floor(ly - rout); j <= Math.ceil(ly + rout); j++) {
    for (let i = Math.floor(lx - rout); i <= Math.ceil(lx + rout); i++) {
      const d = Math.hypot(i - lx, j - ly);
      if (d < rin || d > rout) continue;
      nominal++;
      if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) {
        outside = true;
        continue;
      }
      const k = j * c.nx + i;
      if (c.flags) flags |= c.flags[k];
      if (!usablePix(c, k, WING_BAD_MASK)) continue;
      sum += pixValue(c, k) - bkg.median;
      n++;
    }
  }
  const omega = c.omegaArcsec2 > 0 ? c.omegaArcsec2 : 37.8;
  const toMjy = (UJY_PER_MJYSR_ARCSEC2 * omega) / 1000;
  const area = Math.PI * (rout * rout - rin * rin);
  const mean = n > 0 ? sum / n : NaN;
  const flux = bkg.n >= 6 && Number.isFinite(mean) ? mean * area * toMjy : NaN;
  const statErr = Number.isFinite(bkg.sigma) && n > 0 ? (bkg.sigma / Math.sqrt(n)) * area * toMjy * Math.sqrt(1 + n / Math.max(1, bkg.n)) : NaN;
  const fluxErr = Number.isFinite(flux) ? Math.hypot(statErr, FLUX_FLOOR * flux) : NaN;
  const edge = Math.min(lx, ly, c.nx - 1 - lx, c.ny - 1 - ly);
  const good = Number.isFinite(flux) && Number.isFinite(fluxErr) && !outside && n >= 0.6 * nominal && edge >= rout + 3;
  return {
    exposureId: c.exposure.id,
    obsId: c.header.obsId || c.exposure.obsId,
    detector: c.header.detector ?? c.exposure.detector,
    mjd: Number.isFinite(c.header.mjdAvg) ? c.header.mjdAvg : c.exposure.mjd,
    wavelength: c.wavelength,
    bandwidth: c.bandwidth,
    cubeChannel: c.cubeChannel,
    flux,
    fluxErr,
    method: 'aperture',
    flags,
    saturated: true,
    good,
    snr: statErr > 0 ? flux / statErr : NaN,
  };
}

/**
 * wingCentroid recomputes its ring background only after the centre moved this far (px). On the
 * Barnard's Star bundle 0.1 px keeps every per-visit mean position within 0.003 arcsec of recomputing
 * it on every iteration (0.25 px: up to 0.011 arcsec) at about half the cost.
 */
export const BKG_RECOMPUTE_PX = 0.1;

/**
 * Centroid of a saturated star from its wings: iteratively re-centred, intensity-weighted mean
 * position of the pixels between rin and rout (1.5-5 px) from the current centre, skipping NaN,
 * OVERFLOW/BLOOM and other bad pixels. For a symmetric PSF the fixed point is the star's centre.
 */
export function wingCentroid(c: NativeCutout, pos: SkyPos, opts?: { rin?: number; rout?: number }): { ra: number; dec: number; ok: boolean; n: number; snr: number } | null {
  const rin = opts?.rin ?? 1.5;
  const rout = opts?.rout ?? 5;
  const [sx, sy] = localPix(c, pos);
  if (!(sx >= rout && sy >= rout && sx <= c.nx - 1 - rout && sy <= c.ny - 1 - rout)) return null;
  let xc = sx;
  let yc = sy;
  let nUsed = 0;
  let nominal = 0;
  let snr = NaN;
  // The sigma-clipped ring background is most of the cost and hardly changes while the centre
  // creeps: recompute it only after the centre has moved more than BKG_RECOMPUTE_PX since the last time.
  let bkg: { median: number; sigma: number; n: number } | null = null;
  let bx = NaN;
  let by = NaN;
  for (let it = 0; it < 60; it++) {
    if (!bkg || Math.hypot(xc - bx, yc - by) > BKG_RECOMPUTE_PX) {
      bkg = ringBackground(c, xc, yc, Math.max(7, rout + 2), Math.max(11, rout + 6));
      bx = xc;
      by = yc;
    }
    const b0 = Number.isFinite(bkg.median) ? bkg.median : 0;
    let sw = 0;
    let swx = 0;
    let swy = 0;
    nUsed = 0;
    nominal = 0;
    for (let j = Math.floor(yc - rout); j <= Math.ceil(yc + rout); j++) {
      for (let i = Math.floor(xc - rout); i <= Math.ceil(xc + rout); i++) {
        const d = Math.hypot(i - xc, j - yc);
        if (d < rin || d > rout) continue;
        nominal++;
        if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) continue;
        const k = j * c.nx + i;
        if (!usablePix(c, k, WING_BAD_MASK)) continue;
        const w = Math.max(0, pixValue(c, k) - b0);
        nUsed++;
        sw += w;
        swx += w * i;
        swy += w * j;
      }
    }
    if (!(sw > 0)) return null;
    snr = Number.isFinite(bkg.sigma) && bkg.sigma > 0 ? sw / (bkg.sigma * Math.sqrt(nUsed)) : NaN;
    const nx = swx / sw;
    const ny = swy / sw;
    // Damped update: for a steep profile the ring mean can overshoot the true shift.
    const dx = 0.7 * (nx - xc);
    const dy = 0.7 * (ny - yc);
    xc += dx;
    yc += dy;
    if (Math.hypot(xc - sx, yc - sy) > 3) break;
    if (Math.hypot(dx, dy) < 1e-3) break;
  }
  const [ra, dec] = pixToSky(c.header.wcs, xc + c.x0, yc + c.y0);
  const ok = Math.hypot(xc - sx, yc - sy) <= 3 && nUsed >= 0.6 * nominal && snr >= 5;
  return { ra, dec, ok, n: nUsed, snr };
}

/**
 * Radius (px) of the saturated core around `pos`: the largest radius whose half-pixel-wide ring is
 * at least half NaN or OVERFLOW/BLOOM. Bleed trails (a few bad pixels in a line) do not count.
 * 0 when the core is fine.
 */
export function saturationRadius(c: NativeCutout, pos: SkyPos, maxR = 8): number {
  const [lx, ly] = localPix(c, pos);
  const bins = Math.ceil(maxR / 0.5);
  const bad = new Array<number>(bins).fill(0);
  const all = new Array<number>(bins).fill(0);
  for (let j = Math.floor(ly - maxR); j <= Math.ceil(ly + maxR); j++) {
    for (let i = Math.floor(lx - maxR); i <= Math.ceil(lx + maxR); i++) {
      if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) continue;
      const d = Math.hypot(i - lx, j - ly);
      if (d >= maxR) continue;
      const b = Math.floor(d / 0.5);
      const k = j * c.nx + i;
      all[b]++;
      if (!Number.isFinite(c.image[k]) || (c.flags && c.flags[k] & FLAG_MASKS.saturation)) bad[b]++;
    }
  }
  let r = 0;
  for (let b = 0; b < bins; b++) if (all[b] > 0 && bad[b] >= 0.5 * all[b]) r = (b + 1) * 0.5;
  return r;
}

/** Wing rings for a saturated target whose cores reach `satR` px: photometry and centroid radii. */
export function wingRings(satR: number): { phot: { rin: number; rout: number }; cen: { rin: number; rout: number } } {
  const pin = Math.max(2, satR + 1);
  const cin = Math.max(1.5, satR + 0.5);
  return { phot: { rin: pin, rout: pin + 2.5 }, cen: { rin: cin, rout: Math.max(5, cin + 3.5) } };
}

// ---------------------------------------------------------------------------------------------
// Per-visit aggregation and motion

export interface PosSample {
  visit: number;
  mjd: number;
  ra: number;
  dec: number;
  /** 1-sigma per-axis error of this single position, arcsec. */
  err: number;
  detector?: number;
}

export interface VisitOffset {
  visit: number;
  mjd: number;
  n: number;
  /** Mean position of the visit. */
  ra: number;
  dec: number;
  /** Offset east (RA cos Dec) and north from the first usable visit's mean, arcsec. */
  dRa: number;
  dDec: number;
  /** 1-sigma per-axis error of the visit mean, arcsec (from the scatter, floored). */
  err: number;
}

/**
 * Average single-exposure positions per visit. Positions more than 3.5 robust sigma from the visit
 * median (per axis) are dropped. The error of a visit mean is max(scatter / sqrt(n), the
 * single-position error / sqrt(n), floor). Visits with fewer than `minPerVisit` positions are dropped.
 */
export function aggregateVisits(samples: PosSample[], opts?: { minPerVisit?: number; floorArcsec?: number }): VisitOffset[] {
  const minN = opts?.minPerVisit ?? 3;
  const floor = opts?.floorArcsec ?? 0.05;
  const ok = samples.filter((s) => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.mjd));
  if (ok.length === 0) return [];
  const ra0 = ok[0].ra;
  const dec0 = ok[0].dec;
  const byVisit = new Map<number, PosSample[]>();
  for (const s of ok) {
    const l = byVisit.get(s.visit);
    if (l) l.push(s);
    else byVisit.set(s.visit, [s]);
  }
  const raw: { visit: number; mjd: number; n: number; xi: number; eta: number; err: number }[] = [];
  for (const [visit, list] of byVisit) {
    const xy = list.map((s) => ({ s, p: tanProject(ra0, dec0, s.ra, s.dec) }));
    const mx = median(xy.map((q) => q.p[0]));
    const my = median(xy.map((q) => q.p[1]));
    const madx = 1.4826 * median(xy.map((q) => Math.abs(q.p[0] - mx)));
    const mady = 1.4826 * median(xy.map((q) => Math.abs(q.p[1] - my)));
    const keep = xy.filter(
      (q) => (!(madx > 0) || Math.abs(q.p[0] - mx) <= 3.5 * madx) && (!(mady > 0) || Math.abs(q.p[1] - my) <= 3.5 * mady),
    );
    const n = keep.length;
    if (n < minN) continue;
    const mean = (f: (q: (typeof keep)[number]) => number) => keep.reduce((a, q) => a + f(q), 0) / n;
    const xi = mean((q) => q.p[0]);
    const eta = mean((q) => q.p[1]);
    const mjd = mean((q) => q.s.mjd);
    const sd = n > 1 ? Math.sqrt(keep.reduce((a, q) => a + (q.p[0] - xi) ** 2 + (q.p[1] - eta) ** 2, 0) / (2 * (n - 1))) : NaN;
    const single = median(keep.map((q) => q.s.err));
    const err = Math.max(Number.isFinite(sd) ? sd / Math.sqrt(n) : 0, Number.isFinite(single) ? single / Math.sqrt(n) : 0, floor);
    raw.push({ visit, mjd, n, xi, eta, err });
  }
  raw.sort((a, b) => a.mjd - b.mjd);
  if (raw.length === 0) return [];
  const first = raw[0];
  return raw.map((r) => {
    const [ra, dec] = tanDeproject(ra0, dec0, r.xi, r.eta);
    return { visit: r.visit, mjd: r.mjd, n: r.n, ra, dec, dRa: r.xi - first.xi, dDec: r.eta - first.eta, err: r.err };
  });
}

/**
 * Proper motion from per-visit mean positions. Uses fitMotion (with a known parallax removed);
 * when only two visits exist fitMotion reports infinite errors, so the formal error from the two
 * visit means is used instead (and `twoPoint` says so). Units: mas/yr.
 */
export function motionFromVisits(visits: VisitOffset[], parallaxMas?: number): (MotionFit & { twoPoint: boolean }) | null {
  if (visits.length < 2) return null;
  const pts = visits.map((v) => ({ mjd: v.mjd, ra: v.ra, dec: v.dec, err: v.err }));
  const fit = fitMotion(pts, parallaxMas ? { fixedParallaxMas: parallaxMas } : undefined);
  if (!Number.isFinite(fit.total)) return null;
  let twoPoint = false;
  if (!Number.isFinite(fit.totalErr)) {
    // Formal weighted least-squares slope error per axis, not scaled by chi2 (it is 0 for two points).
    let sw = 0;
    let swt = 0;
    for (const v of visits) {
      const w = 1 / (v.err * v.err);
      sw += w;
      swt += w * v.mjd;
    }
    const tm = swt / sw;
    let stt = 0;
    for (const v of visits) stt += ((v.mjd - tm) / 365.25) ** 2 / (v.err * v.err);
    const e = (1 / Math.sqrt(stt)) * 1000;
    fit.pmRaErr = e;
    fit.pmDecErr = e;
    fit.totalErr = e;
    twoPoint = true;
  }
  return { ...fit, twoPoint };
}

/** Compass point (8 directions) of a motion vector given east and north components. */
export function compassDirection(east: number, north: number): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  const pa = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return dirs[Math.round(pa / 45) % 8];
}

/** Position angle east of north (degrees, 0..360) of a vector. */
export function positionAngle(east: number, north: number): number {
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/** Significance rule for motion: total > 3 x max(median control total, error). Same as the research panel. */
export function motionSignificant(total: number, totalErr: number, controls: { total: number }[]): { significant: boolean; threshold: number; controlMedian: number; ratio: number } {
  const v = motionVerdict(total, totalErr, controls);
  return { significant: v.significant, threshold: v.threshold, controlMedian: v.controlMedian, ratio: v.ratio };
}

export interface BrightnessVerdict {
  /** ratio - 1 (negative = fainter). */
  change: number;
  /** max(ratio error, median |control ratio - 1|, 2 %). */
  floor: number;
  controlMedianChange: number;
  significant: boolean;
  /** |change| / floor. */
  sigma: number;
  /**
   * Not significant and too noisy for "it stayed the same within X %" to mean anything: the
   * 3-sigma limit would be above 50 % (this covers errors above 50 % and changes smaller than a
   * large error).
   */
  tooNoisy: boolean;
}

/** Above this 3-sigma limit (fraction) a non-significant ratio reads "too noisy to tell". */
export const TOO_NOISY_LIMIT = 0.5;

/** A brightness change is significant when |ratio - 1| > 3 x max(error, typical comparison-star change, 2 %). */
export function brightnessVerdict(ratio: number, ratioErr: number, controlRatios: number[]): BrightnessVerdict {
  const cm = median(controlRatios.map((r) => Math.abs(r - 1)));
  const err = Number.isFinite(ratioErr) ? ratioErr : Infinity;
  const floor = Math.max(err, Number.isFinite(cm) ? cm : 0, 0.02);
  const change = ratio - 1;
  const sigma = Math.abs(change) / floor;
  const significant = Number.isFinite(ratio) && Number.isFinite(floor) && sigma > 3;
  const tooNoisy = !significant && (!Number.isFinite(ratio) || !(3 * floor <= TOO_NOISY_LIMIT));
  return { change, floor, controlMedianChange: cm, significant, sigma, tooNoisy };
}

/**
 * Robust combination of per-channel ratios (B / A): rows with a relative error above 30 % are
 * dropped, then rows more than 3 robust sigma from the median, then an inverse-variance mean whose
 * error is max(formal, scatter / sqrt(n)). Falls back to all rows when the cuts leave fewer than 3.
 */
export function robustRatio(rows: { ratio: number; ratioErr: number }[]): { ratio: number; ratioErr: number; n: number } {
  let r = rows.filter((x) => Number.isFinite(x.ratio) && Number.isFinite(x.ratioErr) && x.ratioErr > 0);
  const precise = r.filter((x) => x.ratioErr <= 0.3 * Math.abs(x.ratio));
  if (precise.length >= 3) r = precise;
  if (r.length >= 4) {
    const med = median(r.map((x) => x.ratio));
    const mad = 1.4826 * median(r.map((x) => Math.abs(x.ratio - med)));
    if (mad > 0) {
      const kept = r.filter((x) => Math.abs(x.ratio - med) <= 3 * Math.max(mad, x.ratioErr));
      if (kept.length >= 3) r = kept;
    }
  }
  if (r.length === 0) return { ratio: NaN, ratioErr: NaN, n: 0 };
  let sw = 0;
  let swr = 0;
  for (const x of r) {
    const w = 1 / (x.ratioErr * x.ratioErr);
    sw += w;
    swr += w * x.ratio;
  }
  const mean = swr / sw;
  const formal = 1 / Math.sqrt(sw);
  if (r.length < 2) return { ratio: mean, ratioErr: formal, n: 1 };
  const m = r.reduce((a, x) => a + x.ratio, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, x) => a + (x.ratio - m) ** 2, 0) / (r.length - 1));
  return { ratio: mean, ratioErr: Math.max(formal, sd / Math.sqrt(r.length)), n: r.length };
}

// ---------------------------------------------------------------------------------------------
// Colour-dependent change: the like-with-like ratio per wavelength range

/** Cube channels 1-51 are arrays 1-3 (0.75-2.4 um); 52-102 are arrays 4-6 (2.4-5.0 um). */
export const SHORT_MAX_CUBE_CHANNEL = 51;

/** Approximate wavelength range (um) of each detector array, for plain-language text. */
export const DETECTOR_RANGE: Record<number, [number, number]> = {
  1: [0.75, 1.1],
  2: [1.1, 1.6],
  3: [1.6, 2.4],
  4: [2.4, 3.8],
  5: [3.8, 4.4],
  6: [4.4, 5.0],
};

/** Detector array (1-6) of a cube channel (1-102, 17 per array). */
export function detectorOfCubeChannel(cubeChannel: number): number {
  return Math.min(6, Math.max(1, Math.floor((cubeChannel - 1) / 17) + 1));
}

export interface CombinedRatio {
  ratio: number;
  ratioErr: number;
  n: number;
}

export interface DetectorRatio extends CombinedRatio {
  detector: number;
}

type Row = { cubeChannel: number; ratio: number; ratioErr: number };

/** Robust ratios for short (0.75-2.4 um) and long (2.4-5.0 um) channels separately, and per detector array. */
export function bandRatios(rows: Row[]): { short: CombinedRatio; long: CombinedRatio; perDetector: DetectorRatio[] } {
  const short = robustRatio(rows.filter((r) => r.cubeChannel > 0 && r.cubeChannel <= SHORT_MAX_CUBE_CHANNEL));
  const long = robustRatio(rows.filter((r) => r.cubeChannel > SHORT_MAX_CUBE_CHANNEL));
  const perDetector: DetectorRatio[] = [];
  for (let d = 1; d <= 6; d++) {
    const sub = rows.filter((r) => r.cubeChannel > 0 && detectorOfCubeChannel(r.cubeChannel) === d);
    if (!sub.length) continue;
    const c = robustRatio(sub);
    if (Number.isFinite(c.ratio)) perDetector.push({ detector: d, ...c });
  }
  return { short, long, perDetector };
}

/** Too few channels for a band number to mean anything. */
export const MIN_BAND_CHANNELS = 3;

export interface ColourSplit {
  short: CombinedRatio;
  long: CombinedRatio;
  /** Verdicts with the comparison stars of the same band and, for saturated targets, the ring systematic. */
  vShort: BrightnessVerdict;
  vLong: BrightnessVerdict;
  /** short - long, and its error from the two floors. */
  diff: number;
  diffErr: number;
  /** The two ranges changed differently (|diff| > 3 x diffErr) and at least one changed significantly. */
  colourDependent: boolean;
}

/**
 * Does the change depend on wavelength? Compares the short- and long-wavelength ratios, each with an
 * error floor from its own comparison stars (and, when given, the spread between two wing rings).
 */
export function colourSplit(
  short: CombinedRatio,
  long: CombinedRatio,
  ctrlShort: number[],
  ctrlLong: number[],
  ringSpread?: { short: number; long: number },
): ColourSplit | null {
  if (!(short.n >= MIN_BAND_CHANNELS && long.n >= MIN_BAND_CHANNELS)) return null;
  if (!Number.isFinite(short.ratio) || !Number.isFinite(long.ratio)) return null;
  const eS = Math.hypot(short.ratioErr, ringSpread?.short ?? 0);
  const eL = Math.hypot(long.ratioErr, ringSpread?.long ?? 0);
  const vShort = brightnessVerdict(short.ratio, eS, ctrlShort);
  const vLong = brightnessVerdict(long.ratio, eL, ctrlLong);
  const diff = short.ratio - long.ratio;
  const diffErr = Math.hypot(vShort.floor, vLong.floor);
  const colourDependent = Math.abs(diff) > 3 * diffErr && (vShort.significant || vLong.significant) && !vShort.tooNoisy && !vLong.tooNoisy;
  return { short, long, vShort, vLong, diff, diffErr, colourDependent };
}

/**
 * The faintest-going and brightest-going wavelength ranges, for a plain sentence: start from the
 * detector with the lowest (highest) ratio and take in neighbouring detectors that agree with it.
 */
export function colourExtremes(perDetector: DetectorRatio[]): { lo: { range: [number, number]; ratio: number }; hi: { range: [number, number]; ratio: number } } | null {
  const ds = perDetector.filter((d) => d.n >= MIN_BAND_CHANNELS && Number.isFinite(d.ratio)).sort((a, b) => a.detector - b.detector);
  if (ds.length < 2) return null;
  const grow = (k: number) => {
    // A neighbour joins when it is itself well measured and agrees with the extreme array.
    const agrees = (j: number) => ds[j].ratioErr <= 0.08 && Math.abs(ds[j].ratio - ds[k].ratio) <= Math.max(0.06, 2 * Math.hypot(ds[j].ratioErr, ds[k].ratioErr));
    let a = k;
    let b = k;
    while (a > 0 && ds[a - 1].detector === ds[a].detector - 1 && agrees(a - 1)) a--;
    while (b < ds.length - 1 && ds[b + 1].detector === ds[b].detector + 1 && agrees(b + 1)) b++;
    const group = ds.slice(a, b + 1);
    let sw = 0;
    let swr = 0;
    for (const g of group) {
      const w = 1 / Math.max(1e-6, g.ratioErr) ** 2;
      sw += w;
      swr += w * g.ratio;
    }
    return { range: [DETECTOR_RANGE[group[0].detector][0], DETECTOR_RANGE[group[group.length - 1].detector][1]] as [number, number], ratio: swr / sw };
  };
  let lo = 0;
  let hi = 0;
  ds.forEach((d, k) => {
    if (d.ratio < ds[lo].ratio) lo = k;
    if (d.ratio > ds[hi].ratio) hi = k;
  });
  if (lo === hi) return null;
  return { lo: grow(lo), hi: grow(hi) };
}

/** Visits with at least max(minAbs, frac x the best visit's count) good points, in time order. */
export function wellCoveredVisits(points: PhotPoint[], opts?: { minAbs?: number; frac?: number }): number[] {
  const counts = new Map<number, number>();
  for (const p of points) if (p.good && p.visit !== undefined && p.cubeChannel > 0) counts.set(p.visit, (counts.get(p.visit) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const need = Math.max(opts?.minAbs ?? 6, (opts?.frac ?? 0.3) * max);
  return [...counts.entries()].filter(([, n]) => n >= need).map(([v]) => v).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Comparison stars

export interface ControlStar {
  id: string;
  label: string;
  ra: number;
  dec: number;
  /** Catalogue astrometry when from Gaia (for propagation), else a fixed position. */
  src?: { ra: number; dec: number; epoch: number; pmRa?: number; pmDec?: number; parallax?: number };
  mag?: number;
  origin: 'gaia' | 'peak';
}

/** Position of a target or control at a date (propagated when it has proper motion). */
export function positionAt(src: { ra: number; dec: number; epoch: number; pmRa?: number; pmDec?: number; parallax?: number } | undefined, fixed: SkyPos, mjd: number): SkyPos {
  if (src && (src.pmRa || src.pmDec || src.parallax)) return propagateSource(src, mjd);
  return fixed;
}

function insideWindow(c: NativeCutout, pos: SkyPos, margin: number): boolean {
  const [lx, ly] = localPix(c, pos);
  return lx >= margin && ly >= margin && lx <= c.nx - 1 - margin && ly <= c.ny - 1 - margin;
}

/**
 * Up to `max` bright, unsaturated, isolated Gaia stars at least `minSepArcsec` from the target at
 * every epoch and inside at least half of the cutouts (with room for the background annulus).
 */
export function selectGaiaControls(
  gaia: CatalogSource[],
  cutouts: NativeCutout[],
  targetAt: (mjd: number) => SkyPos,
  opts?: { max?: number; minSepArcsec?: number; magRange?: [number, number] },
): ControlStar[] {
  const max = opts?.max ?? 5;
  const minSep = opts?.minSepArcsec ?? 20;
  const [mLo, mHi] = opts?.magRange ?? [9.5, 15.5];
  if (cutouts.length === 0) return [];
  const sample = cutouts.filter((_, i) => i % Math.max(1, Math.floor(cutouts.length / 40)) === 0);
  const mjds = sample.map((c) => c.header.mjdAvg);
  const out: ControlStar[] = [];
  const cands = gaia.filter((s) => s.mag !== undefined && s.mag >= mLo && s.mag <= mHi).sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));
  for (const s of cands) {
    if (out.length >= max) break;
    const src = { ra: s.ra, dec: s.dec, epoch: s.epoch, pmRa: s.pmRa, pmDec: s.pmDec };
    const far = mjds.every((m) => {
      const p = propagateSource(src, m);
      const t = targetAt(m);
      return angularSepArcsec(p.ra, p.dec, t.ra, t.dec) >= minSep;
    });
    if (!far) continue;
    // Isolation: no other Gaia star within 2.5 mag of it closer than 15 arcsec.
    const crowded = gaia.some((o) => o !== s && (o.mag ?? 99) < (s.mag ?? 0) + 2.5 && angularSepArcsec(o.ra, o.dec, s.ra, s.dec) < 15);
    if (crowded) continue;
    const inside = sample.filter((c) => insideWindow(c, propagateSource(src, c.header.mjdAvg), 9)).length;
    if (inside < 0.5 * sample.length) continue;
    out.push({ id: `gaia:${s.id}`, label: `Gaia ${s.id} (G ${s.mag?.toFixed(1)})`, ra: s.ra, dec: s.dec, src, mag: s.mag, origin: 'gaia' });
  }
  return out;
}

/**
 * Without a catalogue: the brightest compact peaks that recur across the exposures. Each sampled
 * cutout gives its local maxima above 15 sigma (not saturated, away from the edge); detections
 * within 6 arcsec are merged, kept when seen in at least 30 % of the sampled cutouts, and ranked by
 * median peak significance. Peaks closer than `minSepArcsec` to the target at any epoch are skipped.
 */
export function selectPeakControls(
  cutouts: NativeCutout[],
  targetAt: (mjd: number) => SkyPos,
  opts?: { max?: number; minSepArcsec?: number; sample?: number },
): ControlStar[] {
  const max = opts?.max ?? 5;
  const minSep = opts?.minSepArcsec ?? 20;
  const want = opts?.sample ?? 40;
  if (cutouts.length === 0) return [];
  const step = Math.max(1, Math.floor(cutouts.length / want));
  const sample = cutouts.filter((_, i) => i % step === 0);
  const clusters: { ra: number; dec: number; sig: number[]; n: number }[] = [];
  for (const c of sample) {
    const vals: number[] = [];
    for (let k = 0; k < c.image.length; k++) if (usablePix(c, k, WING_BAD_MASK)) vals.push(pixValue(c, k));
    const st = sigmaClippedStats(vals);
    if (!(st.sigma > 0)) continue;
    const t = targetAt(c.header.mjdAvg);
    for (let j = 9; j < c.ny - 9; j++) {
      for (let i = 9; i < c.nx - 9; i++) {
        const k = j * c.nx + i;
        if (!usablePix(c, k, WING_BAD_MASK)) continue;
        const v = pixValue(c, k) - st.median;
        if (v < 15 * st.sigma) continue;
        let isMax = true;
        let sat = false;
        for (let dj = -2; dj <= 2 && isMax; dj++) {
          for (let di = -2; di <= 2; di++) {
            if (!di && !dj) continue;
            const kk = (j + dj) * c.nx + (i + di);
            const w = pixValue(c, kk);
            if (!Number.isFinite(w) || (c.flags && c.flags[kk] & FLAG_MASKS.saturation)) sat = true;
            if (w - st.median > v) {
              isMax = false;
              break;
            }
          }
        }
        if (!isMax || sat) continue;
        const [ra, dec] = pixToSky(c.header.wcs, i + c.x0, j + c.y0);
        if (angularSepArcsec(ra, dec, t.ra, t.dec) < minSep) continue;
        const cl = clusters.find((q) => angularSepArcsec(q.ra, q.dec, ra, dec) < 6);
        if (cl) {
          cl.sig.push(v / st.sigma);
          cl.n++;
        } else clusters.push({ ra, dec, sig: [v / st.sigma], n: 1 });
      }
    }
  }
  return clusters
    .filter((q) => q.n >= 0.3 * sample.length)
    .sort((a, b) => median(b.sig) - median(a.sig))
    .slice(0, max)
    .map((q, i) => ({ id: `peak:${i}`, label: `Field star ${i + 1}`, ra: q.ra, dec: q.dec, origin: 'peak' as const }));
}

/** Gaia stars that come within `radiusArcsec` of the target at any of the given dates (closest approach first). */
export function nearNeighbours(
  gaia: CatalogSource[],
  targetAt: (mjd: number) => SkyPos,
  mjds: number[],
  radiusArcsec = 8,
  targetIds: string[] = [],
): { source: CatalogSource; sepArcsec: number; mjd: number }[] {
  const out: { source: CatalogSource; sepArcsec: number; mjd: number }[] = [];
  for (const s of gaia) {
    if (targetIds.includes(s.id)) continue;
    let best = Infinity;
    let bestMjd = NaN;
    for (const m of mjds) {
      const p = propagateSource({ ra: s.ra, dec: s.dec, epoch: s.epoch, pmRa: s.pmRa, pmDec: s.pmDec }, m);
      const t = targetAt(m);
      const d = angularSepArcsec(p.ra, p.dec, t.ra, t.dec);
      if (d < best) {
        best = d;
        bestMjd = m;
      }
    }
    // Skip the target itself (Gaia's entry for it stays within ~1 arcsec of the propagated position).
    if (best < 1.0) continue;
    if (best <= radiusArcsec) out.push({ source: s, sepArcsec: best, mjd: bestMjd });
  }
  return out.sort((a, b) => a.sepArcsec - b.sepArcsec);
}

/** Is this a cold object whose motion should be measured on arrays 5 and 6 only? */
export function isColdTarget(target: TargetInfo | null, snrByDetector: Map<number, number[]>): boolean {
  const sp = target?.spectralType ?? '';
  if (/^Y/i.test(sp.trim())) return true;
  const med = (d: number[]) => median(d.flatMap((k) => snrByDetector.get(k) ?? []));
  const short = med([1, 2, 3, 4]);
  const long = med([5, 6]);
  return Number.isFinite(long) && long >= 5 && (!Number.isFinite(short) || short < 3);
}

/** Single-exposure centroid error (arcsec): PSF FWHM / S/N in quadrature with a 0.2 arcsec floor. */
export function centroidErr(fwhmArcsec: number | undefined, snr: number): number {
  const f = fwhmArcsec && fwhmArcsec > 0 ? fwhmArcsec : 8;
  return Math.hypot(0.2, f / Math.max(1, Number.isFinite(snr) ? snr : 1));
}
