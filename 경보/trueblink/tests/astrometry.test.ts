// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  earthBarycentricAu,
  earthHeliocentricAu,
  fitMotion,
  parallaxOffsetArcsec,
  predictTrack,
  propagateSource,
  type MotionPoint,
} from '../src/core/astrometry';
import { angularSepArcsec, tanDeproject, tanProject } from '../src/core/wcs';

// targets.json contains bare NaN values (not valid JSON), so read it as text.
const targets = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/targets.json', import.meta.url)), 'utf8').replace(/\bNaN\b/g, 'null'),
) as { targets: any[] };
const barnard = targets.targets.find((t) => t.key === 'barnard');

/** MJD (UTC) of J2000.0 = JD 2451545.0 TT. */
const MJD_J2000_UTC = 51544.5 - 69.184 / 86400;

function gaussRng(seed: number): () => number {
  let a = seed >>> 0;
  const u = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
}

describe('Earth position', () => {
  it('heliocentric Earth at J2000.0 is about (-0.177, 0.887, 0.385) au', () => {
    const e = earthHeliocentricAu(MJD_J2000_UTC);
    // DE405 heliocentric Earth at J2000.0: (-0.177135, 0.887443, 0.384765) au.
    const want = [-0.177135, 0.887443, 0.384765];
    for (let k = 0; k < 3; k++) expect(Math.abs(e[k] - want[k])).toBeLessThan(2e-4);
    for (let k = 0; k < 3; k++) expect(Math.abs(e[k] - [-0.177, 0.887, 0.385][k])).toBeLessThan(1e-3);
  });
  it('barycentric Earth at J2000.0 includes the Sun wobble (~0.0076 au, mostly Jupiter)', () => {
    const e = earthBarycentricAu(MJD_J2000_UTC);
    // DE405 heliocentric Earth plus the Sun's barycentric offset (-0.00712, -0.00264, -0.00092) au.
    const want = [-0.184255, 0.884803, 0.383845];
    for (let k = 0; k < 3; k++) expect(Math.abs(e[k] - want[k])).toBeLessThan(5e-4);
    const h = earthHeliocentricAu(MJD_J2000_UTC);
    const wobble = Math.hypot(e[0] - h[0], e[1] - h[1], e[2] - h[2]);
    expect(wobble).toBeGreaterThan(0.006);
    expect(wobble).toBeLessThan(0.01);
  });
  it('distance stays between perihelion and aphelion through 2025-2026', () => {
    for (let mjd = 60676; mjd < 61400; mjd += 7) {
      const r = Math.hypot(...earthHeliocentricAu(mjd));
      expect(r).toBeGreaterThan(0.9832);
      expect(r).toBeLessThan(1.0168);
    }
  });
});

describe('parallax and propagation', () => {
  it('a star at the ecliptic pole traces a circle of radius = parallax', () => {
    // North ecliptic pole: RA 18h, Dec +66.56 deg.
    for (let mjd = 60676; mjd < 61041; mjd += 15) {
      const [dx, dy] = parallaxOffsetArcsec(270, 66.560708, 1000, mjd);
      const r = Math.hypot(...earthHeliocentricAu(mjd));
      expect(Math.abs(Math.hypot(dx, dy) - r)).toBeLessThan(0.012);
    }
  });
  it('matches apparent geocentric positions of the challenge targets (proper motion + parallax)', () => {
    let checked = 0;
    for (const t of targets.targets) {
      if (!t.ra_dec_2016_0 || !t.visits_wide) continue;
      const src = { ra: t.ra_dec_2016_0[0], dec: t.ra_dec_2016_0[1], epoch: 2016.0, pmRa: t.pmra_mas_yr ?? 0, pmDec: t.pmdec_mas_yr ?? 0, parallax: t.parallax_mas ?? 0 };
      for (const v of t.visits_wide) {
        if (!v.apparent_geocentric_ra_dec_at_mid) continue;
        const p = propagateSource(src, v.mjd_mid);
        const [ra, dec] = v.apparent_geocentric_ra_dec_at_mid;
        // Residual is dominated by Barnard's radial-velocity (perspective) term, which we do not model.
        expect(angularSepArcsec(p.ra, p.dec, ra, dec)).toBeLessThan(0.1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
  it('predictTrack runs from start to end', () => {
    const src = { ra: 269.4485, dec: 4.7394, epoch: 2016, pmRa: -802.8, pmDec: 10362.5, parallax: 547 };
    const tr = predictTrack(src, 60900, 61300, 20);
    expect(tr.length).toBe(20);
    const a = propagateSource(src, 60900);
    const b = propagateSource(src, 61300);
    expect(angularSepArcsec(tr[0][0], tr[0][1], a.ra, a.dec)).toBeLessThan(1e-6);
    expect(angularSepArcsec(tr[19][0], tr[19][1], b.ra, b.dec)).toBeLessThan(1e-6);
  });
});

describe('fitMotion', () => {
  // Barnard's Star at Gaia epoch 2016.0 with the challenge brief's motion.
  const src = { ra: 269.44850252495564, dec: 4.73942005733163, epoch: 2016.0, pmRa: -802.8, pmDec: 10362.5, parallax: 547 };
  // SPHEREx-like sampling: ~15 exposures spread over each real visit window of Barnard's Star.
  function track(sigmaArcsec: number, seed: number, withParallax = true): MotionPoint[] {
    const g = gaussRng(seed);
    const s = withParallax ? src : { ...src, parallax: 0 };
    const pts: MotionPoint[] = [];
    for (const v of barnard.visits_wide) {
      const nExp = 15;
      for (let k = 0; k < nExp; k++) {
        const mjd = v.mjd_min + ((v.mjd_max - v.mjd_min) * k) / (nExp - 1);
        const p = propagateSource(s, mjd);
        const [xi, eta] = tanProject(p.ra, p.dec, p.ra, p.dec);
        const [ra, dec] = tanDeproject(p.ra, p.dec, xi + sigmaArcsec * g(), eta + sigmaArcsec * g());
        pts.push({ mjd, ra, dec, err: sigmaArcsec });
      }
    }
    return pts;
  }

  it('recovers the Barnard track (pm + parallax) within its errors', () => {
    const f = fitMotion(track(0.5, 42), { fitParallax: true });
    expect(f.n).toBe(15 * barnard.visits_wide.length);
    expect(Math.abs(f.pmRa - src.pmRa)).toBeLessThan(3 * f.pmRaErr);
    expect(Math.abs(f.pmDec - src.pmDec)).toBeLessThan(3 * f.pmDecErr);
    expect(Math.abs(f.parallax! - 547)).toBeLessThan(3 * f.parallaxErr!);
    expect(Math.abs(f.total - Math.hypot(src.pmRa, src.pmDec))).toBeLessThan(3 * f.totalErr);
    expect(f.pmDecErr).toBeLessThan(200);
    expect(f.chi2 / f.dof).toBeLessThan(1.5);
  });
  it('a known (Gaia) parallax can be held fixed instead of fitted', () => {
    const f = fitMotion(track(0.5, 7), { fixedParallaxMas: 547 });
    expect(f.parallax).toBeUndefined();
    expect(Math.abs(f.pmRa - src.pmRa)).toBeLessThan(3 * f.pmRaErr);
    expect(Math.abs(f.pmDec - src.pmDec)).toBeLessThan(3 * f.pmDecErr);
  });
  it('without parallax, a straight-line fit recovers a parallax-free track', () => {
    const f = fitMotion(track(0.3, 9, false), { refRa: src.ra, refDec: src.dec });
    expect(Math.abs(f.pmRa - src.pmRa)).toBeLessThan(3 * f.pmRaErr);
    expect(Math.abs(f.pmDec - src.pmDec)).toBeLessThan(3 * f.pmDecErr);
    // Fitted reference position lies on the true track at refMjd.
    const p = propagateSource({ ...src, parallax: 0 }, f.refMjd);
    expect(angularSepArcsec(p.ra, p.dec, f.ra, f.dec)).toBeLessThan(0.2);
  });
  it('a stationary source has no significant motion', () => {
    const pts = track(0.4, 3, false).map((p, i) => ({ ...p, ra: src.ra + (i % 2 ? 1e-5 : -1e-5), dec: src.dec }));
    const f = fitMotion(pts);
    expect(f.total).toBeLessThan(4 * f.totalErr);
  });
  it('two points: exact line, errors Infinity; fewer: NaN', () => {
    const a = propagateSource({ ...src, parallax: 0 }, 60900);
    const b = propagateSource({ ...src, parallax: 0 }, 61265.25);
    const f = fitMotion([
      { mjd: 60900, ra: a.ra, dec: a.dec, err: 0.5 },
      { mjd: 61265.25, ra: b.ra, dec: b.dec, err: 0.5 },
    ]);
    expect(f.n).toBe(2);
    expect(f.pmRaErr).toBe(Infinity);
    expect(f.totalErr).toBe(Infinity);
    expect(Math.abs(f.pmDec - src.pmDec)).toBeLessThan(5);
    expect(Math.abs(f.pmRa - src.pmRa)).toBeLessThan(5);
    const g = fitMotion([{ mjd: 60900, ra: a.ra, dec: a.dec, err: 0.5 }]);
    expect(Number.isNaN(g.pmRa)).toBe(true);
    expect(g.pmRaErr).toBe(Infinity);
  });
});
