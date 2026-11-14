// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// One entry point for "give me this exposure's cutout". Layers, in order:
//   (a) a preloaded pixel bundle (public/presets/<id>.bundle.*) whose window contains the window
//       planWindow would ask for, and which holds every requested plane (bundles carry IMAGE + FLAGS);
//   (b) the browser's IndexedDB cache (database 'trueblink', store 'cutouts', LRU above ~150 MB);
//   (c) the archive via core/frames loadCutout; the answer is then written to (b) without blocking.
// Every IndexedDB call is wrapped: private browsing, quota errors or a missing indexedDB (Node) simply
// fall through to the next layer. The answer is always the same window loadCutout would return.

import { loadCutout, planWindow } from '../frames';
import type { Exposure, NativeCutout, SkyPos } from '../types';
import { pixelAreaArcsec2, skyToPix } from '../wcs';
import { channelAt, cubeChannelAt, waveAt, waveTables } from '../wave';
import {
  decodeBundle,
  decodeEntry,
  gunzipBytes,
  headerToBundle,
  validateManifest,
  type BundleCutoutEntry,
  type BundleManifest,
  type BundleSpan,
  type Gunzip,
} from '../bundle';

export type Plane = 'ZODI' | 'VARIANCE' | 'FLAGS';

export interface GetCutoutOptions {
  planes?: Plane[];
  signal?: AbortSignal;
}

export type CutoutSource = 'bundle' | 'cache' | 'archive';

export interface Window {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)

/** True when `outer` covers every pixel of `inner`. */
export function windowContains(outer: Window, inner: Window): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x0 + inner.nx <= outer.x0 + outer.nx && inner.y0 + inner.ny <= outer.y0 + outer.ny;
}

/** Planes a cutout carries (IMAGE is implicit). */
export function planesOf(c: NativeCutout): Plane[] {
  const out: Plane[] = [];
  if (c.flags) out.push('FLAGS');
  if (c.variance) out.push('VARIANCE');
  if (c.zodi) out.push('ZODI');
  return out;
}

function hasPlanes(c: NativeCutout, planes: Plane[]): boolean {
  return planes.every((p) => (p === 'FLAGS' ? !!c.flags : p === 'VARIANCE' ? !!c.variance : !!c.zodi));
}

function cropPlane<T extends Float32Array | Int32Array>(src: T, c: Window, w: Window): T {
  const out = new (src.constructor as { new (n: number): T })(w.nx * w.ny);
  for (let j = 0; j < w.ny; j++) {
    const s = (w.y0 - c.y0 + j) * c.nx + (w.x0 - c.x0);
    out.set(src.subarray(s, s + w.nx) as unknown as ArrayLike<number>, j * w.nx);
  }
  return out;
}

/**
 * The cutout loadCutout would return for `pos` with window `w`, built from a larger stored cutout `c`
 * (w must lie inside c). Only the requested planes are kept; the target pixel, wavelength, channel and
 * pixel solid angle are recomputed for `pos` exactly as loadCutout does.
 */
export function cropToRequest(c: NativeCutout, w: Window, pos: SkyPos, planes: Plane[]): NativeCutout {
  if (!windowContains(c, w)) throw new Error('cropToRequest: window is not inside the stored cutout');
  const same = w.x0 === c.x0 && w.y0 === c.y0 && w.nx === c.nx && w.ny === c.ny;
  const crop = <T extends Float32Array | Int32Array>(a: T): T => (same ? (a.slice() as T) : cropPlane(a, c, w));
  const [xt, yt] = skyToPix(c.header.wcs, pos.ra, pos.dec);
  const det = c.header.detector;
  const table = waveTables()[det];
  const wave = table ? waveAt(table, xt, yt) : { wavelength: NaN, bandwidth: NaN };
  return {
    exposure: c.exposure,
    header: c.header,
    x0: w.x0,
    y0: w.y0,
    nx: w.nx,
    ny: w.ny,
    image: crop(c.image),
    ...(planes.includes('FLAGS') && c.flags ? { flags: crop(c.flags) } : {}),
    ...(planes.includes('VARIANCE') && c.variance ? { variance: crop(c.variance) } : {}),
    ...(planes.includes('ZODI') && c.zodi ? { zodi: crop(c.zodi) } : {}),
    targetPix: [xt, yt],
    wavelength: wave.wavelength,
    bandwidth: wave.bandwidth,
    channel: channelAt(xt, yt),
    cubeChannel: cubeChannelAt(det, xt, yt),
    omegaArcsec2: pixelAreaArcsec2(c.header.wcs, xt, yt),
  };
}

/**
 * Pick, among stored cutouts of one file, the one that can answer a request.
 * Returns { cutout: null } when the WCS says the position is off the detector (the archive would also
 * answer null), the answer when one contains the planned window with the needed planes, else undefined.
 */
export function answerFrom(candidates: NativeCutout[], pos: SkyPos, fovArcsec: number, planes: Plane[]): { cutout: NativeCutout | null } | undefined {
  if (!candidates.length) return undefined;
  const w = planWindow(candidates[0].header.wcs, pos, fovArcsec);
  if (!w) return { cutout: null };
  for (const c of candidates) {
    if (hasPlanes(c, planes) && windowContains(c, w)) return { cutout: cropToRequest(c, w, pos, planes) };
  }
  return undefined;
}

function normPlanes(p: Plane[] | undefined): Plane[] {
  const order: Plane[] = ['FLAGS', 'VARIANCE', 'ZODI'];
  return order.filter((x) => p?.includes(x));
}

// ---------------------------------------------------------------------------------------------
// Serialization for the browser cache (same entry format as a bundle, plus ZODI / VARIANCE spans)

export interface StoredCutout {
  /** `${s3Key}|${x0},${y0},${nx},${ny}|${planes}` */
  id: string;
  s3Key: string;
  entry: BundleCutoutEntry & { zodi?: BundleSpan; variance?: BundleSpan };
  data: ArrayBuffer;
  bytes: number;
  lastUsed: number;
}

export function storeKey(c: Pick<NativeCutout, 'exposure' | 'x0' | 'y0' | 'nx' | 'ny'>, planes: Plane[]): string {
  return `${c.exposure.s3Key}|${c.x0},${c.y0},${c.nx},${c.ny}|${['IMAGE', ...normPlanes(planes)].join('+')}`;
}

export function serializeCutout(c: NativeCutout, now = Date.now()): StoredCutout {
  const n = c.nx * c.ny;
  const planes: [string, Float32Array | Int32Array | undefined][] = [
    ['image', c.image],
    ['flags', c.flags],
    ['zodi', c.zodi],
    ['variance', c.variance],
  ];
  const present = planes.filter((p): p is [string, Float32Array | Int32Array] => !!p[1]);
  const data = new ArrayBuffer(present.length * 4 * n);
  const bytes = new Uint8Array(data);
  const spans: Record<string, BundleSpan> = {};
  present.forEach(([name, arr], k) => {
    // Raw copy: stored and read back on the same machine, so host byte order is fine and NaN bits survive.
    bytes.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), k * 4 * n);
    spans[name] = { offset: k * 4 * n, bytes: 4 * n };
  });
  const jn = (v: number) => (Number.isFinite(v) ? v : { $f: String(v) });
  const entry: StoredCutout['entry'] = {
    exposure: c.exposure,
    header: headerToBundle(c.header),
    x0: c.x0,
    y0: c.y0,
    nx: c.nx,
    ny: c.ny,
    targetPix: [jn(c.targetPix[0]), jn(c.targetPix[1])],
    wavelength: jn(c.wavelength),
    bandwidth: jn(c.bandwidth),
    channel: c.channel,
    cubeChannel: c.cubeChannel,
    omegaArcsec2: jn(c.omegaArcsec2),
    image: spans.image,
    ...(spans.flags ? { flags: spans.flags } : {}),
    ...(spans.zodi ? { zodi: spans.zodi } : {}),
    ...(spans.variance ? { variance: spans.variance } : {}),
  };
  return { id: storeKey(c, planesOf(c)), s3Key: c.exposure.s3Key, entry, data, bytes: data.byteLength, lastUsed: now };
}

export function deserializeCutout(r: StoredCutout): NativeCutout {
  // The cache is written and read on the same host, so the "little-endian" reader of decodeEntry is a raw copy here.
  const bin = new Uint8Array(r.data);
  const c = decodeEntry(r.entry, bin);
  const slice = (s: BundleSpan) => r.data.slice(s.offset, s.offset + s.bytes);
  if (r.entry.zodi) c.zodi = new Float32Array(slice(r.entry.zodi));
  if (r.entry.variance) c.variance = new Float32Array(slice(r.entry.variance));
  return c;
}

// ---------------------------------------------------------------------------------------------
// Storage layer (b)

export interface CutoutStore {
  /** Every stored cutout of one file. */
  list(s3Key: string): Promise<StoredCutout[]>;
  put(rec: StoredCutout): Promise<void>;
  /** Mark as recently used (best effort). */
  touch(id: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<{ count: number; bytes: number }>;
}

/** Evict down to this after going over the limit. */
const DEFAULT_LIMIT_BYTES = 150 * 1024 * 1024;

/** In-memory store with the same LRU rule as the IndexedDB one (tests, or a session-only fallback). */
export class MemoryCutoutStore implements CutoutStore {
  readonly recs = new Map<string, StoredCutout>();
  constructor(readonly limitBytes = DEFAULT_LIMIT_BYTES) {}
  async list(s3Key: string): Promise<StoredCutout[]> {
    return [...this.recs.values()].filter((r) => r.s3Key === s3Key);
  }
  async put(rec: StoredCutout): Promise<void> {
    this.recs.set(rec.id, rec);
    let total = 0;
    for (const r of this.recs.values()) total += r.bytes;
    if (total <= this.limitBytes) return;
    const target = 0.8 * this.limitBytes;
    for (const r of [...this.recs.values()].sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (total <= target) break;
      this.recs.delete(r.id);
      total -= r.bytes;
    }
  }
  async touch(id: string): Promise<void> {
    const r = this.recs.get(id);
    if (r) r.lastUsed = Date.now();
  }
  async clear(): Promise<void> {
    this.recs.clear();
  }
  async stats(): Promise<{ count: number; bytes: number }> {
    let bytes = 0;
    for (const r of this.recs.values()) bytes += r.bytes;
    return { count: this.recs.size, bytes };
  }
}

const DB_NAME = 'trueblink';
const DB_VERSION = 1;
const STORE = 'cutouts';
/** Light records { id, bytes, lastUsed } so eviction never has to read pixel data. */
const LRU_STORE = 'cutoutLru';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** IndexedDB-backed store. Construct with IdbCutoutStore.open(); resolves null when unavailable. */
export class IdbCutoutStore implements CutoutStore {
  private total: number | null = null;
  private constructor(
    private readonly db: IDBDatabase,
    readonly limitBytes: number,
  ) {}

  static async open(limitBytes = DEFAULT_LIMIT_BYTES, timeoutMs = 4000): Promise<IdbCutoutStore | null> {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) return null;
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('IndexedDB open timed out')), timeoutMs);
        const r = idb.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('s3Key', 's3Key');
          if (!d.objectStoreNames.contains(LRU_STORE)) d.createObjectStore(LRU_STORE, { keyPath: 'id' }).createIndex('lastUsed', 'lastUsed');
        };
        r.onsuccess = () => {
          clearTimeout(t);
          resolve(r.result);
        };
        r.onerror = () => {
          clearTimeout(t);
          reject(r.error ?? new Error('IndexedDB open failed'));
        };
        r.onblocked = () => {
          clearTimeout(t);
          reject(new Error('IndexedDB open blocked'));
        };
      });
      // Another tab upgrading the database: step aside.
      db.onversionchange = () => db.close();
      return new IdbCutoutStore(db, limitBytes);
    } catch {
      return null;
    }
  }

  async list(s3Key: string): Promise<StoredCutout[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    return (await req(tx.objectStore(STORE).index('s3Key').getAll(IDBKeyRange.only(s3Key)))) as StoredCutout[];
  }

  async put(rec: StoredCutout): Promise<void> {
    const tx = this.db.transaction([STORE, LRU_STORE], 'readwrite');
    const prev = (await req(tx.objectStore(LRU_STORE).get(rec.id))) as { bytes: number } | undefined;
    tx.objectStore(STORE).put(rec);
    tx.objectStore(LRU_STORE).put({ id: rec.id, bytes: rec.bytes, lastUsed: rec.lastUsed });
    await txDone(tx);
    if (this.total === null) this.total = (await this.stats()).bytes;
    else this.total += rec.bytes - (prev?.bytes ?? 0);
    if (this.total > this.limitBytes) await this.evict(0.8 * this.limitBytes);
  }

  private async evict(targetBytes: number): Promise<void> {
    const tx = this.db.transaction([STORE, LRU_STORE], 'readwrite');
    const lru = tx.objectStore(LRU_STORE);
    const data = tx.objectStore(STORE);
    let total = this.total ?? 0;
    await new Promise<void>((resolve, reject) => {
      const cur = lru.index('lastUsed').openCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || total <= targetBytes) return resolve();
        const v = c.value as { id: string; bytes: number };
        data.delete(v.id);
        c.delete();
        total -= v.bytes;
        c.continue();
      };
    });
    await txDone(tx);
    this.total = total;
  }

  async touch(id: string): Promise<void> {
    const tx = this.db.transaction(LRU_STORE, 'readwrite');
    const s = tx.objectStore(LRU_STORE);
    const v = (await req(s.get(id))) as { id: string; bytes: number; lastUsed: number } | undefined;
    if (v) s.put({ ...v, lastUsed: Date.now() });
    await txDone(tx);
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([STORE, LRU_STORE], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(LRU_STORE).clear();
    await txDone(tx);
    this.total = 0;
  }

  async stats(): Promise<{ count: number; bytes: number }> {
    const tx = this.db.transaction(LRU_STORE, 'readonly');
    const all = (await req(tx.objectStore(LRU_STORE).getAll())) as { bytes: number }[];
    return { count: all.length, bytes: all.reduce((s, r) => s + r.bytes, 0) };
  }
}

// ---------------------------------------------------------------------------------------------
// Module state and injection

type Loader = (exposure: Exposure, pos: SkyPos, fovArcsec: number, opts: GetCutoutOptions) => Promise<NativeCutout | null>;

interface CacheDeps {
  loader: Loader;
  /** undefined = open IndexedDB lazily; null = no storage layer. */
  store: CutoutStore | null | undefined;
}

const deps: CacheDeps = { loader: (e, p, f, o) => loadCutout(e, p, f, o), store: undefined };
let storePromise: Promise<CutoutStore | null> | null = null;

/** Replace the archive loader and/or the storage layer (tests; or `store: null` to disable caching). */
export function configureCache(opts: { loader?: Loader; store?: CutoutStore | null }): void {
  if (opts.loader) deps.loader = opts.loader;
  if ('store' in opts) {
    deps.store = opts.store;
    storePromise = null;
  }
}

function getStore(): Promise<CutoutStore | null> {
  if (deps.store !== undefined) return Promise.resolve(deps.store);
  if (!storePromise) storePromise = IdbCutoutStore.open().catch(() => null);
  return storePromise;
}

/** Bundle cutouts by exposure id (one exposure may appear in several bundles). */
const bundleByExposure = new Map<string, NativeCutout[]>();
const bundles = new Map<string, { manifest: Omit<BundleManifest, 'cutouts'>; cutouts: NativeCutout[] }>();
const bundleLoads = new Map<string, Promise<number>>();
const sources = new Map<string, CutoutSource>();
const counters = { bundle: 0, cache: 0, archive: 0, storeErrors: 0 };

/** Register already-decoded cutouts as a bundle (used by preloadBundle; also handy in Node and tests). */
export function registerBundleCutouts(presetId: string, cutouts: NativeCutout[], manifest?: BundleManifest): number {
  dropBundle(presetId);
  for (const c of cutouts) {
    const list = bundleByExposure.get(c.exposure.id) ?? [];
    list.push(c);
    bundleByExposure.set(c.exposure.id, list);
  }
  let meta: Omit<BundleManifest, 'cutouts'> | { presetId: string };
  if (manifest) {
    const { cutouts: _drop, ...rest } = manifest;
    meta = rest;
  } else meta = { presetId };
  bundles.set(presetId, { manifest: meta as Omit<BundleManifest, 'cutouts'>, cutouts: cutouts.slice() });
  return cutouts.length;
}

/** Forget a loaded bundle. */
export function unregisterBundle(presetId: string): void {
  bundleLoads.delete(presetId);
  dropBundle(presetId);
}

function dropBundle(presetId: string): void {
  const b = bundles.get(presetId);
  if (!b) return;
  const mine = new Set(b.cutouts);
  for (const c of b.cutouts) {
    const left = (bundleByExposure.get(c.exposure.id) ?? []).filter((x) => !mine.has(x));
    if (left.length) bundleByExposure.set(c.exposure.id, left);
    else bundleByExposure.delete(c.exposure.id);
  }
  bundles.delete(presetId);
}

/** Manifest fields (no cutout list) of a loaded bundle, for provenance: generation date, centre, fov, releases. */
export function bundleInfo(presetId: string): Omit<BundleManifest, 'cutouts'> | undefined {
  return bundles.get(presetId)?.manifest;
}

/** Exposure ids a loaded bundle can answer. */
export function bundledExposureIds(presetId: string): string[] {
  return (bundles.get(presetId)?.cutouts ?? []).map((c) => c.exposure.id);
}

// ---------------------------------------------------------------------------------------------
// Public API

/** Same contract as core/frames loadCutout, with the bundle and browser-cache layers in front of the network. */
export async function getCutout(exposure: Exposure, pos: SkyPos, fovArcsec: number, opts: GetCutoutOptions = {}): Promise<NativeCutout | null> {
  const planes = normPlanes(opts.planes);
  opts.signal?.throwIfAborted();

  // (a) baked bundle
  const inBundle = bundleByExposure.get(exposure.id);
  if (inBundle) {
    const hit = answerFrom(inBundle, pos, fovArcsec, planes);
    if (hit) {
      sources.set(exposure.id, 'bundle');
      counters.bundle++;
      return hit.cutout;
    }
  }

  // (b) browser cache
  const store = await getStore();
  if (store) {
    try {
      const recs = await store.list(exposure.s3Key);
      if (recs.length) {
        const decoded = recs.map(deserializeCutout);
        const w = planWindow(decoded[0].header.wcs, pos, fovArcsec);
        const k = w ? decoded.findIndex((c) => hasPlanes(c, planes) && windowContains(c, w)) : -1;
        if (w && k >= 0) {
          void store.touch(recs[k].id).catch(() => undefined);
          sources.set(exposure.id, 'cache');
          counters.cache++;
          return cropToRequest(decoded[k], w, pos, planes);
        }
      }
    } catch {
      counters.storeErrors++;
    }
  }
  opts.signal?.throwIfAborted();

  // (c) archive
  const cut = await deps.loader(exposure, pos, fovArcsec, { planes, signal: opts.signal });
  sources.set(exposure.id, 'archive');
  counters.archive++;
  if (cut && store) {
    // Never block the caller on the write; quota errors just mean "not cached".
    void Promise.resolve()
      .then(() => store.put(serializeCutout(cut)))
      .catch(() => {
        counters.storeErrors++;
      });
  }
  return cut;
}

export interface PreloadOptions {
  /** Folder holding <id>.bundle.json and <id>.bundle.bin (default './presets', relative to the page). */
  baseUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  gunzip?: Gunzip;
  timeoutMs?: number;
}

async function fetchBytes(url: string, f: NonNullable<PreloadOptions['fetch']>, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response | null> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => ctl.abort(new Error(`timed out after ${timeoutMs / 1000} s`)), timeoutMs);
  try {
    const r = await f(url, { signal: ctl.signal });
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error(`Loading the saved pixels failed: HTTP ${r.status} for ${url}`);
    // Buffer the body while the timeout still applies.
    const buf = await r.arrayBuffer();
    return new Response(buf, { status: 200, headers: r.headers });
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Load the baked pixel bundle of a preset so its cutouts resolve without touching the archive.
 * Returns how many cutouts it holds; 0 when the preset has no bundle (not an error).
 */
export function preloadBundle(presetId: string, signal?: AbortSignal, opts: PreloadOptions = {}): Promise<number> {
  if (!/^[A-Za-z0-9_-]+$/.test(presetId)) return Promise.resolve(0);
  const existing = bundleLoads.get(presetId);
  if (existing) return existing;
  const p = (async () => {
    const f = opts.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
    const base = (opts.baseUrl ?? './presets').replace(/\/+$/, '');
    const timeout = opts.timeoutMs ?? 60000;
    const [mr, br] = await Promise.all([
      fetchBytes(`${base}/${presetId}.bundle.json`, f, signal, timeout),
      fetchBytes(`${base}/${presetId}.bundle.bin`, f, signal, timeout),
    ]);
    if (!mr || !br) return 0;
    let manifest: unknown;
    try {
      manifest = JSON.parse(await mr.text());
    } catch {
      return 0; // a static host answering an unknown path with index.html
    }
    try {
      validateManifest(manifest);
    } catch {
      return 0;
    }
    const raw = new Uint8Array(await br.arrayBuffer());
    if (raw.length && raw[0] === 0x3c /* '<' : HTML fallback page */) return 0;
    const bin = await gunzipBytes(raw, opts.gunzip);
    const cutouts = decodeBundle(manifest, bin);
    signal?.throwIfAborted();
    return registerBundleCutouts(presetId, cutouts, manifest);
  })();
  bundleLoads.set(presetId, p);
  // A failed or aborted load may be retried later.
  p.catch(() => {
    if (bundleLoads.get(presetId) === p) bundleLoads.delete(presetId);
  });
  return p;
}

/** Where the last getCutout answer for an exposure came from (for the provenance panel). */
export function cutoutSource(exposureId: string): CutoutSource | undefined {
  return sources.get(exposureId);
}

/** Empty the browser cache (IndexedDB) and forget sources; pass { bundles: true } to drop loaded bundles too. */
export async function clearCache(opts: { bundles?: boolean } = {}): Promise<void> {
  sources.clear();
  counters.bundle = counters.cache = counters.archive = counters.storeErrors = 0;
  if (opts.bundles) {
    bundleByExposure.clear();
    bundles.clear();
    bundleLoads.clear();
  }
  const store = await getStore();
  if (store) {
    try {
      await store.clear();
    } catch {
      /* private mode etc.: nothing to clear */
    }
  }
}

export interface CacheStats {
  bundles: { presetId: string; cutouts: number; generated?: string }[];
  bundleCutouts: number;
  /** Browser cache; available false when IndexedDB cannot be used here. */
  store: { available: boolean; count: number; bytes: number; limitBytes: number };
  /** Answers per layer since the page loaded (or the last clearCache). */
  hits: { bundle: number; cache: number; archive: number };
  storeErrors: number;
}

export async function cacheStats(): Promise<CacheStats> {
  const store = await getStore();
  let s = { count: 0, bytes: 0 };
  if (store) {
    try {
      s = await store.stats();
    } catch {
      /* ignore */
    }
  }
  const list = [...bundles.entries()].map(([presetId, b]) => ({ presetId, cutouts: b.cutouts.length, generated: b.manifest.generated }));
  return {
    bundles: list,
    bundleCutouts: list.reduce((a, b) => a + b.cutouts, 0),
    store: { available: !!store, count: s.count, bytes: s.bytes, limitBytes: (store as { limitBytes?: number } | null)?.limitBytes ?? DEFAULT_LIMIT_BYTES },
    hits: { bundle: counters.bundle, cache: counters.cache, archive: counters.archive },
    storeErrors: counters.storeErrors,
  };
}
