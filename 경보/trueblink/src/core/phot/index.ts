// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Photometry and centroids on NATIVE detector pixels of one Level-2 exposure.
//
// Why native pixels: the SPHEREx PSF is undersampled (FWHM 1.2-1.5 pixels of 6.15 arcsec), so a
// star's light falls on only a few pixels and the brightest pixel can change by a factor ~3 from one
// exposure to the next, depending on where the star sits inside a pixel. Resampling to another grid
// smears and biases that. Summing the light in a circle on the original pixels does not care where
// inside a pixel the star sits, as long as the circle is a few FWHM wide.
//
// Units: IMAGE is surface brightness in MJy/sr. A pixel of solid angle Omega [arcsec^2] holding
// S [MJy/sr] carries F [uJy] = 23.5044 * Omega * S. Fluxes returned here are in mJy.
//
// Like with like: every SPHEREx exposure sees a source at a different wavelength (linear variable
// filter), so buildSpectrum, matchedRatio and lightCurve always group by spectral cube channel
// before comparing dates.

import type { NativeCutout, PhotPoint, SkyPos } from '../types';
import { FLAG_BITS, FLAG_MASKS, UJY_PER_MJYSR_ARCSEC2 } from '../types';
import { pixelAreaArcsec2, pixToSky, skyToPix } from '../wcs';

/** Pipeline catalogue errors add 3 % of the flux in quadrature (calibration / PSF floor). */
const FLUX_ERROR_FLOOR = 0.03;
/** The target must sit at least this many pixels from the window edge for a "good" measurement. */
const EDGE_MARGIN_PIX = 4;
const SAT_MASK = FLAG_MASKS.saturation; // OVERFLOW (bit 1) | BLOOM (bit 26)

/**
 * Exact area of the intersection of the circle x^2 + y^2 <= r^2 with the rectangle
 * [x0, x1] x [y0, y1]. Integrates the clipped chord length column by column using the closed-form
 * antiderivative of sqrt(r^2 - x^2), split at the points where the circle crosses y0 or y1.
 */
function circleRectArea(r: number, x0: number, x1: number, y0: number, y1: number): number {
  const a = Math.max(x0, -r);
  const b = Math.min(x1, r);
  if (a >= b || y0 >= y1) return 0;
  const r2 = r * r;
  const s = (x: number): number => Math.sqrt(Math.max(0, r2 - x * x));
  // Antiderivative of s(x).
  const S = (x: number): number => {
    const c = Math.max(-r, Math.min(r, x));
    return 0.5 * (c * s(c) + r2 * Math.asin(c / r));
  };
  const cuts = [a, b];
  for (const y of [y0, y1]) {
    if (Math.abs(y) < r) {
      const xc = Math.sqrt(r2 - y * y);
      for (const x of [-xc, xc]) if (x > a && x < b) cuts.push(x);
    }
  }
  cuts.sort((p, q) => p - q);
  let area = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const u = cuts[k];
    const v = cuts[k + 1];
    if (v <= u) continue;
    const m = 0.5 * (u + v);
    const sm = s(m);
    const topIsCircle = sm <= y1; // non-strict: a circle tangent to the edge stays below it
    const botIsCircle = -sm >= y0;
    const top = topIsCircle ? sm : y1;
    const bot = botIsCircle ? -sm : y0;
    if (top <= bot) continue;
    const intTop = topIsCircle ? S(v) - S(u) : y1 * (v - u);
    const intBot = botIsCircle ? -(S(v) - S(u)) : y0 * (v - u);
    area += intTop - intBot;
  }
  return area;
}

/**
 * Fraction of the unit pixel centred on (px, py) that lies inside the circle of radius r around
 * (cx, cy). Exact (analytic), so partial pixels at the aperture edge are weighted correctly.
 */
export function pixelCircleOverlap(cx: number, cy: number, r: number, px: number, py: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (Math.hypot(adx + 0.5, ady + 0.5) <= r) return 1;
  if (Math.hypot(Math.max(0, adx - 0.5), Math.max(0, ady - 0.5)) >= r) return 0;
  return Math.min(1, Math.max(0, circleRectArea(r, dx - 0.5, dx + 0.5, dy - 0.5, dy + 0.5)));
}

/** Error function (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
function erf(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return x < 0 ? -y : y;
}

/**
 * Fraction of a star's light that a circular aperture of radius r collects, for a Gaussian PSF of
 * the given FWHM (pixels) centred at (cx, cy), after the light is binned into whole pixels and the
 * aperture weights pixels by their area inside the circle. With an undersampled PSF this depends
 * on where inside a pixel the star sits, so it is computed for the actual position.
 */
export function gaussianEnclosedFraction(fwhmPix: number, r: number, cx: number, cy: number): number {
  const k = (fwhmPix / 2.354820045) * Math.SQRT2;
  const frac = (i: number, c: number): number => 0.5 * (erf((i + 0.5 - c) / k) - erf((i - 0.5 - c) / k));
  let ee = 0;
  for (let j = Math.floor(cy - r - 1); j <= Math.ceil(cy + r + 1); j++) {
    const fy = frac(j, cy);
    for (let i = Math.floor(cx - r - 1); i <= Math.ceil(cx + r + 1); i++) {
      const w = pixelCircleOverlap(cx, cy, r, i, j);
      if (w > 0) ee += w * frac(i, cx) * fy;
    }
  }
  return ee;
}

/** Put the k-th smallest value at a[k], smaller ones before it and larger ones after (Wirth's selection). */
function selectKth(a: Float64Array, k: number): void {
  let l = 0;
  let r = a.length - 1;
  while (l < r) {
    const x = a[k];
    let i = l;
    let j = r;
    do {
      while (a[i] < x) i++;
      while (x < a[j]) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    } while (i <= j);
    if (j < k) l = i;
    if (k < i) r = j;
  }
}

/**
 * Median of finite values. Linear-time selection instead of a full sort: the sigma-clipped ring
 * backgrounds of the measurement pass call this tens of thousands of times (it took ~6 s of main
 * thread on Barnard's Star with Array#sort and a comparator).
 */
function median(values: number[]): number {
  const n = values.length;
  if (n === 0) return NaN;
  const a = Float64Array.from(values);
  const m = n >> 1;
  selectKth(a, m);
  if (n % 2) return a[m];
  let lowMax = a[0];
  for (let i = 1; i < m; i++) if (a[i] > lowMax) lowMax = a[i];
  return 0.5 * (lowMax + a[m]);
}

/**
 * Sigma-clipped median and standard deviation (3 sigma, up to 5 rounds; sigma from the median
 * absolute deviation so one bright neighbour star cannot inflate it).
 */
export function sigmaClippedStats(values: number[], nsigma = 3, maxIter = 5): { median: number; sigma: number; n: number } {
  let v = values.filter(Number.isFinite);
  let med = median(v);
  let sig = NaN;
  for (let it = 0; it < maxIter && v.length > 2; it++) {
    med = median(v);
    sig = 1.4826 * median(v.map((x) => Math.abs(x - med)));
    if (!(sig > 0)) {
      // MAD can be zero for quantised or constant data: fall back to the standard deviation.
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      sig = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, v.length - 1));
      if (!(sig > 0)) break;
    }
    const keep = v.filter((x) => Math.abs(x - med) <= nsigma * sig);
    if (keep.length === v.length) break;
    v = keep;
  }
  if (v.length > 1) {
    med = median(v);
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    sig = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1));
  }
  return { median: med, sigma: sig, n: v.length };
}

/** Background-subtracted value of a window pixel (IMAGE - ZODI when the ZODI plane is present). */
function value(c: NativeCutout, k: number): number {
  const v = c.image[k];
  return c.zodi ? v - c.zodi[k] : v;
}

/** Local (window) pixel position of a sky position. */
function localPix(c: NativeCutout, pos: SkyPos): [number, number] {
  const [x, y] = skyToPix(c.header.wcs, pos.ra, pos.dec);
  return [x - c.x0, y - c.y0];
}

/** Sigma-clipped annulus background around a local position, excluding bad and saturated pixels. */
function annulusBackground(
  c: NativeCutout,
  lx: number,
  ly: number,
  rin: number,
  rout: number,
  badMask: number,
): { median: number; sigma: number; n: number } {
  const vals: number[] = [];
  const exclude = badMask | SAT_MASK;
  const i0 = Math.max(0, Math.floor(lx - rout));
  const i1 = Math.min(c.nx - 1, Math.ceil(lx + rout));
  const j0 = Math.max(0, Math.floor(ly - rout));
  const j1 = Math.min(c.ny - 1, Math.ceil(ly + rout));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - lx, j - ly);
      if (d < rin || d > rout) continue;
      const k = j * c.nx + i;
      if (c.flags && c.flags[k] & exclude) continue;
      const v = value(c, k);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  return sigmaClippedStats(vals);
}

function omegaOf(c: NativeCutout, lx: number, ly: number): number {
  if (Number.isFinite(c.omegaArcsec2) && c.omegaArcsec2 > 0) return c.omegaArcsec2;
  return pixelAreaArcsec2(c.header.wcs, lx + c.x0, ly + c.y0);
}

/**
 * Circular-aperture photometry at a sky position on native pixels.
 *
 * - Position: skyToPix with the full TAN-SIP WCS (propagate proper motion before calling!).
 * - Aperture: radius 2.0 px by default, partial pixels weighted by their area inside the circle.
 * - Background: sigma-clipped median of an annulus (default 4-8 px) after subtracting ZODI.
 * - Error: from VARIANCE inside the aperture when present, else from the annulus scatter, plus the
 *   uncertainty of the background level, plus 3 % of the flux in quadrature.
 * - Aperture correction: when the header gives the PSF FWHM (header.psfFwhmArcsec), the flux is
 *   divided by the fraction a Gaussian PSF of that FWHM would put in this aperture at this sub-pixel
 *   position (about 2-4 % for r = 2 px). The real SPHEREx PSF has broader wings than a Gaussian, so
 *   absolute fluxes may still be a few % low; ratios between exposures are unaffected.
 *   Pass apertureCorrection: false for the raw aperture sum.
 * - snr: flux over the statistical error only (without the 3 % floor), i.e. detection strength.
 * - saturated: OVERFLOW or BLOOM bits or NaN pixels inside the aperture (bright stars lose their core).
 * - good: finite, not saturated, no bits of `badMask` (default FLAG_MASKS.photometry) in the
 *   aperture, and the target at least 4 px from the window edge. SOURCE and OUTLIER are never bad.
 */
export function aperturePhot(
  cutout: NativeCutout,
  pos: SkyPos,
  opts?: { radiusPix?: number; annulus?: [number, number]; badMask?: number; apertureCorrection?: boolean },
): PhotPoint {
  const r = opts?.radiusPix ?? 2.0;
  const [rin, rout] = opts?.annulus ?? [4, 8];
  const badMask = opts?.badMask ?? FLAG_MASKS.photometry;
  const c = cutout;
  const [lx, ly] = localPix(c, pos);

  const bkg = annulusBackground(c, lx, ly, rin, rout, badMask);
  const bkgOk = bkg.n >= 6 && Number.isFinite(bkg.median);

  let sum = 0; // MJy/sr summed over (fractional) pixels
  let area = 0;
  let varSum = 0;
  let flags = 0;
  let nanInside = false;
  let outside = false;
  const i0 = Math.floor(lx - r - 1);
  const i1 = Math.ceil(lx + r + 1);
  const j0 = Math.floor(ly - r - 1);
  const j1 = Math.ceil(ly + r + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const w = pixelCircleOverlap(lx, ly, r, i, j);
      if (w <= 0) continue;
      if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) {
        outside = true;
        continue;
      }
      const k = j * c.nx + i;
      if (c.flags) flags |= c.flags[k];
      const v = value(c, k);
      if (!Number.isFinite(v)) {
        nanInside = true;
        continue;
      }
      sum += w * (v - (bkgOk ? bkg.median : 0));
      area += w;
      if (c.variance) {
        const vv = c.variance[k];
        if (Number.isFinite(vv) && vv >= 0) varSum += w * w * vv;
      }
    }
  }

  const omega = omegaOf(c, lx, ly);
  let toMjy = (UJY_PER_MJYSR_ARCSEC2 * omega) / 1000;
  const fwhmArcsec = c.header.psfFwhmArcsec;
  if (opts?.apertureCorrection !== false && fwhmArcsec !== undefined && fwhmArcsec > 0 && omega > 0) {
    const ee = gaussianEnclosedFraction(fwhmArcsec / Math.sqrt(omega), r, lx, ly);
    if (ee > 0.2) toMjy /= ee;
  }
  let flux = bkgOk ? sum * toMjy : NaN;
  // Statistical variance in (MJy/sr * pixel)^2: pixel noise + uncertainty of the background level.
  const bkgSig = Number.isFinite(bkg.sigma) ? bkg.sigma : NaN;
  const pixVar = c.variance ? varSum : area * bkgSig * bkgSig;
  const bkgLevelVar = bkg.n > 0 ? (area * area * bkgSig * bkgSig) / bkg.n : NaN;
  const statErr = Math.sqrt(pixVar + bkgLevelVar) * toMjy;
  let fluxErr = Math.hypot(statErr, FLUX_ERROR_FLOOR * flux);
  if (!Number.isFinite(flux)) {
    flux = NaN;
    fluxErr = NaN;
  }
  const snr = statErr > 0 ? flux / statErr : NaN;

  const saturated = (flags & SAT_MASK) !== 0 || nanInside;
  const edge = Math.min(lx, ly, c.nx - 1 - lx, c.ny - 1 - ly);
  const good =
    Number.isFinite(flux) &&
    Number.isFinite(fluxErr) &&
    !saturated &&
    !outside &&
    (flags & badMask) === 0 &&
    edge >= EDGE_MARGIN_PIX;

  const mjd = Number.isFinite(c.header.mjdAvg) ? c.header.mjdAvg : c.exposure.mjd;
  return {
    exposureId: c.exposure.id,
    obsId: c.header.obsId || c.exposure.obsId,
    detector: c.header.detector ?? c.exposure.detector,
    mjd,
    wavelength: c.wavelength,
    bandwidth: c.bandwidth,
    cubeChannel: c.cubeChannel,
    flux,
    fluxErr,
    method: 'aperture',
    flags,
    saturated,
    good,
    snr,
  };
}

/**
 * Iterative Gaussian-weighted ("windowed") centroid on background-subtracted native pixels.
 *
 * Starting at `pos`, each round computes the intensity-weighted mean pixel position with weights
 * exp(-d^2 / 2 sigma^2), sigma = 1.2 px, over pixels within `radiusPix` (default 3) of the current
 * estimate, and moves there; up to 10 rounds. Pixels with bad flags (photometry mask) are skipped.
 * ok = false when it wanders more than the radius from the start, or the star is saturated
 * (OVERFLOW/BLOOM within the radius, or NaN within 1.5 px of the centre), or S/N < 3.
 * Returns null when there is nothing usable to centroid on (off the window, no positive signal).
 */
export function centroid(
  cutout: NativeCutout,
  pos: SkyPos,
  opts?: { radiusPix?: number },
): { ra: number; dec: number; snr: number; ok: boolean } | null {
  const c = cutout;
  const R = opts?.radiusPix ?? 3;
  const sigma = 1.2;
  const [sx, sy] = localPix(c, pos);
  if (!(sx >= 0 && sy >= 0 && sx <= c.nx - 1 && sy <= c.ny - 1)) return null;
  const badMask = FLAG_MASKS.photometry & ~SAT_MASK;
  const bkg = annulusBackground(c, sx, sy, Math.max(4, R + 1), Math.max(8, R + 5), FLAG_MASKS.photometry);
  const b0 = bkg.n >= 6 && Number.isFinite(bkg.median) ? bkg.median : 0;

  let xc = sx;
  let yc = sy;
  for (let it = 0; it < 10; it++) {
    let sw = 0;
    let swx = 0;
    let swy = 0;
    for (let j = Math.max(0, Math.floor(yc - R)); j <= Math.min(c.ny - 1, Math.ceil(yc + R)); j++) {
      for (let i = Math.max(0, Math.floor(xc - R)); i <= Math.min(c.nx - 1, Math.ceil(xc + R)); i++) {
        const d2 = (i - xc) ** 2 + (j - yc) ** 2;
        if (d2 > R * R) continue;
        const k = j * c.nx + i;
        if (c.flags && c.flags[k] & badMask) continue;
        const v = value(c, k) - b0;
        if (!Number.isFinite(v)) continue;
        const w = Math.exp(-d2 / (2 * sigma * sigma)) * v;
        sw += w;
        swx += w * i;
        swy += w * j;
      }
    }
    if (!(sw > 0)) return null;
    const nx = swx / sw;
    const ny = swy / sw;
    const step = Math.hypot(nx - xc, ny - yc);
    xc = nx;
    yc = ny;
    if (Math.hypot(xc - sx, yc - sy) > R) break;
    if (step < 1e-5) break;
  }

  // Saturation and S/N in a circle of radius R around the final position.
  let saturated = false;
  let flux = 0;
  let noiseVar = 0;
  let npix = 0;
  for (let j = Math.max(0, Math.floor(yc - R)); j <= Math.min(c.ny - 1, Math.ceil(yc + R)); j++) {
    for (let i = Math.max(0, Math.floor(xc - R)); i <= Math.min(c.nx - 1, Math.ceil(xc + R)); i++) {
      const d2 = (i - xc) ** 2 + (j - yc) ** 2;
      if (d2 > R * R) continue;
      const k = j * c.nx + i;
      if (c.flags && c.flags[k] & SAT_MASK) saturated = true;
      const v = value(c, k);
      if (!Number.isFinite(v)) {
        if (d2 <= 1.5 * 1.5) saturated = true;
        continue;
      }
      flux += v - b0;
      npix++;
      if (c.variance && Number.isFinite(c.variance[k])) noiseVar += c.variance[k];
    }
  }
  if (!c.variance) noiseVar = npix * (Number.isFinite(bkg.sigma) ? bkg.sigma ** 2 : NaN);
  const snr = noiseVar > 0 ? flux / Math.sqrt(noiseVar) : NaN;
  const wandered = Math.hypot(xc - sx, yc - sy) > R;
  const [ra, dec] = pixToSky(c.header.wcs, xc + c.x0, yc + c.y0);
  return { ra, dec, snr, ok: !wandered && !saturated && snr >= 3 };
}

interface Mean {
  mean: number;
  err: number;
  n: number;
}

/** Inverse-variance mean; error = max(formal error, scatter / sqrt(n)) so outliers are not hidden. */
function ivMean(values: { flux: number; fluxErr: number }[]): Mean {
  const v = values.filter((p) => Number.isFinite(p.flux) && Number.isFinite(p.fluxErr) && p.fluxErr > 0);
  if (v.length === 0) return { mean: NaN, err: NaN, n: 0 };
  let sw = 0;
  let swf = 0;
  for (const p of v) {
    const w = 1 / (p.fluxErr * p.fluxErr);
    sw += w;
    swf += w * p.flux;
  }
  const mean = swf / sw;
  const formal = 1 / Math.sqrt(sw);
  if (v.length < 2) return { mean, err: formal, n: 1 };
  const m = v.reduce((s, p) => s + p.flux, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, p) => s + (p.flux - m) ** 2, 0) / (v.length - 1));
  return { mean, err: Math.max(formal, sd / Math.sqrt(v.length)), n: v.length };
}

function usable(p: PhotPoint): boolean {
  return p.good && p.cubeChannel > 0 && Number.isFinite(p.flux) && Number.isFinite(p.fluxErr) && p.fluxErr > 0;
}

function groupBy<K, T>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const meanOf = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Spectrum from many exposures: good points binned by all-sky cube channel (1..102; 0 = off-nominal
 * pixels, skipped), inverse-variance mean per channel, sorted by wavelength. Mixing dates is fine
 * for a constant source; for a variable one, build the spectrum per visit.
 */
export function buildSpectrum(
  points: PhotPoint[],
): { wavelength: number; flux: number; fluxErr: number; n: number; cubeChannel: number }[] {
  const out: { wavelength: number; flux: number; fluxErr: number; n: number; cubeChannel: number }[] = [];
  for (const [ch, pts] of groupBy(points.filter(usable), (p) => p.cubeChannel)) {
    const m = ivMean(pts);
    if (m.n === 0) continue;
    out.push({ wavelength: meanOf(pts.map((p) => p.wavelength)), flux: m.mean, fluxErr: m.err, n: m.n, cubeChannel: ch });
  }
  return out.sort((a, b) => a.wavelength - b.wavelength);
}

/**
 * Like-with-like variability between two visits: for every cube channel measured (good points) in
 * both visits, ratio = mean flux in visitB / mean flux in visitA, with errors propagated in
 * quadrature. Because both numbers are at the same wavelength, the source's colour cancels and a
 * ratio != 1 means real change. Points need their `visit` set. Channels whose visit-A mean is not
 * positive are skipped (a ratio to a non-detection is meaningless).
 */
export function matchedRatio(
  points: PhotPoint[],
  visitA: number,
  visitB: number,
): { cubeChannel: number; wavelength: number; ratio: number; ratioErr: number }[] {
  const good = points.filter(usable);
  const a = groupBy(good.filter((p) => p.visit === visitA), (p) => p.cubeChannel);
  const b = groupBy(good.filter((p) => p.visit === visitB), (p) => p.cubeChannel);
  const out: { cubeChannel: number; wavelength: number; ratio: number; ratioErr: number }[] = [];
  for (const [ch, pa] of a) {
    const pb = b.get(ch);
    if (!pb) continue;
    const ma = ivMean(pa);
    const mb = ivMean(pb);
    if (!(ma.mean > 0) || !Number.isFinite(mb.mean)) continue;
    const ratio = mb.mean / ma.mean;
    // d(B/A) = sqrt((dB / A)^2 + (B dA / A^2)^2): first-order error propagation.
    const ratioErr = Math.hypot(mb.err / ma.mean, (ratio * ma.err) / ma.mean);
    const wavelength = meanOf([...pa, ...pb].map((p) => p.wavelength));
    out.push({ cubeChannel: ch, wavelength, ratio, ratioErr });
  }
  return out.sort((x, y) => x.wavelength - y.wavelength);
}

/** Inverse-variance combination of matchedRatio rows into one brightness ratio (B / A). */
export function combineRatios(rows: { ratio: number; ratioErr: number }[]): { ratio: number; ratioErr: number; n: number } {
  const m = ivMean(rows.map((r) => ({ flux: r.ratio, fluxErr: r.ratioErr })));
  return { ratio: m.mean, ratioErr: m.err, n: m.n };
}

/** Assign visits by gaps > gapDays in time (used only when no point carries a visit index). */
function autoVisits(points: PhotPoint[], gapDays = 10): Map<PhotPoint, number> {
  const sorted = [...points].sort((a, b) => a.mjd - b.mjd);
  const m = new Map<PhotPoint, number>();
  let v = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].mjd - sorted[i - 1].mjd > gapDays) v++;
    m.set(sorted[i], v);
  }
  return m;
}

export interface LightCurvePoint {
  visit: number;
  /** Mean MJD of the points used. */
  mjd: number;
  mjdMin: number;
  mjdMax: number;
  /** Mean flux relative to the source's own average in the same channels (1 = average). */
  rel: number;
  relErr: number;
  /** Number of points and of distinct cube channels used. */
  n: number;
  nChannels: number;
}

/**
 * Light curve that is not fooled by colour: each good point is divided by the all-visit mean of its
 * own cube channel (the mean of the per-visit means, so a visit with many exposures does not dominate),
 * which removes the spectral shape; the per-visit mean of these relative fluxes is then comparable
 * between visits even when different visits sampled different wavelengths. Only channels seen in at
 * least two visits are used (a channel seen once is 1.0 by construction and would dilute any change),
 * unless no channel repeats. `cubeChannels` restricts the channels (e.g. one detector's band).
 * Points without `visit` are grouped by 10-day gaps when none of them carries a visit index.
 */
export function lightCurve(points: PhotPoint[], opts?: { cubeChannels?: number[] }): LightCurvePoint[] {
  let pts = points.filter(usable);
  if (opts?.cubeChannels) {
    const allow = new Set(opts.cubeChannels);
    pts = pts.filter((p) => allow.has(p.cubeChannel));
  }
  if (pts.length === 0) return [];
  const auto = pts.every((p) => p.visit === undefined) ? autoVisits(pts) : null;
  const visitOf = (p: PhotPoint): number | undefined => (auto ? auto.get(p) : p.visit);
  pts = pts.filter((p) => visitOf(p) !== undefined);

  // Per channel: mean of per-visit means.
  const chanMean = new Map<number, number>();
  const chanVisits = new Map<number, number>();
  for (const [ch, list] of groupBy(pts, (p) => p.cubeChannel)) {
    const perVisit = [...groupBy(list, (p) => visitOf(p) as number).values()].map((l) => ivMean(l).mean);
    const finite = perVisit.filter(Number.isFinite);
    if (finite.length === 0) continue;
    chanMean.set(ch, meanOf(finite));
    chanVisits.set(ch, finite.length);
  }
  const repeated = [...chanVisits.values()].some((n) => n >= 2);
  const rel = pts
    .filter((p) => {
      const m = chanMean.get(p.cubeChannel);
      return m !== undefined && m > 0 && (!repeated || (chanVisits.get(p.cubeChannel) ?? 0) >= 2);
    })
    .map((p) => {
      const m = chanMean.get(p.cubeChannel) as number;
      return { p, flux: p.flux / m, fluxErr: p.fluxErr / m };
    });

  const out: LightCurvePoint[] = [];
  for (const [visit, list] of groupBy(rel, (r) => visitOf(r.p) as number)) {
    const m = ivMean(list);
    const mjds = list.map((r) => r.p.mjd);
    out.push({
      visit,
      mjd: meanOf(mjds),
      mjdMin: Math.min(...mjds),
      mjdMax: Math.max(...mjds),
      rel: m.mean,
      relErr: m.err,
      n: m.n,
      nChannels: new Set(list.map((r) => r.p.cubeChannel)).size,
    });
  }
  return out.sort((a, b) => a.mjd - b.mjd);
}

/** AB magnitude of a flux density in mJy: m = -2.5 log10(F / 3631 Jy). NaN for F <= 0. */
export function abMag(fluxMjy: number): number {
  return fluxMjy > 0 ? -2.5 * Math.log10(fluxMjy / 3631000) : NaN;
}

/** Names of the flag bits set in a mask (for tooltips), using pipeline 7.x bit numbers. */
export function flagNames(flags: number, names?: Record<number, string>): string[] {
  const out: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (!(flags & (1 << bit))) continue;
    const n = names?.[bit] ?? Object.keys(FLAG_BITS).find((k) => FLAG_BITS[k] === bit) ?? `BIT${bit}`;
    out.push(n);
  }
  return out;
}
