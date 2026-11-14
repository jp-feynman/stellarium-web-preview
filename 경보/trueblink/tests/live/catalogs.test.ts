// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Live checks against the real services. Run with: LIVE=1 npx vitest run tests/live/catalogs.test.ts
import { describe, expect, it } from 'vitest';
import { externalFrame, gaiaCone, overlaysFromCatalog, propagateCatalog, simbadCone, skybotCone } from '../../src/core/catalogs';
import { angularSepArcsec, skyToGridPix } from '../../src/core/wcs';
import type { SkyGrid } from '../../src/core/types';

const WISE0855 = { ra: 133.78, dec: -7.24 };
const BARNARD_J2000 = { ra: 269.452077, dec: 4.693365 };
const MJD_2025_NOV = 60986.0;

describe.skipIf(!process.env.LIVE)('live catalogue services', () => {
  it('Gaia DR3 at the WISE 0855 field finds the G = 16.3 blend star', async () => {
    const rows = await gaiaCone(WISE0855, 120);
    expect(rows.length).toBeGreaterThan(10);
    const blend = rows.find((r) => r.id === '5756956644387831296');
    expect(blend?.mag).toBeCloseTo(16.31, 1);
  }, 60000);

  it("Gaia DR3 around Barnard's Star (J2016 position) has the star itself", async () => {
    const rows = await gaiaCone({ ra: 269.4486, dec: 4.7392 }, 30);
    const star = rows.find((r) => r.pmDec !== undefined && r.pmDec > 10000);
    expect(star).toBeDefined();
    expect(star!.mag!).toBeLessThan(9);
  }, 60000);

  it('SIMBAD: WISE 0855-0714 is found with a generous radius around its J2000 position', async () => {
    const rows = await simbadCone(WISE0855, 300);
    const w = rows.find((r) => /0855/.test(r.id) && (r.pmRa ?? 0) < -7000);
    expect(w).toBeDefined();
    const [p] = propagateCatalog([w!], MJD_2025_NOV);
    // By late 2025 it has moved more than 2.5 arcmin from its J2000 catalogue position.
    expect(angularSepArcsec(w!.ra, w!.dec, p.ra, p.dec)).toBeGreaterThan(150);
    expect(overlaysFromCatalog([w!], MJD_2025_NOV).some((o) => o.kind === 'track')).toBe(true);
  }, 60000);

  it("SIMBAD: Barnard's Star", async () => {
    const rows = await simbadCone(BARNARD_J2000, 60);
    expect(rows.some((r) => /Barnard/i.test(r.id))).toBe(true);
  }, 60000);

  it('SkyBoT returns an array (possibly empty) at both fields', async () => {
    const a = await skybotCone(WISE0855, 900, MJD_2025_NOV);
    const b = await skybotCone({ ra: 269.4486, dec: 4.7392 }, 900, MJD_2025_NOV);
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
    for (const o of [...a, ...b]) expect(Number.isFinite(o.ra) && Number.isFinite(o.dec)).toBe(true);
  }, 90000);

  it('SkyBoT finds main-belt asteroids in a busy ecliptic field', async () => {
    const objs = await skybotCone({ ra: 184.954819867, dec: -4.08981110258 }, 540, 60823.32017);
    expect(objs.length).toBeGreaterThan(3);
    expect(objs.some((o) => o.name === '2022 SW107')).toBe(true);
  }, 90000);

  it('AllWISE W2 image of the WISE 0855 field lands the bright Gaia star on its pixel', async () => {
    const grid: SkyGrid = { ra0: WISE0855.ra, dec0: WISE0855.dec, n: 64, scaleArcsec: 3.075 };
    const f = await externalFrame('allwise-w2', grid);
    expect(f.meta.kind).toBe('external');
    // Gaia DR3 5756955785394371328, G = 13.3: brightest pixel within 1.5 pixels of its position.
    const [wi, wj] = skyToGridPix(grid, 133.79701301043, -7.25786230116);
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let j = Math.floor(wj) - 4; j <= Math.ceil(wj) + 4; j++)
      for (let i = Math.floor(wi) - 4; i <= Math.ceil(wi) + 4; i++) {
        const v = f.data[j * grid.n + i];
        if (v > best) {
          best = v;
          bi = i;
          bj = j;
        }
      }
    expect(Math.hypot(bi - wi, bj - wj)).toBeLessThan(1.5);
    console.log('externalFrame route:', f.meta.notes?.[2]);
  }, 90000);

  it('DSS2 red image of the same field', async () => {
    const grid: SkyGrid = { ra0: WISE0855.ra, dec0: WISE0855.dec, n: 32, scaleArcsec: 3.075 };
    const f = await externalFrame('dss2-red', grid);
    expect(f.data.filter(Number.isFinite).length).toBeGreaterThan(900);
  }, 90000);
});
