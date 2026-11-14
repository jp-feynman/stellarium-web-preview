// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Node harness for the measurement module on REAL SPHEREx data, no browser needed:
//  1. search exposures directly at IRSA SIA (falls back to public/presets/<id>.json),
//  2. load up to --cap cutouts (IMAGE + FLAGS) from the public S3 bucket with core/frames loadCutout,
//  3. fetch Gaia DR3 around the field (for comparison stars and blend checks; optional),
//  4. fill the session object, run runMeasurements and print the findings and numbers.
//
// Run:  cd /mnt/c/S_N/trueblink && npx tsx scripts/measure-check.ts <preset id> [--cap N] [--fov ARCSEC] [--no-cache] [--no-gaia]
// Cutouts are cached (node:v8 serialisation) under $MEASURE_CACHE or ./node_modules/.measure-cache
// so re-running to tune is fast.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { groupVisits, PRESETS, searchExposuresDetailed, setApiBase, visitIndexById } from '../src/core/archive';
import { gaiaCone } from '../src/core/catalogs';
import { loadCutout } from '../src/core/frames';
import { propagate } from '../src/core/resolve';
import { mjdToIsoDate, type CatalogSource, type Exposure, type NativeCutout } from '../src/core/types';
import { useMeasure, runMeasurements } from '../src/app/measure';
import { lightCurveSwing } from '../src/app/measure/findings';
import { session, resetSession } from '../src/app/session';
import { useApp } from '../src/app/store';

function args(argv: string[]) {
  const o = { id: '', cap: 200, fov: 240, cache: true, gaia: true };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--cap') o.cap = Number(argv[++k]);
    else if (a === '--fov') o.fov = Number(argv[++k]);
    else if (a === '--no-cache') o.cache = false;
    else if (a === '--no-gaia') o.gaia = false;
    else if (!a.startsWith('--')) o.id = a;
  }
  return o;
}

/** Spread the cap over time (and prefer arrays 5+6 for cold targets). */
function pick(exposures: Exposure[], cap: number, cold: boolean): Exposure[] {
  if (exposures.length <= cap) return exposures;
  const pri = cold ? exposures.filter((e) => e.detector >= 5) : [];
  const rest = exposures.filter((e) => !pri.includes(e));
  const take = (list: Exposure[], n: number) => {
    if (n <= 0) return [];
    if (list.length <= n) return list;
    const step = list.length / n;
    return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
  };
  const a = take(pri, cap);
  return [...a, ...take(rest, cap - a.length)].sort((x, y) => x.mjd - y.mjd);
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function main(): Promise<void> {
  const o = args(process.argv.slice(2));
  const preset = PRESETS.find((p) => p.id.toLowerCase() === o.id.toLowerCase());
  if (!preset) {
    console.error(`usage: npx tsx scripts/measure-check.ts <${PRESETS.map((p) => p.id).join('|')}> [--cap N] [--fov ARCSEC]`);
    process.exit(2);
  }
  const cacheDir = process.env.MEASURE_CACHE ?? join(process.cwd(), 'node_modules', '.measure-cache');
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, `${preset.id}-${o.cap}-${o.fov}.v8`);
  const MJD_2026 = 51544.5 + 26 * 365.25;
  const searchPos = propagate(preset, MJD_2026);

  let exposures: Exposure[] = [];
  let cutouts: NativeCutout[] = [];
  let gaia: CatalogSource[] | null = null;
  if (o.cache && existsSync(cacheFile)) {
    const c = deserialize(readFileSync(cacheFile)) as { exposures: Exposure[]; cutouts: NativeCutout[]; gaia: CatalogSource[] | null };
    ({ exposures, cutouts, gaia } = c);
    console.log(`cache: ${cutouts.length} cutouts from ${cacheFile}`);
  } else {
    setApiBase('https://irsa.ipac.caltech.edu');
    try {
      const res = await searchExposuresDetailed(searchPos, { onWarning: (m) => console.warn('SIA:', m) });
      exposures = res.exposures;
      console.log(`SIA: ${exposures.length} exposures from ${res.collections.join(', ')}`);
    } catch (e) {
      console.warn('SIA failed, using the baked preset list:', (e as Error).message);
      const f = join(process.cwd(), 'public', 'presets', `${preset.id}.json`);
      if (existsSync(f)) exposures = (JSON.parse(readFileSync(f, 'utf8')) as { exposures: Exposure[] }).exposures;
    }
    const cold = /^Y/i.test(preset.spectralType ?? '');
    const chosen = pick(exposures, o.cap, cold);
    let done = 0;
    const t0 = Date.now();
    await pool(chosen, 12, async (e) => {
      try {
        const c = await loadCutout(e, propagate(preset, e.mjd), o.fov, { planes: ['FLAGS'] });
        if (c) cutouts.push(c);
      } catch (err) {
        console.warn(`  ${e.id}: ${(err as Error).message}`);
      }
      done++;
      if (done % 25 === 0) console.log(`  loaded ${done}/${chosen.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    });
    if (o.gaia) {
      try {
        gaia = await gaiaCone(searchPos, o.fov * 0.75 + 60);
        console.log(`Gaia: ${gaia.length} stars`);
      } catch (e) {
        console.warn('Gaia failed:', (e as Error).message);
      }
    }
    writeFileSync(cacheFile, serialize({ exposures, cutouts, gaia }));
  }
  cutouts.sort((a, b) => a.header.mjdAvg - b.header.mjdAvg);

  // Fill the session the way the app pipeline does.
  resetSession();
  const visits = groupVisits(exposures);
  session.target = preset;
  session.center = searchPos;
  session.fovArcsec = o.fov;
  session.exposures = exposures;
  session.visits = visits;
  session.visitOf = visitIndexById(visits);
  session.cutouts = new Map(cutouts.map((c) => [c.exposure.id, c]));
  session.gaia = gaia;
  session.source = 'live';
  useApp.getState().setTarget(preset);

  await runMeasurements();
  const { result: r, specs, status, error } = useMeasure.getState();
  if (!r) {
    console.error('no result', status, error);
    process.exit(1);
  }
  const f2 = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : 'NaN');
  console.log(`\n=== ${preset.name}: ${r.nCutouts} cutouts, ${visits.length} visits (${visits.map((v) => `${v.label}:${v.exposureIds.length}`).join(', ')})`);
  console.log(`points ${r.points.length}, good ${r.points.filter((p) => p.good).length}, saturated ${r.saturatedCount}, relative=${r.relative}, cold=${r.cold}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  if (r.motion) {
    const m = r.motion;
    console.log(`motion (${m.method}, detectors ${m.detectors.join('')}, ${m.nCentroids} centroids):`);
    for (const e of m.epochs) console.log(`  visit ${e.visit} ${mjdToIsoDate(e.mjd)} n=${e.n} dRa=${f2(e.dRa)} dDec=${f2(e.dDec)} err=${f2(e.err)} arcsec`);
    if (m.fit) {
      console.log(`  fit: pmRa ${f2(m.fit.pmRa / 1000)} pmDec ${f2(m.fit.pmDec / 1000)} total ${f2(m.fit.total / 1000)} ± ${f2(m.fit.totalErr / 1000)} arcsec/yr (twoPoint=${m.fit.twoPoint}, chi2 ${f2(m.fit.chi2, 1)})`);
    }
    if (m.catalogue) console.log(`  catalogue: pmRa ${f2(m.catalogue.pmRa / 1000)} pmDec ${f2(m.catalogue.pmDec / 1000)} total ${f2(m.catalogue.total / 1000)} arcsec/yr`);
    console.log(`  significant=${m.significant} threshold ${f2(m.threshold / 1000)} control median ${f2(m.controlMedian / 1000)} arcsec/yr`);
  }
  if (r.ratio) {
    console.log(`ratio ${r.ratio.labelB}/${r.ratio.labelA}: ${f2(r.ratio.combined.ratio)} ± ${f2(r.ratio.combined.ratioErr)} in ${r.ratio.rows.length} channels`);
    const b = r.ratio.bands;
    if (b) console.log(`  0.75-2.4 um: ${f2(b.short.ratio)} ± ${f2(b.short.ratioErr)} (${b.short.n} ch); 2.4-5.0 um: ${f2(b.long.ratio)} ± ${f2(b.long.ratioErr)} (${b.long.n} ch)`);
    if (r.ratio.perDetector) console.log(`  per array: ${r.ratio.perDetector.map((d) => `D${d.detector} ${f2(d.ratio)}±${f2(d.ratioErr)}`).join(', ')}`);
    const rg = r.ratio.rings;
    if (rg) console.log(`  wing ring ${rg.phot.rin}-${rg.phot.rout} px vs ${rg.alt.rin}-${rg.alt.rout} px: short ${f2(b?.short.ratio ?? NaN)} vs ${f2(rg.altBands.short.ratio)}, long ${f2(b?.long.ratio ?? NaN)} vs ${f2(rg.altBands.long.ratio)}`);
  }
  console.log(`light curve: ${r.lightCurve.map((p) => `${mjdToIsoDate(p.mjd)} ${f2(p.rel)}±${f2(p.relErr)} (${p.nChannels} ch)`).join('; ')}`);
  const sw = lightCurveSwing(r.lightCurve);
  if (sw) console.log(`light-curve swing (visits with >= 5 channels): ${f2(sw.swing)} ± ${f2(sw.err)} over ${sw.n} visits`);
  console.log(`controls (${r.controls.length}):`);
  for (const c of r.controls) {
    console.log(
      `  ${c.star.label} pm ${c.fit ? f2(c.fit.total / 1000) : '-'} ± ${c.fit ? f2(c.fit.totalErr / 1000) : '-'} arcsec/yr, ratio ${c.ratio ? f2(c.ratio.ratio) : '-'} (${c.ratio?.n ?? 0} ch), visits ${c.epochs.length}, swing ${f2(lightCurveSwing(c.lightCurve)?.swing ?? NaN)} ± ${f2(lightCurveSwing(c.lightCurve)?.err ?? NaN)} (${lightCurveSwing(c.lightCurve)?.n ?? 0} visits)`,
    );
  }
  for (const n of r.neighbours) console.log(`neighbour: Gaia ${n.id} G=${n.mag} closest ${f2(n.sepArcsec, 1)} arcsec on ${n.date}`);
  const best = r.binned.filter((b) => b.flux / b.fluxErr >= 3);
  console.log(`spectrum: ${r.binned.length} bins, ${best.length} detected (S/N >= 3)`);
  console.log('\nFindings:');
  for (const f of useApp.getState().findings) {
    console.log(`- [${f.kind}/${f.confidence}] ${f.title}: ${f.body}${f.value ? ` | ours ${f.value}` : ''}${f.reference ? ` | ref ${f.reference}` : ''}`);
  }
  console.log(`(${specs.length} finding specs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
