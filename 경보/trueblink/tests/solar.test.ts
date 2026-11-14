// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import demo from './fixtures/asteroid_demo.json';
import classMeans from '../public/data/busdemeo_class_means.json';
import { CHANNELS } from '../src/core/wave';
import {
  absoluteMagnitude,
  BUS_DEMEO_GROUPS,
  classifyBusDemeo,
  crossoverWavelength,
  describeGroup,
  fitThermalTail,
  neatmFlux,
  planckNu,
  reflectedFlux,
  solarFluxMjy,
  stmFlux,
  THERMAL_NOTES,
  toReflectance,
  type AsteroidPoint,
} from '../src/core/solar';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

/** Small deterministic random generator (mulberry32) and a Gaussian from it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

describe('solar spectrum table (CALSPEC sun_mod_001)', () => {
  it('covers 0.5-5.2 um and is NaN outside', () => {
    expect(solarFluxMjy(0.5)).toBeGreaterThan(0);
    expect(solarFluxMjy(5.2)).toBeGreaterThan(0);
    expect(solarFluxMjy(0.4)).toBeNaN();
    expect(solarFluxMjy(5.3)).toBeNaN();
  });
  it('matches the research table (R~40 averages) and the inverse-square law', () => {
    // research_notes thermal_models.mjs SUN_JY at 0.55, 1.0 and 2.2 um (Jy -> mJy)
    expect(rel(solarFluxMjy(0.55), 1.9049e17)).toBeLessThan(0.005);
    expect(rel(solarFluxMjy(1.0), 2.4356e17)).toBeLessThan(0.005);
    expect(rel(solarFluxMjy(2.2), 1.3265e17)).toBeLessThan(0.005);
    expect(rel(solarFluxMjy(2.2, 2), solarFluxMjy(2.2) / 4)).toBeLessThan(1e-12);
  });
  it('is not a 5772 K blackbody beyond 4.4 um (blackbody about 20 % too bright)', () => {
    const rsunAu = 6.957e8 / 1.495978707e11;
    const bb = (l: number) => planckNu(l, 5772) * Math.PI * rsunAu ** 2 * 1e29;
    for (const l of [4.5, 4.8, 5.0]) expect(solarFluxMjy(l) / bb(l)).toBeLessThan(0.9);
    expect(rel(solarFluxMjy(1.0), bb(1.0))).toBeLessThan(0.02);
  });
});

describe('thermal models: Ceres regression vectors of thermal_models.mjs', () => {
  const g = { diameterKm: 939, pV: 0.09, G: 0.12, emissivity: 0.9, rAu: 2.77, deltaAu: 1.9, phaseDeg: 12.34 };
  const H = absoluteMagnitude(939, 0.09);
  const refl = (l: number) => reflectedFlux({ H, G: 0.12, rAu: 2.77, deltaAu: 1.9, phaseDeg: 12.34 }, l);
  it('H from D and pV', () => expect(H).toBeCloseTo(3.369, 3));
  it('STM thermal 25.47 / 1350 / 12820 mJy at 3 / 4 / 5 um (1 %)', () => {
    expect(rel(stmFlux(g, 3), 25.47)).toBeLessThan(0.01);
    expect(rel(stmFlux(g, 4), 1350)).toBeLessThan(0.01);
    expect(rel(stmFlux(g, 5), 12820)).toBeLessThan(0.01);
  });
  it('NEATM eta 0.756 / 0.91 / 1.0 at 4 um (1 %)', () => {
    expect(rel(neatmFlux({ ...g, eta: 0.756 }, 4), 1477)).toBeLessThan(0.01);
    expect(rel(neatmFlux({ ...g, eta: 0.91 }, 4), 740.7)).toBeLessThan(0.01);
    expect(rel(neatmFlux({ ...g, eta: 1.0 }, 5), 6009)).toBeLessThan(0.01);
  });
  it('reflected sunlight 1239 / 730.7 / 443.2 mJy at 3 / 4 / 5 um (5 %)', () => {
    expect(rel(refl(3), 1239)).toBeLessThan(0.05);
    expect(rel(refl(4), 730.7)).toBeLessThan(0.05);
    expect(rel(refl(5), 443.2)).toBeLessThan(0.05);
  });
  it('STM crossover at 3.825 um and NEATM eta 1.0 at 4.100 um (1 %)', () => {
    expect(rel(crossoverWavelength((l) => stmFlux(g, l), refl), 3.825)).toBeLessThan(0.01);
    expect(rel(crossoverWavelength((l) => neatmFlux({ ...g, eta: 1 }, l), refl), 4.1)).toBeLessThan(0.01);
  });
  it('NEATM at zero phase equals STM without phase correction', () => {
    const z = { ...g, phaseDeg: 0 };
    expect(rel(neatmFlux({ ...z, eta: 0.9 }, 4.5), stmFlux({ ...z, eta: 0.9 }, 4.5))).toBeLessThan(1e-3);
  });
  it('exports caveats', () => expect(THERMAL_NOTES.length).toBeGreaterThan(3));
});

/** A synthetic dark main-belt asteroid observed at SPHEREx-like quadrature geometry. */
function synthAsteroid(eta: number, noise: number, seed = 1): { pts: AsteroidPoint[]; fixed: { diameterKm: number; pV: number; H: number; G: number } } {
  const fixed = { diameterKm: 40, pV: 0.06, H: absoluteMagnitude(40, 0.06), G: 0.15 };
  const gauss = rng(seed);
  const pts: AsteroidPoint[] = [];
  CHANNELS.forEach((c, i) => {
    const geo = { rAu: 2.6 + 0.0005 * i, deltaAu: 2.4, phaseDeg: 22 };
    const slope = 1 + 0.1 * (c.wavelength - 1.2); // gently red reflectance
    const f =
      reflectedFlux({ H: fixed.H, G: fixed.G, ...geo, reflectanceRatio: slope }, c.wavelength) +
      neatmFlux({ diameterKm: fixed.diameterKm, pV: fixed.pV, eta, G: fixed.G, ...geo }, c.wavelength);
    const err = noise * f + 0.05;
    pts.push({ wavelength: c.wavelength, flux: f + err * gauss(), fluxErr: err, good: true, ...geo });
  });
  return { pts, fixed };
}

describe('toReflectance', () => {
  it('recovers the input reflectance shape, normalised to 1 at 1.20 um', () => {
    const geo = { rAu: 2.5, deltaAu: 2.1, phaseDeg: 20 };
    const pts = [0.9, 1.0, 1.15, 1.2, 1.25, 2.0].map((l) => ({
      wavelength: l,
      flux: reflectedFlux({ H: 10, ...geo, reflectanceRatio: 1 + 0.5 * (l - 1.2) }, l),
      fluxErr: 0.01,
      ...geo,
    }));
    const r = toReflectance(pts);
    expect(r).toHaveLength(6);
    expect(r[3].reflectance).toBeCloseTo(1, 6);
    expect(r[5].reflectance).toBeCloseTo((1 + 0.5 * 0.8) / 1, 2);
    expect(r[0].reflectance).toBeCloseTo(1 - 0.5 * 0.3, 2);
  });
  it('keeps NaN for missing data and throws without a normalisation point', () => {
    const geo = { rAu: 2.5, deltaAu: 2.1, phaseDeg: 20 };
    const r = toReflectance([
      { wavelength: 1.2, flux: 1, fluxErr: 0.1, ...geo },
      { wavelength: 1.5, flux: NaN, fluxErr: 0.1, ...geo },
    ]);
    expect(r[1].reflectance).toBeNaN();
    expect(() => toReflectance([{ wavelength: 2, flux: 1, fluxErr: 0.1, ...geo }])).toThrow(/normalise/);
  });
});

describe('fitThermalTail', () => {
  it('recovers eta of a synthetic asteroid', () => {
    for (const eta of [0.9, 1.3]) {
      const { pts, fixed } = synthAsteroid(eta, 0.02, 7);
      const r = fitThermalTail(pts, fixed);
      expect(Math.abs(r.eta - eta)).toBeLessThan(Math.max(3 * r.etaErr, 0.03));
      expect(r.etaErr).toBeGreaterThan(0);
      expect(r.crossoverUm).toBeGreaterThan(3);
      expect(r.crossoverUm).toBeLessThan(5);
      expect(r.chi2).toBeGreaterThan(0);
    }
  });
  it('refuses with fewer than 5 usable points beyond 3.3 um', () => {
    const { pts, fixed } = synthAsteroid(1, 0.02);
    const few = pts.filter((p) => p.wavelength < 3.3 || p.wavelength > 4.9);
    expect(few.filter((p) => p.wavelength > 3.3).length).toBeLessThan(5);
    expect(() => fitThermalTail(few, fixed)).toThrow(/at least 5/);
    const bad = pts.map((p) => (p.wavelength > 3.5 ? { ...p, good: false } : p));
    expect(() => fitThermalTail(bad, fixed)).toThrow(/refused/);
  });
});

/** Every Bus-DeMeo class mean sampled at SPHEREx band 1-3 channels (two passes), with noise and band offsets. */
function sampledTemplate(cls: string, snr: number, seed: number) {
  const cm = classMeans as unknown as { wave_um: number[]; classes: Record<string, { mean: number[] }> };
  const w = cm.wave_um;
  const m = cm.classes[cls].mean;
  const at = (l: number) => {
    let i = 0;
    while (i < w.length - 2 && w[i + 1] < l) i++;
    return m[i] + ((l - w[i]) / (w[i + 1] - w[i])) * (m[i + 1] - m[i]);
  };
  const gauss = rng(seed);
  const offsets = [1.0, 1.04, 0.97];
  const spec: { wavelength: number; reflectance: number; err: number }[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const c of CHANNELS) {
      if (c.detector > 3 || c.wavelength < 0.85) continue;
      const band = c.wavelength < 1.11 ? 0 : c.wavelength <= 1.64 ? 1 : 2;
      const truth = at(c.wavelength) * offsets[band];
      const err = truth / snr;
      spec.push({ wavelength: c.wavelength, reflectance: truth + err * gauss(), err });
    }
  }
  return spec;
}

describe('classifyBusDemeo', () => {
  const classes = Object.keys(BUS_DEMEO_GROUPS);
  it('each class mean fed back with noise (S/N 100) returns its own group', () => {
    for (const cls of classes) {
      for (const seed of [1, 2, 3]) {
        const res = classifyBusDemeo(sampledTemplate(cls, 100, seed + cls.length * 17));
        // The class itself must win its own group, and a named answer must be the right one.
        expect(res.ranked[0].group, `${cls} seed ${seed}`).toBe(BUS_DEMEO_GROUPS[cls]);
        if (!res.refused) expect(res.group).toBe(BUS_DEMEO_GROUPS[cls]);
      }
    }
  });
  it('names the group for the well-separated classes at S/N 100', () => {
    for (const cls of ['S', 'V', 'A', 'C', 'D', 'R', 'O']) {
      const res = classifyBusDemeo(sampledTemplate(cls, 100, 11));
      expect(res.refused, cls).toBeUndefined();
      expect(res.group).toBe(BUS_DEMEO_GROUPS[cls]);
      expect(res.gapToNext).toBeGreaterThanOrEqual(9);
    }
  });
  it('never outputs a sub-class or the w flag', () => {
    const allowed = new Set(['S-like', 'V', 'A', 'C/X-like', 'D', 'K/L', 'O', 'R', '']);
    for (const cls of classes) {
      const res = classifyBusDemeo(sampledTemplate(cls, 50, 5));
      expect(allowed.has(res.group)).toBe(true);
      expect(res.group).not.toMatch(/w$/);
    }
  });
  it('refusal gates', () => {
    const good = sampledTemplate('S', 100, 3);
    expect(classifyBusDemeo(good.slice(0, 11)).refused).toMatch(/Too few points/);
    expect(classifyBusDemeo(good.filter((p) => p.wavelength > 1.11 || p.wavelength < 0.9)).refused).toMatch(/below 1.11/);
    const noisy = good.map((p) => ({ ...p, err: p.reflectance / 5 }));
    expect(classifyBusDemeo(noisy).refused).toMatch(/Signal-to-noise/);
    const tooSmallErr = sampledTemplate('S', 100, 3).map((p) => ({ ...p, err: p.err / 10 }));
    expect(classifyBusDemeo(tooSmallErr).refused).toMatch(/reduced chi-square/);
    // Ambiguous: at S/N 15 a K-type is not separated from the C/X-like templates by 9 in chi-square.
    const amb = classifyBusDemeo(sampledTemplate('K', 15, 4));
    expect(amb.refused).toMatch(/Ambiguous/);
    expect(amb.gapToNext).toBeLessThan(9);
    expect(amb.ranked.length).toBe(Object.keys(BUS_DEMEO_GROUPS).length);
    for (const r of [classifyBusDemeo([]), classifyBusDemeo(good.slice(0, 11))]) expect(r.group).toBe('');
  });
  it('describeGroup returns plain text for every group and for a refusal', () => {
    for (const g of ['S-like', 'V', 'A', 'C/X-like', 'D', 'K/L', 'O', 'R', '']) {
      const t = describeGroup(g);
      expect(t.split('. ').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('measured asteroids in asteroid_demo.json', () => {
  type DemoPoint = { wavelength_um: number; flux_mJy: number; err_mJy: number; r_au: number; delta_au: number; phase_deg: number; kept: boolean; lightcurve_factor: number; visit: number };
  type DemoAsteroid = { name: string; catalogued_taxonomy: string; literature: { diameter_km: number; geometric_albedo_V: number; H: number; G: number } };
  const d = demo as unknown as { best_asteroid: DemoAsteroid; points: DemoPoint[]; additional_asteroids: (DemoAsteroid & { points: DemoPoint[] })[] };
  const all = [{ ...d.best_asteroid, points: d.points }, ...d.additional_asteroids];
  const toPts = (pp: DemoPoint[]): (AsteroidPoint & { visit: number })[] =>
    pp.map((p) => ({
      wavelength: p.wavelength_um,
      flux: p.flux_mJy / p.lightcurve_factor,
      fluxErr: p.err_mJy,
      good: p.kept,
      rAu: p.r_au,
      deltaAu: p.delta_au,
      phaseDeg: p.phase_deg,
      visit: p.visit,
    }));
  const groupOf = (t: string) => BUS_DEMEO_GROUPS[t] ?? BUS_DEMEO_GROUPS[t.replace(/w$/, '')];

  for (const a of all) {
    it(`${a.name} (catalogued ${a.catalogued_taxonomy}) lands in its group or is refused with a reason`, () => {
      const pts = toPts(a.points);
      const refl = toReflectance(pts, { G: a.literature.G }).filter((_, i) => pts[i].good);
      // Contract behaviour (formal errors only): either the right group or a stated refusal.
      const strict = classifyBusDemeo(refl);
      if (strict.refused) expect(strict.refused.length).toBeGreaterThan(10);
      else expect(strict.group).toBe(groupOf(a.catalogued_taxonomy));
      // With a 3 % floor for rotation and calibration scatter both land in their catalogued group.
      const floored = classifyBusDemeo(refl, { errorFloor: 0.03 });
      expect(floored.refused).toBeUndefined();
      expect(floored.group).toBe(groupOf(a.catalogued_taxonomy));
    });
  }

  it('Hygiea thermal tail gives eta near the research value (0.885 and 0.832 per visit)', () => {
    const h = all[0];
    const pts = toPts(h.points);
    const lit = h.literature;
    const etas = [0, 1].map((v) =>
      fitThermalTail(pts.filter((p) => p.visit === v), { diameterKm: lit.diameter_km, pV: lit.geometric_albedo_V, H: lit.H, G: lit.G }),
    );
    expect(Math.abs(etas[0].eta - 0.885)).toBeLessThan(0.03);
    expect(Math.abs(etas[1].eta - 0.832)).toBeLessThan(0.03);
    for (const e of etas) expect(e.crossoverUm).toBeGreaterThan(3.8);
  });
});
