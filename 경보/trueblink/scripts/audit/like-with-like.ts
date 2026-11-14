// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Audit experiment: does a naive comparison that mixes wavelengths inside one detector produce
// false variability that the like-with-like (matched-channel) comparison removes?
//
// Data: the baked pixel bundles public/presets/<id>.bundle.{json,bin} (real SPHEREx L2 IMAGE+FLAGS
// read from s3://nasa-irsa-spherex on 2026-11-14) decoded with core/bundle decodeBundle, and Gaia DR3
// field stars from a measure-check cache (node:v8 file written by scripts/measure-check.ts).
//
// For the target (wing photometry, because it is saturated) and for every usable field star it
// compares the first and the last well-covered visit in four ways, per detector:
//   matched  - core/phot matchedRatio per cube channel, median over channels (like with like)
//   stack    - mean of ALL good fluxes of the detector in the later visit / same in the earlier one
//              (a naive per-visit stack that mixes whatever channels each visit has)
//   subset   - the same naive stack after keeping a random 40 % of exposures per visit (what a tool
//              with an exposure cap does), 200 trials, median and 90th percentile of |ratio - 1|
//   single   - time-ordered single frames: k-th exposure of the earlier visit against the k-th of the
//              later one (a naive time-ordered blink), median and max of |ln ratio|
//
// Run: cd /mnt/c/S_N/trueblink && npx tsx scripts/audit/like-with-like.ts <rwaur|rdra> <gaia cache .v8>

import { readFileSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { gunzipSync } from 'node:zlib';
import { groupVisits, PRESETS } from '../../src/core/archive';
import { propagateSource } from '../../src/core/astrometry';
import { decodeBundle, isGzip, type BundleManifest } from '../../src/core/bundle';
import { aperturePhot, matchedRatio } from '../../src/core/phot';
import type { CatalogSource, NativeCutout, PhotPoint, SkyPos } from '../../src/core/types';
import { angularSepArcsec } from '../../src/core/wcs';
import { saturationRadius, wingPhot, wingRings } from '../../src/app/measure/core';

const id = process.argv[2];
const gaiaFile = process.argv[3];
if (!id || !gaiaFile) {
  console.error('usage: npx tsx scripts/audit/like-with-like.ts <preset id> <measure-check cache .v8>');
  process.exit(2);
}
const preset = PRESETS.find((p) => p.id === id);
if (!preset) throw new Error(`unknown preset ${id}`);

const manifest = JSON.parse(readFileSync(`public/presets/${id}.bundle.json`, 'utf8')) as BundleManifest;
let bin = new Uint8Array(readFileSync(`public/presets/${id}.bundle.bin`));
if (isGzip(bin)) bin = new Uint8Array(gunzipSync(bin));
const cutouts: NativeCutout[] = decodeBundle(manifest, bin).sort((a, b) => a.header.mjdAvg - b.header.mjdAvg);
const gaia = ((deserialize(readFileSync(gaiaFile)) as { gaia: CatalogSource[] | null }).gaia ?? []) as CatalogSource[];

const visits = groupVisits(cutouts.map((c) => c.exposure));
const visitOf = new Map<string, number>();
for (const v of visits) for (const e of v.exposureIds) visitOf.set(e, v.index);
console.log(`${preset.name}: ${cutouts.length} cutouts from the bundle, ${visits.length} visits: ${visits.map((v) => `${v.label}(${v.exposureIds.length})`).join(' ')}`);

const posAt = (s: { ra: number; dec: number; epoch: number; pmRa?: number; pmDec?: number; parallax?: number }, mjd: number): SkyPos =>
  propagateSource(s, mjd);

// Target: wing rings from the median saturation radius over the first 40 cutouts.
const radii = cutouts.slice(0, 40).map((c) => saturationRadius(c, posAt(preset, c.header.mjdAvg), 12)).sort((a, b) => a - b);
const satR = radii[Math.floor(radii.length * 0.9)]; // 90th percentile, as in the measure module
const ring = wingRings(satR).phot;
console.log(`target saturation radius ${satR} px -> wing ring ${ring.rin}-${ring.rout} px`);

type Star = { label: string; phot: (c: NativeCutout) => PhotPoint };
const stars: Star[] = [{ label: `${preset.name} (target, wings)`, phot: (c) => wingPhot(c, posAt(preset, c.header.mjdAvg), ring) }];
const centre = manifest.center;
for (const g of gaia) {
  if (!(g.mag !== undefined && g.mag < 17.5)) continue;
  const p = posAt(g, cutouts[0].header.mjdAvg);
  const sepT = angularSepArcsec(p.ra, p.dec, preset.ra, preset.dec);
  const sepC = angularSepArcsec(p.ra, p.dec, centre.ra, centre.dec);
  if (sepT < 6.15 * (ring.rout + 3) || sepC > 110) continue;
  // no brighter or similar Gaia star within 15 arcsec (blends)
  if (gaia.some((o) => o !== g && o.mag !== undefined && o.mag < (g.mag ?? 99) + 2 && angularSepArcsec(o.ra, o.dec, g.ra, g.dec) < 15)) continue;
  stars.push({ label: `Gaia ${g.id} G=${g.mag.toFixed(1)} sep ${sepT.toFixed(0)}"`, phot: (c) => aperturePhot(c, posAt(g, c.header.mjdAvg)) });
}

const median = (xs: number[]): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], q: number): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
let seed = 12345;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Per star: photometry of every cutout.
const table: string[] = [];
const summary: Record<string, { matched: number[]; stack: number[]; subset50: number[]; subset90: number[]; singleMed: number[]; singleMax: number[]; singleMatched: number[] }> = {
  target: { matched: [], stack: [], subset50: [], subset90: [], singleMed: [], singleMax: [], singleMatched: [] },
  field: { matched: [], stack: [], subset50: [], subset90: [], singleMed: [], singleMax: [], singleMatched: [] },
};
for (const [si, s] of stars.entries()) {
  const pts: PhotPoint[] = cutouts.map((c) => ({ ...s.phot(c), visit: visitOf.get(c.exposure.id) }));
  const good = pts.filter((p) => p.good && Number.isFinite(p.flux) && p.flux > 0);
  // Per detector: the first and the last visit with at least 8 good points of this star there.
  let any = false;
  for (let d = 1; d <= 6; d++) {
    const inDet = good.filter((p) => p.detector === d);
    const cov = visits.filter((v) => inDet.filter((p) => p.visit === v.index).length >= 8).map((v) => v.index);
    if (cov.length < 2) continue;
    const vA = cov[0];
    const vB = cov[cov.length - 1];
    const A = inDet.filter((p) => p.visit === vA);
    const B = inDet.filter((p) => p.visit === vB);
    any = true;
    const rows = matchedRatio([...A, ...B], vA, vB);
    const matched = median(rows.map((r) => r.ratio));
    const stack = mean(B.map((p) => p.flux)) / mean(A.map((p) => p.flux));
    const sub: number[] = [];
    for (let t = 0; t < 200; t++) {
      const a = A.filter(() => rnd() < 0.4);
      const b = B.filter(() => rnd() < 0.4);
      if (a.length && b.length) sub.push(Math.abs(mean(b.map((p) => p.flux)) / mean(a.map((p) => p.flux)) - 1));
    }
    const n = Math.min(A.length, B.length);
    const single: number[] = [];
    for (let k = 0; k < n; k++) single.push(Math.abs(Math.log(B[k].flux / A[k].flux)));
    // Noise reference: single frames paired at the SAME cube channel (like with like, one frame each).
    const singleM: number[] = [];
    for (const a of A) {
      const b = B.find((q) => q.cubeChannel === a.cubeChannel);
      if (b) singleM.push(Math.abs(Math.log(b.flux / a.flux)));
    }
    const wA = `${Math.min(...A.map((p) => p.wavelength)).toFixed(2)}-${Math.max(...A.map((p) => p.wavelength)).toFixed(2)}`;
    const wB = `${Math.min(...B.map((p) => p.wavelength)).toFixed(2)}-${Math.max(...B.map((p) => p.wavelength)).toFixed(2)}`;
    table.push(
      `${s.label.padEnd(44)} D${d} ${visits[vA].label}->${visits[vB].label} nA=${A.length} nB=${B.length} ch=${rows.length} ` +
        `matched ${matched.toFixed(3)} | stack ${stack.toFixed(3)} | subset40% |r-1| med ${pct(sub, 0.5).toFixed(3)} p90 ${pct(sub, 0.9).toFixed(3)} | single-frame factor med x${Math.exp(median(single)).toFixed(2)} max x${Math.exp(Math.max(...single)).toFixed(2)} | same-channel single med x${Math.exp(median(singleM)).toFixed(2)}  [um A ${wA} B ${wB}]`,
    );
    const key = si === 0 ? 'target' : 'field';
    if (rows.length >= 3) summary[key].matched.push(Math.abs(matched - 1));
    summary[key].stack.push(Math.abs(stack - 1));
    summary[key].subset50.push(pct(sub, 0.5));
    summary[key].subset90.push(pct(sub, 0.9));
    summary[key].singleMed.push(Math.exp(median(single)));
    summary[key].singleMax.push(Math.exp(Math.max(...single)));
    summary[key].singleMatched.push(Math.exp(median(singleM)));
  }
  if (!any) table.push(`${s.label}: no detector with two visits of >= 8 good points, skipped`);
}
console.log(`stars used: ${stars.length} (1 target + ${stars.length - 1} Gaia field stars)`);
for (const l of table) console.log(l);
const f = summary.field;
console.log('\nFIELD STARS (should be constant), median over star x detector:');
console.log(`  |matched - 1|          median ${median(f.matched).toFixed(3)}  p90 ${pct(f.matched, 0.9).toFixed(3)}  (n=${f.matched.length})`);
console.log(`  |full stack - 1|       median ${median(f.stack).toFixed(3)}  p90 ${pct(f.stack, 0.9).toFixed(3)}`);
console.log(`  |40% subset - 1|       median ${median(f.subset50).toFixed(3)}  p90-of-trials median ${median(f.subset90).toFixed(3)}`);
console.log(`  single-frame factor    median x${median(f.singleMed).toFixed(2)}  max-of-pairs median x${median(f.singleMax).toFixed(2)}  same-channel single frames median x${median(f.singleMatched).toFixed(2)}`);
