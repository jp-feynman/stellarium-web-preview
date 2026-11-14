// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// TAN + SIP celestial WCS for SPHEREx Level-2 frames, plus tangent-plane helpers for our
// north-up display grid. Pixel coordinates are 0-based with centres at integers.
// Checked against astropy (tests/wcs.test.ts uses tests/fixtures/golden_l2.json).

import type { SipPoly, SkyGrid, TanSipWcs } from '../types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const ARCSEC_PER_RAD = 3600 * R2D;

type Cards = Record<string, string | number | boolean>;

function num(cards: Cards, key: string, fallback?: number): number {
  const v = cards[key];
  if (typeof v === 'number') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`WCS keyword ${key} missing`);
}

function sipCoeffs(cards: Cards, prefix: string): { poly?: SipPoly; order?: number } {
  const order = cards[`${prefix}_ORDER`];
  if (typeof order !== 'number') return {};
  const poly: SipPoly = [];
  for (let p = 0; p <= order; p++) {
    poly.push(new Array(order + 1).fill(0));
    for (let q = 0; q <= order - p; q++) {
      const v = cards[`${prefix}_${p}_${q}`];
      if (typeof v === 'number') poly[p][q] = v;
    }
  }
  return { poly, order };
}

/** Build the WCS from IMAGE header cards (CTYPE RA---TAN-SIP / DEC--TAN-SIP; PC+CDELT or CD). */
export function wcsFromCards(cards: Cards): TanSipWcs {
  const c1 = String(cards.CTYPE1 ?? '');
  const c2 = String(cards.CTYPE2 ?? '');
  if (!c1.startsWith('RA---TAN') || !c2.startsWith('DEC--TAN')) {
    throw new Error(`unsupported WCS projection ${c1} / ${c2}`);
  }
  let cd: [[number, number], [number, number]];
  if (typeof cards.CD1_1 === 'number') {
    cd = [
      [num(cards, 'CD1_1'), num(cards, 'CD1_2', 0)],
      [num(cards, 'CD2_1', 0), num(cards, 'CD2_2')],
    ];
  } else {
    const d1 = num(cards, 'CDELT1', 1);
    const d2 = num(cards, 'CDELT2', 1);
    cd = [
      [num(cards, 'PC1_1', 1) * d1, num(cards, 'PC1_2', 0) * d1],
      [num(cards, 'PC2_1', 0) * d2, num(cards, 'PC2_2', 1) * d2],
    ];
  }
  const a = sipCoeffs(cards, 'A');
  const b = sipCoeffs(cards, 'B');
  const ap = sipCoeffs(cards, 'AP');
  const bp = sipCoeffs(cards, 'BP');
  return {
    crval: [num(cards, 'CRVAL1'), num(cards, 'CRVAL2')],
    crpix: [num(cards, 'CRPIX1'), num(cards, 'CRPIX2')],
    cd,
    a: a.poly,
    b: b.poly,
    ap: ap.poly,
    bp: bp.poly,
    aOrder: a.order,
    bOrder: b.order,
    naxis: [num(cards, 'NAXIS1', 2040), num(cards, 'NAXIS2', 2040)],
  };
}

function evalPoly(poly: SipPoly | undefined, u: number, v: number): number {
  if (!poly) return 0;
  let s = 0;
  let up = 1;
  for (let p = 0; p < poly.length; p++) {
    const row = poly[p];
    let vq = 1;
    for (let q = 0; q < row.length; q++) {
      const c = row[q];
      if (c !== 0) s += c * up * vq;
      vq *= v;
    }
    up *= u;
  }
  return s;
}

/** Intermediate world coordinates (xi, eta) in degrees for a 0-based pixel, SIP applied. */
function pixToPlaneDeg(wcs: TanSipWcs, x: number, y: number): [number, number] {
  const u = x + 1 - wcs.crpix[0];
  const v = y + 1 - wcs.crpix[1];
  const U = u + evalPoly(wcs.a, u, v);
  const V = v + evalPoly(wcs.b, u, v);
  return [wcs.cd[0][0] * U + wcs.cd[0][1] * V, wcs.cd[1][0] * U + wcs.cd[1][1] * V];
}

/** 0-based pixel -> [ra, dec] in degrees. */
export function pixToSky(wcs: TanSipWcs, x: number, y: number): [number, number] {
  const [xiD, etaD] = pixToPlaneDeg(wcs, x, y);
  return tanDeprojectRad(wcs.crval[0], wcs.crval[1], xiD * D2R, etaD * D2R);
}

/** [ra, dec] degrees -> 0-based pixel [x, y]. Exact inverse (AP/BP start, then fixed-point iteration on A/B). */
export function skyToPix(wcs: TanSipWcs, ra: number, dec: number): [number, number] {
  const [xi, eta] = tanProjectRad(wcs.crval[0], wcs.crval[1], ra, dec);
  const xiD = xi * R2D;
  const etaD = eta * R2D;
  const det = wcs.cd[0][0] * wcs.cd[1][1] - wcs.cd[0][1] * wcs.cd[1][0];
  const U = (wcs.cd[1][1] * xiD - wcs.cd[0][1] * etaD) / det;
  const V = (-wcs.cd[1][0] * xiD + wcs.cd[0][0] * etaD) / det;
  let u = U;
  let v = V;
  if (wcs.ap && wcs.bp) {
    u = U + evalPoly(wcs.ap, U, V);
    v = V + evalPoly(wcs.bp, U, V);
  }
  if (wcs.a || wcs.b) {
    for (let it = 0; it < 30; it++) {
      const un = U - evalPoly(wcs.a, u, v);
      const vn = V - evalPoly(wcs.b, u, v);
      const done = Math.abs(un - u) < 1e-9 && Math.abs(vn - v) < 1e-9;
      u = un;
      v = vn;
      if (done) break;
    }
  }
  return [u + wcs.crpix[0] - 1, v + wcs.crpix[1] - 1];
}

/** True when the position is on the near side of the tangent plane (within 90 deg of the frame centre). */
export function inFrontOfPlane(wcs: TanSipWcs, ra: number, dec: number): boolean {
  const d0 = wcs.crval[1] * D2R;
  const d = dec * D2R;
  const da = (ra - wcs.crval[0]) * D2R;
  return Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da) > 0;
}

/** Solid angle of the pixel at (x, y) in arcsec^2 from the WCS Jacobian (matches the calibration map to 0.1 %). */
export function pixelAreaArcsec2(wcs: TanSipWcs, x: number, y: number): number {
  const [x1, e1] = pixToPlaneDeg(wcs, x + 0.5, y);
  const [x0, e0] = pixToPlaneDeg(wcs, x - 0.5, y);
  const [x3, e3] = pixToPlaneDeg(wcs, x, y + 0.5);
  const [x2, e2] = pixToPlaneDeg(wcs, x, y - 0.5);
  const jac = Math.abs((x1 - x0) * (e3 - e2) - (x3 - x2) * (e1 - e0)) * D2R * D2R;
  const [xiD, etaD] = pixToPlaneDeg(wcs, x, y);
  const xi = xiD * D2R;
  const eta = etaD * D2R;
  return (jac / Math.pow(1 + xi * xi + eta * eta, 1.5)) * ARCSEC_PER_RAD * ARCSEC_PER_RAD;
}

/** Position angle (degrees east of north) of the detector +y axis at pixel (x, y). */
export function positionAngleDeg(wcs: TanSipWcs, x: number, y: number): number {
  const [ra0, dec0] = pixToSky(wcs, x, y);
  const [ra1, dec1] = pixToSky(wcs, x, y + 1);
  const [xi, eta] = tanProject(ra0, dec0, ra1, dec1);
  return Math.atan2(xi, eta) * R2D;
}

function tanProjectRad(ra0: number, dec0: number, ra: number, dec: number): [number, number] {
  const a0 = ra0 * D2R;
  const d0 = dec0 * D2R;
  const a = ra * D2R;
  const d = dec * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [xi, eta];
}

function tanDeprojectRad(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const a0 = ra0 * D2R;
  const d0 = dec0 * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  let ra = (a0 + Math.atan2(xi, den)) * R2D;
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) * R2D;
  ra = ((ra % 360) + 360) % 360;
  return [ra, dec];
}

/** Gnomonic projection about (ra0, dec0): returns [xi (east), eta (north)] in arcsec. */
export function tanProject(ra0: number, dec0: number, ra: number, dec: number): [number, number] {
  const [xi, eta] = tanProjectRad(ra0, dec0, ra, dec);
  return [xi * ARCSEC_PER_RAD, eta * ARCSEC_PER_RAD];
}

/** Inverse of tanProject: tangent-plane offsets in arcsec -> [ra, dec] degrees. */
export function tanDeproject(ra0: number, dec0: number, xiArcsec: number, etaArcsec: number): [number, number] {
  return tanDeprojectRad(ra0, dec0, xiArcsec / ARCSEC_PER_RAD, etaArcsec / ARCSEC_PER_RAD);
}

/** Sky position of the centre of grid pixel (i, j). Column 0 = east edge, row 0 = south edge. */
export function gridPixToSky(grid: SkyGrid, i: number, j: number): [number, number] {
  const c = (grid.n - 1) / 2;
  const xi = -(i - c) * grid.scaleArcsec;
  const eta = (j - c) * grid.scaleArcsec;
  return tanDeproject(grid.ra0, grid.dec0, xi, eta);
}

/** Fractional grid pixel (i, j) of a sky position. */
export function skyToGridPix(grid: SkyGrid, ra: number, dec: number): [number, number] {
  const [xi, eta] = tanProject(grid.ra0, grid.dec0, ra, dec);
  const c = (grid.n - 1) / 2;
  return [c - xi / grid.scaleArcsec, c + eta / grid.scaleArcsec];
}

/** Great-circle separation in arcsec (haversine, safe for small angles). */
export function angularSepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d1 = dec1 * D2R;
  const d2 = dec2 * D2R;
  const sd = Math.sin((d2 - d1) / 2);
  const sa = Math.sin(((ra2 - ra1) * D2R) / 2);
  const h = sd * sd + Math.cos(d1) * Math.cos(d2) * sa * sa;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * ARCSEC_PER_RAD;
}
