// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Hits the real IRSA SIA service and CDS Sesame. Run with:  LIVE=1 npx vitest run tests/live/archive.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverCollectionsDetailed, findPreset, groupVisits, searchExposuresDetailed, setApiBase } from '../../src/core/archive';
import { propagate, resolveName } from '../../src/core/resolve';
import { angularSepArcsec } from '../../src/core/wcs';

const live = !!process.env.LIVE;

describe.skipIf(!live)('live archive (IRSA SIA, direct from Node)', () => {
  beforeAll(() => setApiBase('https://irsa.ipac.caltech.edu'));
  afterAll(() => setApiBase(null));

  it('discovers the SPHEREx Level-2 collections', async () => {
    const d = await discoverCollectionsDetailed();
    expect(d.warning).toBeUndefined();
    expect(d.collections).toContain('spherex_dr1');
    expect(d.collections).toContain('spherex_qr3');
    expect(d.collections.some((c) => c.endsWith('_cube') || c.endsWith('_cal'))).toBe(false);
  });

  it('finds about 258 DR1 exposures at WISE 0855-0714', async () => {
    const p = findPreset('wise0855')!;
    const pos = propagate(p, 61000);
    const res = await searchExposuresDetailed(pos);
    const dr1 = res.exposures.filter((e) => e.collection === 'spherex_dr1');
    expect(dr1.length).toBeGreaterThan(240);
    expect(dr1.length).toBeLessThan(280);
    expect(res.truncated).toEqual([]);
    // Dichroic partners: every obsId comes as detector pairs (1,4), (2,5) or (3,6).
    const byObs = new Map<string, number[]>();
    for (const e of dr1) byObs.set(e.obsId, [...(byObs.get(e.obsId) ?? []), e.detector]);
    for (const dets of byObs.values()) {
      dets.sort();
      expect([[1, 4], [2, 5], [3, 6]].some((pair) => pair[0] === dets[0] && pair[1] === dets[1])).toBe(true);
    }
    expect(dr1.every((e) => e.s3Key.startsWith('dr1/level2/'))).toBe(true);
    expect(groupVisits(dr1).length).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!live)('live name resolution (CDS Sesame)', () => {
  const cases: [string, string][] = [
    ["Barnard's Star", 'barnard'],
    ['Epsilon Indi B', 'epsIndB'],
    ['WISE 0855-0714', 'wise0855'],
    ['RW Aurigae', 'rwaur'],
    ['R Draconis', 'rdra'],
  ];
  for (const [name, id] of cases) {
    it(`resolves ${name}`, async () => {
      const t = await resolveName(name);
      expect(t).not.toBeNull();
      const p = findPreset(id)!;
      expect(t!.id).toBe(id);
      expect(t!.epoch).toBe(2000);
      // Sesame (SIMBAD) and our Gaia-based presets agree to a couple of arcsec (RW Aur: 1.4").
      expect(angularSepArcsec(t!.ra, t!.dec, p.ra, p.dec)).toBeLessThan(3);
      if (Math.abs(p.pmRa ?? 0) > 1000) expect(Math.abs((t!.pmRa ?? 0) - (p.pmRa ?? 0))).toBeLessThan(5);
    });
  }

  it('falls back to SIMBAD TAP when the Sesame mirrors are unreachable', async () => {
    const noSesame = (u: string, init?: RequestInit): Promise<Response> =>
      /nph-sesame/.test(u) ? Promise.reject(new TypeError('blocked for the test')) : fetch(u, init);
    const t = await resolveName('R Dra', undefined, { fetch: noSesame });
    expect(t).not.toBeNull();
    expect(angularSepArcsec(t!.ra, t!.dec, 248.16761, 66.75498)).toBeLessThan(1);
    expect(t!.pmRa).toBeCloseTo(-20.643, 1);
  });

  it('returns null for nonsense and resolves a plain SIMBAD name', async () => {
    expect(await resolveName('qqzx no such object 12345')).toBeNull();
    const m31 = await resolveName('M31');
    expect(m31).not.toBeNull();
    expect(angularSepArcsec(m31!.ra, m31!.dec, 10.6847, 41.2690)).toBeLessThan(10);
  });
});
