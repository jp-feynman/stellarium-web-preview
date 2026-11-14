// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Bake the preset targets for offline use:
//  1. the exposure lists -> public/presets/<id>.json (so the app works when the SIA relay is down);
//  2. for the five challenge targets, the native pixels (IMAGE + FLAGS) of up to MAX_CUTOUTS exposures
//     -> public/presets/<id>.bundle.json (manifest) + <id>.bundle.bin (gzip), read straight from the
//     public S3 bucket, so the challenge targets appear within seconds even when the archive is down.
// Queries IRSA SIA directly (Node has no CORS restriction).
//
// Run:  cd /mnt/c/S_N/trueblink && npx tsx scripts/bake-presets.ts [--only <id>] [--skip-sia] [--no-pixels] [--cap N] [id ...]
//   --only <id>   bake one preset (repeatable; bare ids work too)
//   --skip-sia    reuse the existing public/presets/<id>.json instead of querying SIA again
//   --no-pixels   exposure lists only
//   --cap N       start from N cutouts per preset (default 420; reduced automatically to fit 8 MB)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { discoverCollectionsDetailed, groupVisits, PRESETS, searchExposuresDetailed, setApiBase, type PresetBundle, type PresetTarget } from '../src/core/archive';
import { encodeBundle } from '../src/core/bundle';
import { loadCutout } from '../src/core/frames';
import { propagate } from '../src/core/resolve';
import { approxPixFromRegion, channelAt } from '../src/core/wave';
import { mjdToIsoDate, type Exposure, type NativeCutout, type SkyPos } from '../src/core/types';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'presets');
/** Julian year 2026.0 as MJD: the middle of the DR1 + QR3 coverage. */
const BAKE_EPOCH = 2026.0;
const BAKE_MJD = 51544.5 + (BAKE_EPOCH - 2000) * 365.25;
/** Row cap per deep collection; the north ecliptic pole has ~21,000 deep exposures, too many to bake. */
const DEEP_CAP: Record<string, number> = { nep: 1500 };

/** Field the app shows for a preset, and the larger field the baked windows cover (so a slightly
 *  different centre, e.g. the target propagated to each visit, still hits the bundle). */
const FOV_ARCSEC = 180;
const WINDOW_FOV_ARCSEC = 240;
const DEFAULT_CAP = 420;
const MAX_BIN_BYTES = 8 * 1024 * 1024;
const IN_FLIGHT = 16;

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/** Trim float noise so the JSON stays small (1e-7 deg = 0.4 mas; 1e-7 day = 9 ms). */
function compact(e: Exposure): Exposure {
  return { ...e, mjd: round(e.mjd, 7), sRa: round(e.sRa, 7), sDec: round(e.sDec, 7), sRegion: e.sRegion.map((v) => round(v, 7)) };
}

function parseArgs(argv: string[]): { only: string[]; skipSia: boolean; pixels: boolean; cap: number } {
  const only: string[] = [];
  let skipSia = false;
  let pixels = true;
  let cap = DEFAULT_CAP;
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--only') only.push(argv[++k] ?? '');
    else if (a === '--skip-sia') skipSia = true;
    else if (a === '--no-pixels') pixels = false;
    else if (a === '--cap') cap = Number(argv[++k]);
    else if (!a.startsWith('--')) only.push(a);
    else throw new Error(`unknown option ${a}`);
  }
  if (!(cap > 0)) throw new Error('--cap needs a positive number');
  for (const id of only) if (!PRESETS.some((p) => p.id === id)) throw new Error(`unknown preset id "${id}" (known: ${PRESETS.map((p) => p.id).join(', ')})`);
  return { only, skipSia, pixels, cap };
}

// ---------------------------------------------------------------------------------------------
// Exposure lists (SIA)

async function bakeExposureLists(presets: PresetTarget[]): Promise<void> {
  const disc = await discoverCollectionsDetailed();
  if (disc.warning) console.warn(`WARNING: ${disc.warning}`);
  console.log(`Collections: ${disc.collections.join(', ')}`);

  const table: string[][] = [['id', 'ra (2026.0)', 'dec (2026.0)', ...disc.collections, 'total', 'visits', 'notes']];
  for (const p of presets) {
    const pos = propagate(p, BAKE_MJD);
    const res = await searchExposuresDetailed(pos, { collections: disc.collections, maxPerCollection: DEEP_CAP[p.id] });
    // A cap given for the deep fields must not cut the wide survey: warn loudly if it did.
    const wideCut = res.truncated.filter((c) => !c.endsWith('_deep'));
    if (wideCut.length) console.warn(`WARNING: ${p.id}: wide-survey collection(s) truncated: ${wideCut.join(', ')}`);
    const warnings = [...(disc.warning ? [disc.warning] : []), ...res.warnings];
    const bundle: PresetBundle = {
      target: p,
      generated: new Date().toISOString(),
      collections: res.collections,
      exposures: res.exposures.map(compact),
      searchPos: { ra: round(pos.ra, 7), dec: round(pos.dec, 7) },
      searchEpoch: BAKE_EPOCH,
      ...(warnings.length ? { warnings } : {}),
    };
    writeFileSync(join(OUT_DIR, `${p.id}.json`), JSON.stringify(bundle));
    const visits = groupVisits(res.exposures);
    table.push([
      p.id,
      pos.ra.toFixed(5),
      pos.dec.toFixed(5),
      ...disc.collections.map((c) => `${res.rowsByCollection[c] ?? '-'}${res.truncated.includes(c) ? '+' : ''}`),
      String(res.exposures.length),
      String(visits.length),
      warnings.length ? `${warnings.length} warning(s)` : '',
    ]);
  }

  const widths = table[0].map((_, k) => Math.max(...table.map((r) => r[k].length)));
  for (const row of table) console.log(row.map((c, k) => c.padEnd(widths[k])).join('  '));
  console.log('("+" = truncated at the row cap; visits = groups separated by more than 10 days)');
  console.log(`Wrote ${presets.length} exposure list(s) to ${OUT_DIR}`);
}

// ---------------------------------------------------------------------------------------------
// Exposure selection

/** Order 0..n-1 so that every prefix is spread evenly (0, mid, quarters, ...). */
export function spreadOrder(n: number): number[] {
  if (n <= 0) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (k: number) => {
    if (k >= 0 && k < n && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  push(Math.floor((n - 1) / 2));
  for (let parts = 2; out.length < n; parts *= 2) {
    for (let j = 0; j <= parts; j++) push(Math.round((j * (n - 1)) / parts));
    if (parts > 4 * n) for (let k = 0; k < n; k++) push(k);
  }
  return out;
}

interface Candidate {
  exposure: Exposure;
  visit: number;
  channel: number;
}

/**
 * Choose at most `cap` candidates: the budget is shared evenly over (visit, detector) groups (groups
 * that need less give the rest away); inside a group, channels are taken round-robin (spread over the
 * band first) and exposures inside a channel evenly in time. Keeps the widest channel coverage per visit.
 */
export function selectExposures<T extends Candidate>(cands: T[], cap: number): T[] {
  const groups = new Map<string, T[]>();
  for (const c of cands) {
    const k = `${c.visit}|${c.exposure.detector}`;
    const g = groups.get(k) ?? [];
    g.push(c);
    groups.set(k, g);
  }
  // Water-filling budget.
  const budget = new Map<string, number>();
  let left = cap;
  let open = [...groups.keys()].sort((a, b) => groups.get(a)!.length - groups.get(b)!.length);
  while (open.length && left > 0) {
    const share = Math.floor(left / open.length);
    const next: string[] = [];
    let used = 0;
    for (const k of open) {
      const need = groups.get(k)!.length - (budget.get(k) ?? 0);
      const give = Math.min(need, Math.max(share, 0));
      budget.set(k, (budget.get(k) ?? 0) + give);
      used += give;
      if (need > give) next.push(k);
    }
    left -= used;
    if (share === 0) {
      // Fewer slots than open groups: one more each, spread over the groups.
      for (const k of spreadOrder(next.length).map((i) => next[i])) {
        if (left <= 0) break;
        budget.set(k, (budget.get(k) ?? 0) + 1);
        left--;
      }
      break;
    }
    open = next;
  }
  const chosen: T[] = [];
  for (const [k, g] of groups) {
    const want = budget.get(k) ?? 0;
    if (want >= g.length) {
      chosen.push(...g);
      continue;
    }
    const byCh = new Map<number, T[]>();
    for (const c of g) byCh.set(c.channel, [...(byCh.get(c.channel) ?? []), c]);
    const channels = [...byCh.keys()].sort((a, b) => a - b);
    const chOrder = spreadOrder(channels.length).map((i) => channels[i]);
    const queues = new Map(chOrder.map((ch) => {
      const list = byCh.get(ch)!.sort((a, b) => a.exposure.mjd - b.exposure.mjd);
      return [ch, spreadOrder(list.length).map((i) => list[i])] as const;
    }));
    let taken = 0;
    while (taken < want) {
      for (const ch of chOrder) {
        if (taken >= want) break;
        const q = queues.get(ch)!;
        const c = q.shift();
        if (c) {
          chosen.push(c);
          taken++;
        }
      }
    }
  }
  return chosen.sort((a, b) => a.exposure.mjd - b.exposure.mjd || a.exposure.detector - b.exposure.detector);
}

// ---------------------------------------------------------------------------------------------
// Pixel bundles

async function pool<T, R>(items: T[], n: number, fn: (t: T, k: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

function fmtMB(b: number): string {
  return `${(b / 1048576).toFixed(2)} MB`;
}

async function bakePixels(p: PresetTarget, cap: number): Promise<string[]> {
  const t0 = Date.now();
  const listPath = join(OUT_DIR, `${p.id}.json`);
  if (!existsSync(listPath)) throw new Error(`${listPath} missing: run without --skip-sia first`);
  const list = JSON.parse(readFileSync(listPath, 'utf8')) as PresetBundle;
  const exposures = list.exposures;
  if (!exposures.length) return [`${p.id}: no exposures, no bundle`];
  const mjds = exposures.map((e) => e.mjd);
  const centerMjd = (Math.min(...mjds) + Math.max(...mjds)) / 2;
  const center: SkyPos = propagate(p, centerMjd);
  const visits = groupVisits(exposures);
  const visitOf = new Map<string, number>();
  for (const v of visits) for (const id of v.exposureIds) visitOf.set(id, v.index);

  // Candidates with the approximate channel at the target (footprint geometry, good to a few pixels).
  const cands: Candidate[] = [];
  let offFrame = 0;
  for (const e of exposures) {
    const pix = approxPixFromRegion(e.sRegion, center.ra, center.dec);
    if (!pix || pix[0] < 4 || pix[1] < 4 || pix[0] > 2035 || pix[1] > 2035) {
      offFrame++;
      continue;
    }
    cands.push({ exposure: e, visit: visitOf.get(e.id) ?? -1, channel: channelAt(pix[0], pix[1]) });
  }
  const picked = selectExposures(cands, cap);
  console.log(
    `\n${p.id}: centre ${center.ra.toFixed(6)} ${center.dec.toFixed(6)} at ${mjdToIsoDate(centerMjd)} (middle of coverage); ` +
      `${exposures.length} exposures, ${offFrame} at the frame edge, ${cands.length} candidates, ${picked.length} picked; loading ${IN_FLIGHT} at a time...`,
  );

  let done = 0;
  const failures: string[] = [];
  const loaded = await pool(picked, IN_FLIGHT, async (c) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cut = await loadCutout(c.exposure, center, WINDOW_FOV_ARCSEC, { planes: ['FLAGS'] });
        if (++done % 50 === 0) console.log(`  ${done}/${picked.length}`);
        return cut;
      } catch (err) {
        if (attempt === 1) failures.push(`${c.exposure.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    done++;
    return null;
  });
  const cutouts = loaded.filter((c): c is NativeCutout => !!c);
  const nullCount = loaded.filter((c) => c === null).length - failures.length;
  const tLoad = (Date.now() - t0) / 1000;

  // Re-select with the exact channels, shrinking the cap until the gzip fits.
  const exact = cutouts.map((c) => ({ exposure: c.exposure, visit: visitOf.get(c.exposure.id) ?? -1, channel: c.channel, cut: c }));
  let n = Math.min(cap, exact.length);
  let bin: Uint8Array;
  let manifestText: string;
  let chosen: typeof exact;
  let rawBytes: number;
  const notes: string[] = [];
  for (;;) {
    chosen = selectExposures(exact, n);
    const { manifest, binary } = encodeBundle(
      chosen.map((c) => c.cut),
      {
        presetId: p.id,
        center,
        fovArcsec: FOV_ARCSEC,
        centerMjd: round(centerMjd, 6),
        windowFovArcsec: WINDOW_FOV_ARCSEC,
        notes: [
          `Native SPHEREx Level-2 pixels (IMAGE + FLAGS) read from s3://nasa-irsa-spherex on ${new Date().toISOString().slice(0, 10)}; ` +
            `${chosen.length} of ${exposures.length} exposures, chosen to keep the widest channel coverage per visit and detector.`,
          ...notes,
        ],
      },
    );
    bin = gzipSync(binary, { level: 9 });
    manifestText = JSON.stringify(manifest);
    rawBytes = binary.length;
    if (bin.length <= MAX_BIN_BYTES || n <= 24) break;
    const next = Math.floor(n * Math.min(0.95, (MAX_BIN_BYTES / bin.length) * 0.97));
    console.log(`  ${n} cutouts -> ${fmtMB(bin.length)} gzip, over 8 MB: retrying with ${next}`);
    n = next;
  }
  writeFileSync(join(OUT_DIR, `${p.id}.bundle.json`), manifestText);
  writeFileSync(join(OUT_DIR, `${p.id}.bundle.bin`), bin);

  // What was dropped, per visit.
  const perVisit = visits.map((v) => {
    const all = cands.filter((c) => c.visit === v.index).length;
    const kept = chosen.filter((c) => c.visit === v.index);
    const ch = new Set(kept.map((c) => c.cut.cubeChannel)).size;
    return `${v.label}: ${kept.length}/${all} kept, ${ch} cube channels`;
  });
  const secs = (Date.now() - t0) / 1000;
  const lines = [
    `${p.id}: ${chosen.length} cutouts (${fmtMB(rawBytes)} raw -> ${fmtMB(bin.length)} gzip, manifest ${fmtMB(manifestText.length)}), ` +
      `load ${tLoad.toFixed(0)} s, total ${secs.toFixed(0)} s; ${nullCount} off-detector, ${failures.length} failed`,
    ...perVisit.map((s) => `    ${s}`),
    ...failures.slice(0, 5).map((f) => `    failed ${f}`),
  ];
  for (const l of lines) console.log(l);
  return lines;
}

async function main(): Promise<void> {
  setApiBase('https://irsa.ipac.caltech.edu');
  const args = parseArgs(process.argv.slice(2));
  const presets = args.only.length ? PRESETS.filter((p) => args.only.includes(p.id)) : PRESETS;
  mkdirSync(OUT_DIR, { recursive: true });
  if (!args.skipSia) await bakeExposureLists(presets);
  if (!args.pixels) return;
  const summary: string[] = [];
  for (const p of presets.filter((q) => q.challenge)) summary.push(...(await bakePixels(p, args.cap)));
  console.log('\nPixel bundles:');
  for (const l of summary) console.log(l);
}

// Run only when executed directly (the selection helpers are imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
