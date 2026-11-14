// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Audit helper: run the app's own measureSession on a measure-check cache (real cutouts) and print
// the per-channel matched ratios behind the single "combined" brightness number, grouped by
// detector, plus which rows robustRatio keeps. Shows whether a wavelength-dependent change is
// summarised by one number.
//
// Run: cd /mnt/c/S_N/trueblink && npx tsx scripts/audit/ratio-rows.ts <preset id> <measure-check cache .v8>

import { readFileSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { groupVisits, PRESETS, visitIndexById } from '../../src/core/archive';
import type { CatalogSource, Exposure, NativeCutout } from '../../src/core/types';
import { measureSession } from '../../src/app/measure';

const [id, file] = process.argv.slice(2);
const preset = PRESETS.find((p) => p.id === id);
if (!preset || !file) {
  console.error('usage: npx tsx scripts/audit/ratio-rows.ts <preset id> <cache .v8>');
  process.exit(2);
}
const c = deserialize(readFileSync(file)) as { exposures: Exposure[]; cutouts: NativeCutout[]; gaia: CatalogSource[] | null };
const visits = groupVisits(c.exposures);
const r = measureSession(
  { id: 1, target: preset, center: null, cutouts: new Map(c.cutouts.map((x) => [x.exposure.id, x])), visits, visitOf: visitIndexById(visits), gaia: c.gaia },
  null,
);
if (!r.ratio) {
  console.log('no ratio');
  process.exit(0);
}
console.log(`${preset.name}: ${r.ratio.labelB} / ${r.ratio.labelA}, combined ${r.ratio.combined.ratio.toFixed(3)} ± ${r.ratio.combined.ratioErr.toFixed(3)} (n=${r.ratio.combined.n} of ${r.ratio.rows.length} rows)`);
const byDet = new Map<number, number[]>();
for (const row of r.ratio.rows) {
  const d = Math.floor((row.cubeChannel - 1) / 17) + 1;
  if (!byDet.has(d)) byDet.set(d, []);
  byDet.get(d)!.push(row.ratio);
}
for (const [d, xs] of [...byDet].sort((a, b) => a[0] - b[0])) {
  const s = [...xs].sort((a, b) => a - b);
  console.log(`  D${d}: ${xs.length} channels, median ${s[Math.floor(s.length / 2)].toFixed(3)}, range ${s[0].toFixed(2)}-${s[s.length - 1].toFixed(2)}`);
}
