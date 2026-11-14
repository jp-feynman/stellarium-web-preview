// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// core/archive: which SPHEREx Level-2 exposures cover a sky position.
//
// IRSA's Simple Image Access service (SIA2, https://irsa.ipac.caltech.edu/SIA) lists every Level-2
// file whose footprint contains a position. It sends no CORS headers, so the browser calls it through
// our relay at `${apiBase()}/sia`. Each row is one detector of one exposure; SPHEREx exposes all six
// detectors at once and the dichroic pairs (1,4), (2,5), (3,6) see the same patch of sky.
// Every detector carries a linear variable filter, so each row is a different wavelength at the target.

import { mjdToIsoDate, type DetectorId, type Exposure, type SkyPos, type TargetInfo, type Visit } from '../types';
import { fetchText, type FetchLike } from './net';

export { PRESETS, findPreset, type PresetTarget } from './presets';
export { fetchText, type FetchLike, type FetchTextOptions } from './net';

/** A baked exposure list for one preset target (public/presets/<id>.json). */
export interface PresetBundle {
  target: TargetInfo;
  /** ISO time the bundle was generated. */
  generated: string;
  collections: string[];
  exposures: Exposure[];
  /** Position actually searched (the target propagated to the bake epoch). */
  searchPos?: SkyPos;
  /** Julian year the search position refers to. */
  searchEpoch?: number;
  /** Plain-language notes, e.g. "spherex_dr1_deep truncated at 3000 rows". */
  warnings?: string[];
}

// ---------------------------------------------------------------------------------------------
// Where the relay lives

let apiBaseOverride: string | null = null;

/**
 * Point the archive calls somewhere else (tests, the bake script, self-hosted relays).
 * Passing 'https://irsa.ipac.caltech.edu' talks to IRSA directly (Node only: IRSA has no CORS).
 * Passing null restores the default.
 */
export function setApiBase(base: string | null): void {
  apiBaseOverride = base ? base.replace(/\/+$/, '') : null;
  discoveryCache.clear();
}

/** Base URL of the relay: VITE_API_BASE at build time, otherwise './api' next to the page. */
export function apiBase(): string {
  if (apiBaseOverride) return apiBaseOverride;
  // import.meta.env exists under Vite and vitest; under plain Node (tsx scripts) it is undefined.
  const env: unknown = import.meta.env?.VITE_API_BASE;
  if (typeof env === 'string' && env.trim()) return env.trim().replace(/\/+$/, '');
  return './api';
}

/** Full URL of the SIA endpoint for the current api base. */
export function siaEndpoint(): string {
  const base = apiBase();
  // Talking to IRSA itself: its path is /SIA. Our relays (Cloudflare function, scripts/relay.mjs,
  // the Vite dev proxy) expose it as /sia.
  if (/^https?:\/\/irsa\.ipac\.caltech\.edu$/i.test(base)) return `${base}/SIA`;
  return `${base}/sia`;
}

// ---------------------------------------------------------------------------------------------
// Collections

/** Level-2 image collections: spherex_dr1, spherex_qr3, spherex_dr1_deep, ... (not _cube, not _cal). */
export const COLLECTION_PATTERN = /^spherex_(dr|qr)\d+(_deep)?$/;

/** Used only when the SIA self-description cannot be read. */
export const FALLBACK_COLLECTIONS = ['spherex_dr1', 'spherex_qr3', 'spherex_dr1_deep', 'spherex_qr3_deep'];

const discoveryCache = new Map<string, Promise<string[]>>();

/** Wide survey first, data releases before quick releases, newest number first. */
function collectionOrder(a: string, b: string): number {
  const key = (c: string): [number, number, number] => {
    const m = /^spherex_(dr|qr)(\d+)(_deep)?$/.exec(c);
    if (!m) return [9, 9, 0];
    return [m[3] ? 1 : 0, m[1] === 'dr' ? 0 : 1, -Number(m[2])];
  };
  const ka = key(a);
  const kb = key(b);
  for (let k = 0; k < 3; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
  return a.localeCompare(b);
}

/** Pull the collection names out of the SIA self-description (VOTable answer to ?MAXREC=0). */
export function parseCollectionsFromSelfDescription(xml: string): string[] {
  const block = /<PARAM\b[^>]*name="COLLECTION"[^>]*>([\s\S]*?)<\/PARAM>/i.exec(xml)?.[1] ?? xml;
  const names = new Set<string>();
  for (const m of block.matchAll(/<OPTION\b[^>]*\bvalue="([^"]+)"/gi)) {
    const v = m[1].trim();
    if (COLLECTION_PATTERN.test(v)) names.add(v);
  }
  return [...names].sort(collectionOrder);
}

export interface DiscoverOptions {
  signal?: AbortSignal;
  fetch?: FetchLike;
  /** Full SIA URL to use instead of siaEndpoint(). */
  endpoint?: string;
}

/**
 * Like discoverCollections, but also says when the built-in fallback list had to be used.
 * A successful answer is cached for the session; a failure is not, so the next call tries again.
 */
export async function discoverCollectionsDetailed(opts: DiscoverOptions = {}): Promise<{ collections: string[]; warning?: string }> {
  const endpoint = opts.endpoint ?? siaEndpoint();
  let pending = discoveryCache.get(endpoint);
  if (!pending) {
    pending = fetchText(`${endpoint}?MAXREC=0`, {
      signal: opts.signal,
      fetch: opts.fetch,
      timeoutMs: 20000,
      retries: 1,
      what: 'Listing SPHEREx archive collections',
    }).then(({ text }) => {
      if (looksLikeHtmlPage(text)) throw new RelayMissingError();
      const found = parseCollectionsFromSelfDescription(text);
      if (found.length === 0) throw new Error('the SIA self-description lists no SPHEREx Level-2 collections');
      return found;
    });
    discoveryCache.set(endpoint, pending);
    pending.catch(() => discoveryCache.delete(endpoint));
  }
  try {
    return { collections: [...(await pending)] };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    // No relay on this site: searching each collection would only fetch the same page again.
    if (err instanceof RelayMissingError) throw err;
    const why = err instanceof Error ? err.message : String(err);
    return {
      collections: [...FALLBACK_COLLECTIONS],
      warning: `Could not list the archive's collections (${why}); using the built-in list ${FALLBACK_COLLECTIONS.join(', ')}, which may be out of date.`,
    };
  }
}

/** Current SPHEREx Level-2 collections, e.g. ['spherex_dr1', 'spherex_qr3', 'spherex_dr1_deep', 'spherex_qr3_deep']. */
export async function discoverCollections(opts: DiscoverOptions = {}): Promise<string[]> {
  return (await discoverCollectionsDetailed(opts)).collections;
}

// ---------------------------------------------------------------------------------------------
// CSV parsing

const IRSA_DATA_PREFIX = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/';
const BAND_PATTERN = /^SPHEREx-D([1-6])$/;
const TAG_PATTERN = /^l2b(?:_retry)?-v\d+-\d{4}-\d{3}$/;

/** Split one CSV line, honouring double quotes ("" is an escaped quote). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (quoted) {
      if (ch === '"') {
        if (line[k + 1] === '"') {
          cur += '"';
          k++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "POLYGON ICRS ra0 dec0 ra1 dec1 ..." -> the first four corners as 8 numbers ([] when malformed). */
export function parseSRegion(s: string): number[] {
  const nums = s
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((v) => Number.isFinite(v));
  // The polygon repeats its first corner at the end; the frame name (ICRS) is not a number.
  return nums.length >= 8 ? nums.slice(0, 8) : [];
}

/** Processing tag folder, e.g. "l2b-v27-2026-197" or "l2b_retry-v27-2026-207". */
function pipelineTagFromKey(key: string): string {
  const parts = key.split('/');
  const folder = parts.find((p) => TAG_PATTERN.test(p));
  if (folder) return folder;
  const m = /_spx_(.+?)\.fits$/.exec(parts[parts.length - 1] ?? '');
  return m ? m[1] : '';
}

/**
 * Parse an IRSA SIA2 CSV answer into Level-2 exposures.
 * IRSA writes the cloud_access column as unquoted JSON containing commas, so data rows have more
 * fields than the header (53 vs 51 today). Columns are read by header position up to cloud_access,
 * the columns after it are counted from the end of the row, and whatever is left is cloud_access.
 * Rows that are not calibrated Level-2 detector images (cubes, calibration files) are dropped.
 */
export function parseSiaCsv(text: string): Exposure[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  if (lines[0].trimStart().startsWith('<')) throw looksLikeHtmlPage(text) ? new RelayMissingError() : new Error(siaErrorMessage(text));
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = new Map(header.map((h, k) => [h, k]));
  const need = ['s_ra', 's_dec', 'calib_level', 'dataproduct_type', 'energy_bandpassname', 'obs_id', 'em_min', 'em_max', 'access_url', 's_region', 'obs_collection', 't_min', 't_max'];
  const missing = need.filter((n) => !col.has(n));
  if (missing.length) throw new Error(`The archive answer is not the expected SIA table (missing column ${missing.join(', ')}).`);
  const idx = (n: string): number => col.get(n) as number;
  const cloudIdx = col.get('cloud_access') ?? -1;
  const nAfter = cloudIdx >= 0 ? header.length - cloudIdx - 1 : 0;

  const out: Exposure[] = [];
  for (let r = 1; r < lines.length; r++) {
    let f = splitCsvLine(lines[r]);
    if (f.length !== header.length) {
      if (cloudIdx < 0 || f.length < header.length) continue;
      f = [...f.slice(0, cloudIdx), f.slice(cloudIdx, f.length - nAfter).join(','), ...f.slice(f.length - nAfter)];
    }
    if (f[idx('dataproduct_type')].trim() !== 'image') continue;
    if (Number(f[idx('calib_level')]) !== 2) continue;
    const band = BAND_PATTERN.exec(f[idx('energy_bandpassname')].trim());
    if (!band) continue;
    const detector = Number(band[1]) as DetectorId;

    const url = f[idx('access_url')].trim();
    let s3Key = url.startsWith(IRSA_DATA_PREFIX) ? url.slice(IRSA_DATA_PREFIX.length) : '';
    if (!s3Key && cloudIdx >= 0) s3Key = /"key"\s*:\s*"([^"]+)"/.exec(f[cloudIdx])?.[1] ?? '';
    if (!s3Key) continue;

    const mjdStart = Number(f[idx('t_min')]);
    const mjdEnd = Number(f[idx('t_max')]);
    const sRa = Number(f[idx('s_ra')]);
    const sDec = Number(f[idx('s_dec')]);
    if (![mjdStart, mjdEnd, sRa, sDec].every(Number.isFinite)) continue;
    const obsId = f[idx('obs_id')].trim();
    out.push({
      id: `${obsId}D${detector}`,
      obsId,
      detector,
      collection: f[idx('obs_collection')].trim(),
      release: s3Key.split('/')[0],
      mjdStart,
      mjdEnd,
      mjd: (mjdStart + mjdEnd) / 2,
      url,
      s3Key,
      sRa,
      sDec,
      sRegion: parseSRegion(f[idx('s_region')].replace(/^\s*POLYGON\s*/i, '')),
      // SIA gives metres; 1 m = 1e6 microns. Rounded to remove float noise such as 4.4115000000000004.
      emMin: Math.round(Number(f[idx('em_min')]) * 1e10) / 1e4,
      emMax: Math.round(Number(f[idx('em_max')]) * 1e10) / 1e4,
      pipelineTag: pipelineTagFromKey(s3Key),
    });
  }
  return out;
}

/** What a static host without the relay answers to /api/sia: the app's own index.html. */
export const RELAY_MISSING_MESSAGE = 'The archive search relay is not set up on this site.';

/** The relay is missing: the "archive answer" was a web page (a static host serving index.html). */
export class RelayMissingError extends Error {
  constructor() {
    super(RELAY_MISSING_MESSAGE);
    this.name = 'RelayMissingError';
  }
}

/** True when a text that should be a VOTable or CSV is an HTML page. */
export function looksLikeHtmlPage(text: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(text.slice(0, 500));
}

/** Turn a VOTable error document into a readable message (an HTML page means the relay is missing). */
export function siaErrorMessage(xml: string): string {
  if (looksLikeHtmlPage(xml)) return RELAY_MISSING_MESSAGE;
  const info = /<INFO\b[^>]*name="QUERY_STATUS"[^>]*>([\s\S]*?)<\/INFO>/i.exec(xml)?.[1];
  const msg = (info ?? xml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 300);
  return `The SPHEREx archive search returned an error: ${msg || 'no details given'}.`;
}

// ---------------------------------------------------------------------------------------------
// Searching

export interface SearchOptions {
  /** Collections to search; default = discoverCollections(). */
  collections?: string[];
  signal?: AbortSignal;
  /** Row cap per collection. Default 3000 for *_deep collections, no cap for the wide survey. */
  maxPerCollection?: number;
  /** Search circle radius in degrees (default 0.001: "frames that contain this point"). */
  radiusDeg?: number;
  /** Restrict to exposures overlapping this MJD range. */
  time?: [number, number];
  /** Restrict to detector bands overlapping this wavelength range in microns. */
  bandMicrons?: [number, number];
  /** Remove duplicate rows with dedupeExposures (default true). */
  dedupe?: boolean;
  /** Called with each plain-language warning (fallback collection list, truncation, failed collection). */
  onWarning?: (message: string) => void;
  fetch?: FetchLike;
  /** Full SIA URL to use instead of siaEndpoint(). */
  endpoint?: string;
}

export interface SearchResult {
  exposures: Exposure[];
  collections: string[];
  /** Number of Level-2 rows returned per collection (before dedupe). */
  rowsByCollection: Record<string, number>;
  /** Collections whose answer hit the row cap, so some exposures are missing. */
  truncated: string[];
  warnings: string[];
}

/** Build the SIA query URL for one collection. */
export function buildSiaUrl(
  endpoint: string,
  collection: string,
  pos: SkyPos,
  opts: { radiusDeg?: number; maxrec?: number; time?: [number, number]; bandMicrons?: [number, number] } = {},
): string {
  const r = opts.radiusDeg ?? 0.001;
  const parts = [
    `COLLECTION=${encodeURIComponent(collection)}`,
    `POS=circle+${pos.ra.toFixed(6)}+${pos.dec.toFixed(6)}+${r}`,
    'RESPONSEFORMAT=CSV',
  ];
  if (opts.time) parts.push(`TIME=${opts.time[0].toFixed(5)}+${opts.time[1].toFixed(5)}`);
  // SIA wants wavelengths in metres.
  if (opts.bandMicrons) parts.push(`BAND=${(opts.bandMicrons[0] * 1e-6).toExponential(6)}+${(opts.bandMicrons[1] * 1e-6).toExponential(6)}`);
  if (opts.maxrec !== undefined) parts.push(`MAXREC=${opts.maxrec}`);
  return `${endpoint}?${parts.join('&')}`;
}

/** Like searchExposures, with per-collection counts, truncation and warnings. */
export async function searchExposuresDetailed(pos: SkyPos, opts: SearchOptions = {}): Promise<SearchResult> {
  if (!Number.isFinite(pos.ra) || !Number.isFinite(pos.dec) || pos.dec < -90 || pos.dec > 90) {
    throw new Error(`Invalid sky position (${pos.ra}, ${pos.dec}).`);
  }
  const ra = ((pos.ra % 360) + 360) % 360;
  const endpoint = opts.endpoint ?? siaEndpoint();
  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
    opts.onWarning?.(m);
  };

  let collections = opts.collections;
  if (!collections || collections.length === 0) {
    const d = await discoverCollectionsDetailed({ signal: opts.signal, fetch: opts.fetch, endpoint });
    if (d.warning) warn(d.warning);
    collections = d.collections;
  }

  const rowsByCollection: Record<string, number> = {};
  const truncated: string[] = [];
  const all: Exposure[] = [];
  const errors: string[] = [];

  await Promise.all(
    collections.map(async (collection) => {
      const deep = /_deep$/.test(collection);
      const cap = opts.maxPerCollection ?? (deep ? 3000 : undefined);
      // Ask for one row more than we keep: if it arrives, the answer was cut off.
      const url = buildSiaUrl(endpoint, collection, { ra, dec: pos.dec }, {
        radiusDeg: opts.radiusDeg,
        maxrec: cap !== undefined ? cap + 1 : undefined,
        time: opts.time,
        bandMicrons: opts.bandMicrons,
      });
      try {
        const { text } = await fetchText(url, {
          signal: opts.signal,
          fetch: opts.fetch,
          timeoutMs: deep ? 60000 : 30000,
          retries: 2,
          what: `SPHEREx archive search (${collection})`,
        });
        let rows = parseSiaCsv(text).filter((e) => e.collection === collection || !e.collection);
        if (cap !== undefined && rows.length > cap) {
          rows = rows.slice(0, cap);
          truncated.push(collection);
          warn(`${collection}: more than ${cap} exposures cover this position; only the first ${cap} are used. Narrow the time or wavelength range to see the rest.`);
        }
        rowsByCollection[collection] = rows.length;
        all.push(...rows);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        warn(`${collection} could not be searched: ${msg}`);
      }
    }),
  );

  if (errors.length === collections.length && collections.length > 0) {
    if (errors.every((m) => m === RELAY_MISSING_MESSAGE)) throw new RelayMissingError();
    const distinct = [...new Set(errors)];
    throw new Error(distinct.length === 1 ? distinct[0] : `The SPHEREx archive search failed for every collection. First error: ${errors[0]}`);
  }

  const exposures = opts.dedupe === false ? sortByTime(all) : dedupeExposures(all);
  return { exposures, collections: [...collections].sort(collectionOrder), rowsByCollection, truncated, warnings };
}

/**
 * Level-2 exposures (one row per detector frame) whose footprint contains `pos`, sorted by time.
 * One SIA request per collection, at most 4 at a time. Collections that fail are skipped with a
 * warning (see searchExposuresDetailed / opts.onWarning); if all fail the promise rejects.
 */
export async function searchExposures(
  pos: SkyPos,
  opts: SearchOptions = {},
): Promise<Exposure[]> {
  return (await searchExposuresDetailed(pos, opts)).exposures;
}

// ---------------------------------------------------------------------------------------------
// Dedupe and visits

function sortByTime(list: Exposure[]): Exposure[] {
  return [...list].sort((a, b) => a.mjd - b.mjd || a.detector - b.detector || a.id.localeCompare(b.id));
}

/** Higher = preferred: a data release (dr) beats a quick release (qr), then newer processing wins. */
function preference(e: Exposure): [number, number, number] {
  const rel = /^(dr|qr)(\d+)/.exec(e.release || e.collection.replace(/^spherex_/, ''));
  const relRank = rel ? (rel[1] === 'dr' ? 1 : 0) : -1;
  const relNum = rel ? Number(rel[2]) : 0;
  const tag = /v(\d+)-(\d{4})-(\d{3})/.exec(e.pipelineTag);
  const processing = tag ? Number(tag[1]) * 1e7 + Number(tag[2]) * 1e3 + Number(tag[3]) : 0;
  return [relRank, processing, relNum];
}

/** Keep one row per (obsId, detector): data release over quick release, then the newest processing. */
export function dedupeExposures(list: Exposure[]): Exposure[] {
  const best = new Map<string, Exposure>();
  for (const e of list) {
    const key = `${e.obsId}|${e.detector}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, e);
      continue;
    }
    const a = preference(e);
    const b = preference(prev);
    for (let k = 0; k < 3; k++) {
      if (a[k] !== b[k]) {
        if (a[k] > b[k]) best.set(key, e);
        break;
      }
    }
  }
  return sortByTime([...best.values()]);
}

/**
 * Group exposures into visits: SPHEREx passes over a position for a few days to a few weeks about
 * every six months. A new visit starts when the time gap to the previous exposure exceeds gapDays.
 * Visits are numbered from 0 in time order; label = ISO date of the visit's middle.
 */
export function groupVisits(exposures: Exposure[], gapDays = 10): Visit[] {
  const sorted = sortByTime(exposures);
  const visits: Visit[] = [];
  let cur: Exposure[] = [];
  const flush = (): void => {
    if (cur.length === 0) return;
    const mjdMin = cur[0].mjd;
    const mjdMax = cur[cur.length - 1].mjd;
    const mjdMid = (mjdMin + mjdMax) / 2;
    visits.push({ index: visits.length, mjdMin, mjdMax, mjdMid, exposureIds: cur.map((e) => e.id), label: mjdToIsoDate(mjdMid) });
    cur = [];
  };
  for (const e of sorted) {
    if (cur.length && e.mjd - cur[cur.length - 1].mjd > gapDays) flush();
    cur.push(e);
  }
  flush();
  return visits;
}

/** Map exposure id -> visit index. */
export function visitIndexById(visits: Visit[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of visits) for (const id of v.exposureIds) m.set(id, v.index);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Presets

/** Fetch a baked exposure list from ./presets/<id>.json. Resolves null when no bundle exists. */
export async function loadPreset(
  id: string,
  opts: { signal?: AbortSignal; baseUrl?: string; fetch?: FetchLike } = {},
): Promise<PresetBundle | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const base = (opts.baseUrl ?? './presets').replace(/\/+$/, '');
  const { status, text } = await fetchText(`${base}/${id}.json`, {
    signal: opts.signal,
    fetch: opts.fetch,
    timeoutMs: 20000,
    retries: 1,
    what: `Loading the saved exposure list for ${id}`,
    acceptStatus: [404],
  });
  if (status === 404) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // A static host may answer an unknown path with its index.html.
    return null;
  }
  const b = data as Partial<PresetBundle>;
  if (!b || typeof b !== 'object' || !b.target || !Array.isArray(b.exposures)) return null;
  return b as PresetBundle;
}
