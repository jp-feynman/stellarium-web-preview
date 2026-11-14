// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Asteroid tab data and Solar System overlays.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyseAsteroid, catalogueGroupOf, type AsteroidFile } from '../src/app/asteroid/analysis';
import { ASTEROID_INDEX, loadAsteroid } from '../src/app/asteroid/data';
import { coneRadiusArcsec, setSkybotClient, solarSystemOverlays, SMEAR_NOTE, type SsoOverlayData } from '../src/app/asteroid/overlays';
import { resetSession, session } from '../src/app/session';
import { leoParallaxArcsec, parseSkybotJson } from '../src/core/catalogs';
import { angularSepArcsec, skyToGridPix, tanDeproject, tanProject } from '../src/core/wcs';
import type { NativeCutout, SkyFrame, SkyGrid } from '../src/core/types';

const readAsteroid = (file: string) => JSON.parse(readFileSync(`public/data/asteroids/${file}`, 'utf8')) as AsteroidFile;

describe('measured asteroid files', () => {
  it('the index lists four asteroids and every file parses with provenance and catalogue facts', () => {
    expect(ASTEROID_INDEX.map((a) => a.number).sort((a, b) => a - b)).toEqual([10, 349, 433, 1929]);
    for (const e of ASTEROID_INDEX) {
      const f = readAsteroid(e.file);
      expect(f.number).toBe(e.number);
      expect(f.points.length).toBeGreaterThan(100);
      expect(new Set(f.points.map((p) => p.obs_id)).size).toBe(f.provenance.nExposures);
      expect(f.provenance.summary).toMatch(/2026-11-14/);
      expect(f.provenance.method).toMatch(/Horizons/);
      expect(f.catalogue.taxonomy?.value).toBeTruthy();
      expect(f.catalogue.diameterKm?.value).toBeGreaterThan(0);
      for (const p of f.points) {
        for (const k of ['wavelength_um', 'flux_mJy', 'err_mJy', 'mjd', 'r_au', 'delta_au', 'phase_deg'] as const) expect(Number.isFinite(p[k])).toBe(true);
        expect(p.s3_key).toMatch(/^(dr\d+|qr\d+)\/level2\//);
      }
    }
    // A catalogue value that SBDB does not give is left out, never invented.
    expect(readAsteroid('hygiea.json').catalogue.G).toBeUndefined();
    expect(readAsteroid('dembowska.json').catalogue.G?.value).toBe(0.37);
  });

  it('loads through the bundled loader', async () => {
    const f = await loadAsteroid('eros');
    expect(f.name).toBe('Eros');
    await expect(loadAsteroid('nope')).rejects.toThrow(/unknown asteroid/);
  });

  for (const e of ASTEROID_INDEX) {
    it(`${e.name}: finite reflectance, and the class is the catalogue group or a stated refusal`, () => {
      const f = readAsteroid(e.file);
      const a = analyseAsteroid(f);
      expect(a.reflectance.length).toBeGreaterThan(30);
      for (const r of a.reflectance) {
        expect(Number.isFinite(r.reflectance) && r.reflectance > 0).toBe(true);
        expect(Number.isFinite(r.err) && r.err > 0).toBe(true);
        expect(r.wavelength).toBeLessThanOrEqual(2.45);
      }
      // Normalised at 1.2 um: points near 1.2 um sit near 1.
      const near = a.reflectance.filter((r) => Math.abs(r.wavelength - 1.2) < 0.1).map((r) => r.reflectance);
      expect(Math.abs(near.sort((x, y) => x - y)[near.length >> 1] - 1)).toBeLessThan(0.05);
      const cg = catalogueGroupOf(f.catalogue.taxonomy?.value);
      if (a.taxonomy.refused) expect(a.taxonomy.refused.length).toBeGreaterThan(20);
      else expect(a.taxonomy.group).toBe(cg);
      expect(a.templates[0]?.role).toBe('best');
      expect(a.templates[1]?.group).not.toBe(a.templates[0]?.group);
      // Thermal: every visit has an eta or a reason.
      for (const v of a.thermalByVisit) expect(v.eta !== undefined || (v.refused ?? '').length > 0).toBe(true);
    });
  }

  it('Hygiea and Dembowska land in their catalogue groups; Hygiea gets a thermal fit near the research value', () => {
    const h = analyseAsteroid(readAsteroid('hygiea.json'));
    expect(h.taxonomy.group).toBe('C/X-like');
    expect(h.thermal).toBeDefined();
    const eta0 = h.thermalByVisit[0].eta!;
    expect(eta0).toBeGreaterThan(0.8);
    expect(eta0).toBeLessThan(1.0);
    expect(h.thermal!.crossoverUm![0]).toBeGreaterThan(3.5);
    for (const arr of [h.thermal!.reflected, h.thermal!.thermalLo, h.thermal!.thermalHi]) expect(arr.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(analyseAsteroid(readAsteroid('dembowska.json')).taxonomy.group).toBe('R');
  });
});

// ---------------------------------------------------------------- overlays

const fixture = readFileSync('tests/fixtures/catalogs/skybot_jd2460823.82017_r540.json', 'utf8');
const CONE = { ra: 184.954819867, dec: -4.08981110258 };
const MJD = 60823.32017;
// Spacecraft position from a real DR1 header (MJD-AVG 60800.70069465), used here as a plausible vector.
const SC: [number, number, number] = [-4698.73, 5178.25, -806.84];
const GRID: SkyGrid = { ra0: CONE.ra, dec0: CONE.dec, n: 256, scaleArcsec: 3.075 };

function frame(over: Partial<SkyFrame['meta']> = {}): SkyFrame {
  return {
    grid: GRID,
    data: new Float32Array(GRID.n * GRID.n).fill(NaN),
    meta: {
      kind: 'exposure', label: 'test', mjd: MJD, mjdMin: MJD, mjdMax: MJD, wavelength: 1.5, waveMin: 1.5, waveMax: 1.5,
      detectors: [2], nExposures: 1, exposureIds: ['E1D2'], visit: 0, ...over,
    },
  };
}

function fakeCutout(id: string, mjd: number): NativeCutout {
  return { exposure: { id, mjd }, header: { scPosKm: SC, mjdAvg: mjd } } as unknown as NativeCutout;
}

describe('solarSystemOverlays', () => {
  afterEach(() => setSkybotClient(null));

  it('queries SkyBoT once per visit, applies the spacecraft parallax and lands on the right grid pixel', async () => {
    resetSession();
    session.grid = GRID;
    session.cutouts.set('E1D2', fakeCutout('E1D2', MJD));
    session.visitOf.set('E1D2', 0);
    const calls: { pos: { ra: number; dec: number }; r: number; mjd: number }[] = [];
    setSkybotClient(async (pos, r, mjd) => {
      calls.push({ pos, r, mjd });
      return parseSkybotJson(fixture, mjd);
    });
    const frames = [frame(), frame({ exposureIds: ['E2D2'], mjd: MJD + 0.5 / 24 })];
    const ov = await solarSystemOverlays(frames);
    expect(calls.length).toBe(1);
    expect(calls[0].mjd).toBe(MJD);
    expect(calls[0].r).toBeCloseTo((256 * 3.075 * Math.SQRT2) / 2 + 60, 6);
    expect(coneRadiusArcsec(GRID)).toBeCloseTo(calls[0].r, 9);
    expect(calls[0].pos).toEqual({ ra: CONE.ra, dec: CONE.dec });
    expect(session.solarSystem.get(0)?.length).toBe(8);

    const objs = parseSkybotJson(fixture, MJD);
    const c0 = ov.filter((o) => o.kind === 'circle' && o.frameIndex === 0);
    expect(c0.length).toBeGreaterThan(0);
    let checked = 0;
    for (const o of objs) {
      const circle = c0.find((c) => (c.data as SsoOverlayData).object.name === o.name);
      // Geocentric pixel by hand: column 0 is the east edge, row 0 the south edge.
      const [xi, eta] = tanProject(GRID.ra0, GRID.dec0, o.ra, o.dec);
      const c = (GRID.n - 1) / 2;
      const geoPix = [c - xi / GRID.scaleArcsec, c + eta / GRID.scaleArcsec];
      const inside = geoPix.every((v) => v > 3 && v < GRID.n - 4);
      if (!inside) continue;
      expect(circle).toBeDefined();
      const par = leoParallaxArcsec(o.ra, o.dec, o.deltaAu!, SC);
      const [eRa, eDec] = tanDeproject(o.ra, o.dec, par[0], par[1]);
      const [pi, pj] = skyToGridPix(GRID, circle!.ra, circle!.dec);
      const [ei, ej] = skyToGridPix(GRID, eRa, eDec);
      expect(Math.hypot(pi - ei, pj - ej)).toBeLessThan(0.01);
      // The shift from the geocentric pixel equals the parallax (east = towards column 0).
      expect(pi - geoPix[0]).toBeCloseTo(-par[0] / GRID.scaleArcsec, 2);
      expect(pj - geoPix[1]).toBeCloseTo(par[1] / GRID.scaleArcsec, 2);
      expect(Math.hypot(...par)).toBeGreaterThan(0.5);
      const d = circle!.data as SsoOverlayData;
      expect(d.observer).toBe('spacecraft');
      expect(d.vectorFrom).toBe('E1D2');
      expect(d.note).toBe(SMEAR_NOTE);
      expect(circle!.id.startsWith('sso:')).toBe(true);
      expect(circle!.text).toBe(`${o.number !== undefined ? `(${o.number}) ` : ''}${o.name} (V ${o.vMag!.toFixed(1)})`);
      const arrow = ov.find((a) => a.kind === 'arrow' && a.id === `${circle!.id}:motion`)!;
      const [a, b] = arrow.path!;
      expect(angularSepArcsec(a[0], a[1], b[0], b[1])).toBeCloseTo(Math.hypot(o.dRa!, o.dDec!), 1);
      expect(arrow.frameIndex).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);

    // Second frame, half an hour later, same visit: no new request, positions moved by half an hour of motion.
    const c1 = ov.filter((o) => o.kind === 'circle' && o.frameIndex === 1);
    for (const c of c1) {
      const same = c0.find((x) => (x.data as SsoOverlayData).object.name === (c.data as SsoOverlayData).object.name);
      if (!same) continue;
      const o = (c.data as SsoOverlayData).object;
      expect(angularSepArcsec(same.ra, same.dec, c.ra, c.dec)).toBeCloseTo(0.5 * Math.hypot(o.dRa!, o.dDec!), 0);
    }
    await solarSystemOverlays(frames);
    expect(calls.length).toBe(1);
  });

  it('without a loaded header the markers stay geocentric', async () => {
    resetSession();
    setSkybotClient(async (_p, _r, mjd) => parseSkybotJson(fixture, mjd));
    const ov = await solarSystemOverlays([frame()]);
    const c = ov.find((o) => o.kind === 'circle')!;
    const d = c.data as SsoOverlayData;
    expect(d.observer).toBe('geocentric');
    expect(angularSepArcsec(c.ra, c.dec, d.object.ra, d.object.dec)).toBeLessThan(1e-6);
  });

  it('a SkyBoT failure resolves to [] and a warning', async () => {
    resetSession();
    setSkybotClient(async () => {
      throw new Error('SkyBoT unavailable (ssp.imcce.fr: HTTP 503)');
    });
    const ov = await solarSystemOverlays([frame()]);
    expect(ov).toEqual([]);
    expect(session.warnings.some((w) => /SkyBoT unavailable/.test(w))).toBe(true);
    expect(session.solarSystem.size).toBe(0);
  });

  it('an aborted request resolves to [] without a warning', async () => {
    resetSession();
    const ctl = new AbortController();
    setSkybotClient(
      (_p, _r, _m, signal) =>
        new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const p = solarSystemOverlays([frame()], ctl.signal);
    ctl.abort();
    expect(await p).toEqual([]);
    expect(session.warnings).toEqual([]);
  });
});
