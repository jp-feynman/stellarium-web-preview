// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Motion on the sky: where the Earth is (for parallax), where a star with known proper motion and
// parallax should appear at a given date, and a least-squares fit of proper motion (and optionally
// parallax) to measured positions. Pure functions, no network.
//
// Units: positions in degrees (ICRS), proper motions in mas/yr with pmRa = mu_alpha * cos(dec),
// parallax in mas, times in MJD (UTC), epochs of catalogue positions as Julian years.

import type { SkyPos } from '../types';
import { mjdToJyear } from '../types';
import { tanDeproject, tanProject } from '../wcs';

const D2R = Math.PI / 180;
/** J2000 obliquity of the ecliptic (IAU 2006), degrees: the tilt between the ecliptic and the equator. */
const OBLIQUITY_J2000 = 23.4392911;
/** TT - UTC in seconds since 2017 (32.184 s + 37 leap seconds). Planet theories run on TT/TDB. */
const TT_MINUS_UTC_S = 69.184;
const KM_PER_AU = 149597870.7;

function sinD(x: number): number {
  return Math.sin(x * D2R);
}
function cosD(x: number): number {
  return Math.cos(x * D2R);
}

/** Ecliptic (J2000) -> ICRS equatorial: rotate about the x axis (towards the equinox) by the obliquity. */
function eclToEq(x: number, y: number, z: number): [number, number, number] {
  const ce = cosD(OBLIQUITY_J2000);
  const se = sinD(OBLIQUITY_J2000);
  return [x, y * ce - z * se, y * se + z * ce];
}

/** Solve Kepler's equation E - e sin E = M (radians) by Newton iteration. */
function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 10; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Approximate Keplerian elements of the giant planets (Standish, "Keplerian Elements for Approximate
// Positions of the Major Planets", JPL, valid 1800-2050; J2000 ecliptic and equinox).
// Columns: a [au], e, I [deg], L [deg], long. perihelion [deg], long. node [deg]; each value + rate per century.
// mass = planet (with moons) / Sun.
interface PlanetElements {
  el: [number, number][];
  mass: number;
}
const GIANTS: PlanetElements[] = [
  {
    // Jupiter
    el: [
      [5.202887, -0.00011607],
      [0.04838624, -0.00013253],
      [1.30439695, -0.00183714],
      [34.39644051, 3034.74612775],
      [14.72847983, 0.21252668],
      [100.47390909, 0.20469106],
    ],
    mass: 1 / 1047.3486,
  },
  {
    // Saturn
    el: [
      [9.53667594, -0.0012506],
      [0.05386179, -0.00050991],
      [2.48599187, 0.00193609],
      [49.95424423, 1222.49362201],
      [92.59887831, -0.41897216],
      [113.66242448, -0.28867794],
    ],
    mass: 1 / 3497.898,
  },
  {
    // Uranus
    el: [
      [19.18916464, -0.00196176],
      [0.04725744, -0.00004397],
      [0.77263783, -0.00242939],
      [313.23810451, 428.48202785],
      [170.9542763, 0.40805281],
      [74.01692503, 0.04240589],
    ],
    mass: 1 / 22902.98,
  },
  {
    // Neptune
    el: [
      [30.06992276, 0.00026291],
      [0.00859048, 0.00005105],
      [1.77004347, 0.00035372],
      [-55.12002969, 218.45945325],
      [44.96476227, -0.32241464],
      [131.78422574, -0.00508664],
    ],
    mass: 1 / 19412.24,
  },
];

/** Heliocentric ecliptic (J2000) position of a planet from its mean Keplerian elements, au. */
function planetHelioEcl(p: PlanetElements, T: number): [number, number, number] {
  const [a, e, I, L, wbar, node] = p.el.map(([v, r]) => v + r * T);
  const omega = wbar - node; // argument of perihelion
  let M = (L - wbar) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  const E = solveKepler(M * D2R, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = cosD(omega), so = sinD(omega), cn = cosD(node), sn = sinD(node), ci = cosD(I), si = sinD(I);
  return [
    (co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp,
    (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp,
    so * si * xp + co * si * yp,
  ];
}

/**
 * Position of the Earth relative to the Solar System barycentre, ICRS equatorial axes, in au.
 *
 * How it is built (all low-precision, good to roughly 1e-4 au, i.e. ~0.05 mas of parallax error
 * even for Barnard's Star):
 *  1. The Sun as seen from the Earth comes from the standard low-precision solar formulae
 *     (mean longitude, mean anomaly, equation of centre; Meeus ch. 25 / Astronomical Almanac),
 *     which give the Sun's geometric ecliptic longitude and distance. Earth = -Sun.
 *  2. That longitude is referred to the moving equinox of date, so we remove ~50.3"/yr of
 *     precession to get the J2000 ecliptic, then rotate by the obliquity to ICRS equatorial axes.
 *  3. The Sun itself wobbles around the barycentre by up to 0.01 au, mostly because of Jupiter.
 *     We add that wobble from mean orbits of the four giant planets.
 *  4. The Moon pulls the Earth ~4700 km off the Earth-Moon barycentre; a two-term lunar
 *     formula corrects that.
 */
export function earthBarycentricAu(mjd: number): [number, number, number] {
  return earthPosition(mjd, true);
}

/**
 * Position of the Earth relative to the Sun's centre (steps 1, 2 and 4 above, without the Sun's
 * wobble), ICRS equatorial axes, au. Differs from earthBarycentricAu by up to ~0.01 au.
 */
export function earthHeliocentricAu(mjd: number): [number, number, number] {
  return earthPosition(mjd, false);
}

function earthPosition(mjd: number, barycentric: boolean): [number, number, number] {
  const jdTT = mjd + 2400000.5 + TT_MINUS_UTC_S / 86400;
  const d = jdTT - 2451545.0;
  const T = d / 36525;

  // 1. Geometric Sun, ecliptic of date.
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinD(M) +
    (0.019993 - 0.000101 * T) * sinD(2 * M) +
    0.000289 * sinD(3 * M);
  const nu = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cosD(nu));
  // 2. Precession from equinox of date back to J2000 (1.396971 deg per century in longitude).
  const lambdaSun = L0 + C - 1.396971 * T;
  // Earth (strictly the Earth-Moon barycentre) relative to the Sun, J2000 ecliptic.
  let ex = -R * cosD(lambdaSun);
  let ey = -R * sinD(lambdaSun);
  let ez = 0;

  // 4. Earth relative to the Earth-Moon barycentre: -Moon / (1 + Earth/Moon mass ratio).
  const Lm = 218.316 + 13.176396 * d;
  const Mm = 134.963 + 13.064993 * d;
  const Fm = 93.272 + 13.22935 * d;
  const lamM = Lm + 6.289 * sinD(Mm) - 1.396971 * T;
  const betM = 5.128 * sinD(Fm);
  const distM = (385001 - 20905 * cosD(Mm)) / KM_PER_AU;
  const mu = 1 / (1 + 81.30057);
  ex -= mu * distM * cosD(betM) * cosD(lamM);
  ey -= mu * distM * cosD(betM) * sinD(lamM);
  ez -= mu * distM * sinD(betM);

  // 3. Barycentre relative to the Sun: mass-weighted mean of the giant planets' positions.
  let mTot = 1;
  for (const p of GIANTS) mTot += p.mass;
  if (barycentric) for (const p of GIANTS) {
    const [px, py, pz] = planetHelioEcl(p, T);
    ex -= (p.mass / mTot) * px;
    ey -= (p.mass / mTot) * py;
    ez -= (p.mass / mTot) * pz;
  }
  return eclToEq(ex, ey, ez);
}

/**
 * Parallax displacement of a star seen from the Earth at `mjd`: [d_ra * cos(dec), d_dec] in arcsec.
 * The star appears shifted away from the observer's position, projected onto the sky: as the
 * Earth goes round the Sun, a nearby star traces a small ellipse with semi-major axis = parallax.
 * `observerAu` overrides the Earth's barycentric position (e.g. to add a spacecraft offset).
 */
export function parallaxOffsetArcsec(
  ra: number,
  dec: number,
  parallaxMas: number,
  mjd: number,
  observerAu?: [number, number, number],
): [number, number] {
  const [X, Y, Z] = observerAu ?? earthBarycentricAu(mjd);
  const p = parallaxMas / 1000;
  const sa = sinD(ra), ca = cosD(ra), sd = sinD(dec), cd = cosD(dec);
  return [p * (X * sa - Y * ca), p * (X * ca * sd + Y * sa * sd - Z * cd)];
}

export interface AstrometricSource {
  ra: number;
  dec: number;
  /** Epoch of ra/dec as a Julian year (2000.0 for SIMBAD, 2016.0 for Gaia DR3). */
  epoch: number;
  pmRa?: number;
  pmDec?: number;
  parallax?: number;
}

/**
 * Where a star appears at `mjd`: catalogue position moved by proper motion along a straight line in
 * space (no radial-velocity term) plus the annual parallax for an observer at the Earth's centre.
 * The motion is applied on the tangent plane at the catalogue position, which is exactly the
 * linear space-motion model (normalise(u + t * mu)) used to propagate Gaia positions.
 */
export function propagateSource(src: AstrometricSource, mjd: number): SkyPos {
  const dt = mjdToJyear(mjd) - src.epoch;
  let xi = ((src.pmRa ?? 0) * dt) / 1000;
  let eta = ((src.pmDec ?? 0) * dt) / 1000;
  if (src.parallax) {
    const [px, py] = parallaxOffsetArcsec(src.ra, src.dec, src.parallax, mjd);
    xi += px;
    eta += py;
  }
  const [ra, dec] = tanDeproject(src.ra, src.dec, xi, eta);
  return { ra, dec };
}

/** Sky track of a source between two dates, for overlays: `steps` points [ra, dec] (minimum 2). */
export function predictTrack(
  target: AstrometricSource,
  mjdStart: number,
  mjdEnd: number,
  steps: number,
): [number, number][] {
  const n = Math.max(2, Math.floor(steps));
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const mjd = mjdStart + ((mjdEnd - mjdStart) * k) / (n - 1);
    const p = propagateSource(target, mjd);
    out.push([p.ra, p.dec]);
  }
  return out;
}

export interface MotionPoint {
  mjd: number;
  ra: number;
  dec: number;
  /** 1-sigma position error per axis, arcsec. */
  err: number;
}

export interface MotionFit {
  /** Proper motion, mas/yr (pmRa includes cos(dec)), and 1-sigma errors. */
  pmRa: number;
  pmDec: number;
  pmRaErr: number;
  pmDecErr: number;
  /** Total proper motion and its error, mas/yr. */
  total: number;
  totalErr: number;
  /** Fitted parallax and error in mas (only when fitParallax was used and possible). */
  parallax?: number;
  parallaxErr?: number;
  /** Sum of squared normalised residuals over both axes, and number of points used. */
  chi2: number;
  n: number;
  /** Degrees of freedom (2n - number of parameters). */
  dof: number;
  /** Fitted position at refMjd (the weighted mean epoch of the points). */
  ra: number;
  dec: number;
  refMjd: number;
}

/** Invert a small symmetric positive matrix (Gauss-Jordan with partial pivoting); null if singular. */
function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    const scale = Math.max(...a[c].map(Math.abs), 1e-300);
    if (Math.abs(m[piv][c]) < 1e-12 * scale) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    const p = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * Weighted least-squares fit of position + proper motion (+ optionally parallax) to measured positions.
 *
 * Each point is projected onto the tangent plane about the reference (first point, or refRa/refDec):
 *   xi(t)  = xi0  + mu_x * t + P * fx(t)
 *   eta(t) = eta0 + mu_y * t + P * fy(t)
 * where t is in years from the weighted mean epoch and (fx, fy) are the parallax factors (the
 * displacement a 1-arcsec parallax would cause at that date). `fixedParallaxMas` removes a known
 * parallax (e.g. from Gaia) before fitting, which is better than fitting it from two SPHEREx visits.
 *
 * Errors come from the covariance matrix, scaled up by sqrt(chi2/dof) when the scatter is larger
 * than the quoted errors (never scaled down). With only two points the line passes exactly through
 * both and the errors are reported as Infinity; with fewer than two, everything is NaN/Infinity.
 */
export function fitMotion(
  points: MotionPoint[],
  opts?: { fitParallax?: boolean; refRa?: number; refDec?: number; fixedParallaxMas?: number },
): MotionFit {
  const pts = points.filter(
    (p) => Number.isFinite(p.mjd) && Number.isFinite(p.ra) && Number.isFinite(p.dec) && Number.isFinite(p.err) && p.err > 0,
  );
  const n = pts.length;
  const bad: MotionFit = {
    pmRa: NaN,
    pmDec: NaN,
    pmRaErr: Infinity,
    pmDecErr: Infinity,
    total: NaN,
    totalErr: Infinity,
    chi2: NaN,
    n,
    dof: 0,
    ra: n ? pts[0].ra : NaN,
    dec: n ? pts[0].dec : NaN,
    refMjd: n ? pts[0].mjd : NaN,
  };
  if (n < 2) return bad;

  const ra0 = opts?.refRa ?? pts[0].ra;
  const dec0 = opts?.refDec ?? pts[0].dec;
  let sw = 0;
  let swt = 0;
  for (const p of pts) {
    const w = 1 / (p.err * p.err);
    sw += w;
    swt += w * p.mjd;
  }
  const refMjd = swt / sw;
  const withPlx = !!opts?.fitParallax && n >= 3;
  const k = withPlx ? 5 : 4;

  // Rows of the design matrix: parameters [xi0, mu_x, eta0, mu_y, P] (arcsec, arcsec/yr, arcsec).
  const rows: { a: number[]; b: number; w: number }[] = [];
  for (const p of pts) {
    let [xi, eta] = tanProject(ra0, dec0, p.ra, p.dec);
    const t = (p.mjd - refMjd) / 365.25;
    const [fx, fy] = parallaxOffsetArcsec(ra0, dec0, 1000, p.mjd);
    if (opts?.fixedParallaxMas) {
      xi -= (fx * opts.fixedParallaxMas) / 1000;
      eta -= (fy * opts.fixedParallaxMas) / 1000;
    }
    const w = 1 / (p.err * p.err);
    const ax = [1, t, 0, 0, fx].slice(0, k);
    const ay = [0, 0, 1, t, fy].slice(0, k);
    rows.push({ a: ax, b: xi, w }, { a: ay, b: eta, w });
  }
  const N = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rhs = new Array<number>(k).fill(0);
  for (const r of rows) {
    for (let i = 0; i < k; i++) {
      rhs[i] += r.w * r.a[i] * r.b;
      for (let j = 0; j < k; j++) N[i][j] += r.w * r.a[i] * r.a[j];
    }
  }
  const cov = invert(N);
  if (!cov) return { ...bad, refMjd };
  const x = cov.map((row) => row.reduce((s, v, j) => s + v * rhs[j], 0));
  let chi2 = 0;
  for (const r of rows) {
    const model = r.a.reduce((s, v, j) => s + v * x[j], 0);
    chi2 += r.w * (r.b - model) ** 2;
  }
  const dof = 2 * n - k;
  const scale = dof > 0 ? Math.max(1, chi2 / dof) : Infinity;

  const pmRa = x[1] * 1000;
  const pmDec = x[3] * 1000;
  const total = Math.hypot(pmRa, pmDec);
  const [raFit, decFit] = tanDeproject(ra0, dec0, x[0], x[2]);
  const out: MotionFit = {
    pmRa,
    pmDec,
    pmRaErr: Infinity,
    pmDecErr: Infinity,
    total,
    totalErr: Infinity,
    chi2,
    n,
    dof,
    ra: raFit,
    dec: decFit,
    refMjd,
  };
  if (withPlx) {
    out.parallax = x[4] * 1000;
    out.parallaxErr = Infinity;
  }
  if (n === 2 || !Number.isFinite(scale)) return out;

  const vRa = cov[1][1] * scale * 1e6;
  const vDec = cov[3][3] * scale * 1e6;
  const cRaDec = cov[1][3] * scale * 1e6;
  out.pmRaErr = Math.sqrt(vRa);
  out.pmDecErr = Math.sqrt(vDec);
  // Error of the length of the motion vector, propagated along its direction.
  out.totalErr =
    total > 0
      ? Math.sqrt(Math.max(0, (pmRa * pmRa * vRa + pmDec * pmDec * vDec + 2 * pmRa * pmDec * cRaDec) / (total * total)))
      : Math.sqrt((vRa + vDec) / 2);
  if (withPlx) out.parallaxErr = Math.sqrt(cov[4][4] * scale) * 1000;
  return out;
}
