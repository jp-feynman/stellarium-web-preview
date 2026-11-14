// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// core/bundle: a compact, network-free container for the native SPHEREx cutouts of one field.
//
//   <id>.bundle.json  manifest: format/version, field centre and fov, generation date, data releases,
//                     flag names (stored once), and per cutout: the Exposure, the header fields needed to
//                     rebuild a FrameHeader (full TAN+SIP WCS, times, exposure time, detector ...), the
//                     window, the target pixel / wavelength / channel, and byte offsets into the binary.
//   <id>.bundle.bin   IMAGE float32 and FLAGS int32 windows back to back, little-endian, the whole file
//                     gzip-compressed.
//
// encodeBundle / decodeBundle work on the UNCOMPRESSED binary and round-trip bit-exactly (NaN payloads
// included). gzipBytes / gunzipBytes add and remove the compression (DecompressionStream in browsers and
// modern Node; callers may inject their own, e.g. node:zlib).

import type { Exposure, FrameHeader, L2Layout, NativeCutout, SkyPos, TanSipWcs } from '../types';

export const BUNDLE_FORMAT = 'trueblink-pixel-bundle';
export const BUNDLE_VERSION = 1;

/** Field description written into the manifest. */
export interface BundleInfo {
  presetId: string;
  /** Centre the windows were planned around and the field side in arcsec. */
  center: SkyPos;
  fovArcsec: number;
  /** MJD the centre refers to (the target propagated to this epoch), when known. */
  centerMjd?: number;
  /** Field side the stored windows were planned for, when larger than fovArcsec (so nearby centres still hit). */
  windowFovArcsec?: number;
  /** ISO generation time (default: now). */
  generated?: string;
  /** Data releases present ("dr1", "qr3", ...). Default: taken from the cutouts. */
  releases?: string[];
  /** Plain-language notes (e.g. what the bake dropped). */
  notes?: string[];
}

/** JSON-safe number: non-finite values are written as {"$f":"NaN"} and read back exactly. */
export type JsonNum = number | { $f: string };

/** The header fields kept for each cutout (enough to rebuild a FrameHeader with no network). */
export interface BundleHeader {
  wcs: TanSipWcs;
  detector: number;
  obsId: string;
  mjdAvg: JsonNum;
  mjdBeg: JsonNum;
  mjdEnd: JsonNum;
  exptime: JsonNum;
  version?: string;
  epa?: JsonNum;
  scPosKm?: [number, number, number];
  psfFwhmArcsec?: JsonNum;
  omegaMedianArcsec2?: JsonNum;
  /** Scalar IMAGE cards other modules may read (the WCS itself is in `wcs`, every SIP term included). */
  cards: Record<string, string | number | boolean>;
  /** Original file layout (url, IMAGE data offset, FLAGS header offset) for provenance. */
  layout: { url: string; imageDataOffset: number; flagsHeaderOffset: number };
  /** Only present when this cutout's flag names differ from the manifest-level ones (null = none). */
  flagNames?: Record<string, string> | null;
}

/** Byte range inside the uncompressed binary. */
export interface BundleSpan {
  offset: number;
  bytes: number;
}

export interface BundleCutoutEntry {
  exposure: Exposure;
  header: BundleHeader;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  targetPix: [JsonNum, JsonNum];
  wavelength: JsonNum;
  bandwidth: JsonNum;
  channel: number;
  cubeChannel: number;
  omegaArcsec2: JsonNum;
  image: BundleSpan;
  flags?: BundleSpan;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: number;
  presetId: string;
  center: SkyPos;
  fovArcsec: number;
  centerMjd?: number;
  /** Field side (arcsec) the stored windows were planned for (>= fovArcsec). */
  windowFovArcsec: number;
  generated: string;
  releases: string[];
  /** Encoding of the binary part. */
  byteOrder: 'little-endian';
  imageType: 'float32';
  flagsType: 'int32';
  compression: 'gzip';
  /** Length of the uncompressed binary in bytes. */
  binaryBytes: number;
  /** Flag names by bit number (stored once; a cutout header overrides them only when they differ). */
  flagNames?: Record<string, string>;
  notes?: string[];
  cutouts: BundleCutoutEntry[];
}

// ---------------------------------------------------------------------------------------------
// Small helpers

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function jsonNum(v: number): JsonNum {
  return Number.isFinite(v) ? v : { $f: String(v) };
}

export function numFromJson(v: JsonNum | undefined | null): number {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  return Number(v.$f);
}

function optNum(v: number | undefined): JsonNum | undefined {
  return v === undefined ? undefined : jsonNum(v);
}

function optFromJson(v: JsonNum | undefined): number | undefined {
  return v === undefined ? undefined : numFromJson(v);
}

/**
 * IMAGE header cards copied into the manifest. The celestial WCS (CRVAL, CRPIX, PC/CD, CDELT and every
 * A/B/AP/BP SIP term) is stored exactly as the parsed TanSipWcs object, so those cards are not repeated;
 * we keep the projection names and the scalar keywords other modules may read.
 */
const KEPT_CARDS = new Set([
  'EXTNAME', 'BITPIX', 'NAXIS', 'NAXIS1', 'NAXIS2', 'BUNIT', 'CTYPE1', 'CTYPE2', 'CUNIT1', 'CUNIT2', 'RADESYS',
  'DETECTOR', 'OBSID', 'MJD-OBS', 'MJD-BEG', 'MJD-AVG', 'MJD-END', 'DATE-OBS', 'DATE-AVG',
  'XPOSURE', 'EXPTIME', 'SPS_EPA', 'X_SC', 'Y_SC', 'Z_SC', 'PSF_FWHM', 'OMEGA_MEDIAN', 'VERSION',
]);

export function keepCard(key: string): boolean {
  return KEPT_CARDS.has(key);
}

function flagNamesToJson(names: Record<number, string> | undefined): Record<string, string> | undefined {
  if (!names) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(names)) out[k] = v;
  return out;
}

function flagNamesFromJson(names: Record<string, string> | undefined): Record<number, string> | undefined {
  if (!names) return undefined;
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(names)) out[Number(k)] = v;
  return out;
}

function sameNames(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  if (!a || !b) return a === b;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Copy the raw bytes of a typed array (little-endian on disk). */
function writeLE(dst: Uint8Array, offset: number, src: Float32Array | Int32Array): void {
  if (HOST_LITTLE_ENDIAN) {
    dst.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), offset);
    return;
  }
  const dv = new DataView(dst.buffer, dst.byteOffset + offset, src.byteLength);
  const raw = new Uint32Array(src.buffer, src.byteOffset, src.length); // bit pattern, NaN payloads intact
  for (let k = 0; k < raw.length; k++) dv.setUint32(4 * k, raw[k], true);
}

function readLE(src: Uint8Array, span: BundleSpan): ArrayBuffer {
  const out = new ArrayBuffer(span.bytes);
  if (span.offset < 0 || span.offset + span.bytes > src.length || span.bytes % 4 !== 0) {
    throw new Error(`pixel bundle: byte range ${span.offset}+${span.bytes} is outside the ${src.length}-byte binary`);
  }
  if (HOST_LITTLE_ENDIAN) {
    new Uint8Array(out).set(src.subarray(span.offset, span.offset + span.bytes));
    return out;
  }
  const dv = new DataView(src.buffer, src.byteOffset + span.offset, span.bytes);
  const raw = new Uint32Array(out);
  for (let k = 0; k < raw.length; k++) raw[k] = dv.getUint32(4 * k, true);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Header <-> manifest

export function headerToBundle(h: FrameHeader, sharedFlagNames?: Record<string, string>): BundleHeader {
  const cards: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(h.cards)) if (keepCard(k)) cards[k] = typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
  const own = flagNamesToJson(h.flagNames);
  return {
    wcs: h.wcs,
    detector: h.detector,
    obsId: h.obsId,
    mjdAvg: jsonNum(h.mjdAvg),
    mjdBeg: jsonNum(h.mjdBeg),
    mjdEnd: jsonNum(h.mjdEnd),
    exptime: jsonNum(h.exptime),
    version: h.version,
    epa: optNum(h.epa),
    scPosKm: h.scPosKm,
    psfFwhmArcsec: optNum(h.psfFwhmArcsec),
    omegaMedianArcsec2: optNum(h.omegaMedianArcsec2),
    cards,
    layout: { url: h.layout.url, imageDataOffset: h.layout.imageDataOffset, flagsHeaderOffset: h.layout.flagsHeaderOffset },
    ...(!sameNames(own, sharedFlagNames) ? { flagNames: own ?? null } : {}),
  };
}

export function headerFromBundle(b: BundleHeader, sharedFlagNames?: Record<string, string>): FrameHeader {
  const layout: L2Layout = { url: b.layout.url, imageDataOffset: b.layout.imageDataOffset, flagsHeaderOffset: b.layout.flagsHeaderOffset };
  const names = flagNamesFromJson(b.flagNames === undefined ? sharedFlagNames : (b.flagNames ?? undefined));
  return {
    wcs: b.wcs,
    detector: b.detector as FrameHeader['detector'],
    obsId: b.obsId,
    mjdAvg: numFromJson(b.mjdAvg),
    mjdBeg: numFromJson(b.mjdBeg),
    mjdEnd: numFromJson(b.mjdEnd),
    exptime: numFromJson(b.exptime),
    version: b.version,
    epa: optFromJson(b.epa),
    scPosKm: b.scPosKm,
    psfFwhmArcsec: optFromJson(b.psfFwhmArcsec),
    omegaMedianArcsec2: optFromJson(b.omegaMedianArcsec2),
    ...(names ? { flagNames: names } : {}),
    cards: { ...b.cards },
    layout,
  };
}

// ---------------------------------------------------------------------------------------------
// Encode / decode

/**
 * Pack cutouts into a manifest plus an UNCOMPRESSED binary (gzip it with gzipBytes before writing).
 * Only IMAGE and FLAGS are stored; ZODI and VARIANCE are dropped.
 */
export function encodeBundle(cutouts: NativeCutout[], info: BundleInfo): { manifest: BundleManifest; binary: Uint8Array } {
  // Flag names: the most common set is stored once.
  const counts = new Map<string, { n: number; names: Record<string, string> }>();
  for (const c of cutouts) {
    const nm = flagNamesToJson(c.header.flagNames);
    if (!nm) continue;
    const key = JSON.stringify(Object.entries(nm).sort((a, b) => Number(a[0]) - Number(b[0])));
    const e = counts.get(key) ?? { n: 0, names: nm };
    e.n++;
    counts.set(key, e);
  }
  let shared: Record<string, string> | undefined;
  let best = 0;
  for (const e of counts.values()) if (e.n > best) ((best = e.n), (shared = e.names));

  let total = 0;
  for (const c of cutouts) {
    const n = c.nx * c.ny;
    if (c.image.length !== n) throw new Error(`pixel bundle: ${c.exposure.id} image has ${c.image.length} values, window is ${c.nx}x${c.ny}`);
    if (c.flags && c.flags.length !== n) throw new Error(`pixel bundle: ${c.exposure.id} flags have ${c.flags.length} values, window is ${c.nx}x${c.ny}`);
    total += 4 * n + (c.flags ? 4 * n : 0);
  }
  const binary = new Uint8Array(total);
  let off = 0;
  const entries: BundleCutoutEntry[] = [];
  for (const c of cutouts) {
    const n = c.nx * c.ny;
    const image: BundleSpan = { offset: off, bytes: 4 * n };
    writeLE(binary, off, c.image);
    off += 4 * n;
    let flags: BundleSpan | undefined;
    if (c.flags) {
      flags = { offset: off, bytes: 4 * n };
      writeLE(binary, off, c.flags);
      off += 4 * n;
    }
    entries.push({
      exposure: c.exposure,
      header: headerToBundle(c.header, shared),
      x0: c.x0,
      y0: c.y0,
      nx: c.nx,
      ny: c.ny,
      targetPix: [jsonNum(c.targetPix[0]), jsonNum(c.targetPix[1])],
      wavelength: jsonNum(c.wavelength),
      bandwidth: jsonNum(c.bandwidth),
      channel: c.channel,
      cubeChannel: c.cubeChannel,
      omegaArcsec2: jsonNum(c.omegaArcsec2),
      image,
      ...(flags ? { flags } : {}),
    });
  }
  const releases = info.releases ?? [...new Set(cutouts.map((c) => c.exposure.release))].sort();
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    presetId: info.presetId,
    center: { ra: info.center.ra, dec: info.center.dec },
    fovArcsec: info.fovArcsec,
    ...(info.centerMjd !== undefined ? { centerMjd: info.centerMjd } : {}),
    windowFovArcsec: info.windowFovArcsec ?? info.fovArcsec,
    generated: info.generated ?? new Date().toISOString(),
    releases,
    byteOrder: 'little-endian',
    imageType: 'float32',
    flagsType: 'int32',
    compression: 'gzip',
    binaryBytes: total,
    ...(shared ? { flagNames: shared } : {}),
    ...(info.notes?.length ? { notes: info.notes } : {}),
    cutouts: entries,
  };
  return { manifest, binary };
}

/** Throws with a plain-English message when `m` is not a manifest this code can read. */
export function validateManifest(m: unknown): asserts m is BundleManifest {
  const b = m as Partial<BundleManifest> | null;
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) throw new Error('not a TrueBlink pixel bundle manifest');
  if (b.version !== BUNDLE_VERSION) throw new Error(`pixel bundle version ${String(b.version)} is not supported (expected ${BUNDLE_VERSION})`);
  if (b.byteOrder !== 'little-endian') throw new Error(`pixel bundle byte order ${String(b.byteOrder)} is not supported`);
  if (!Array.isArray(b.cutouts)) throw new Error('pixel bundle manifest has no cutout list');
}

/** Rebuild one cutout from its manifest entry and the uncompressed binary. */
export function decodeEntry(e: BundleCutoutEntry, binary: Uint8Array, sharedFlagNames?: Record<string, string>): NativeCutout {
  const n = e.nx * e.ny;
  if (e.image.bytes !== 4 * n) throw new Error(`pixel bundle: ${e.exposure.id} image span does not match its ${e.nx}x${e.ny} window`);
  const image = new Float32Array(readLE(binary, e.image));
  let flags: Int32Array | undefined;
  if (e.flags) {
    if (e.flags.bytes !== 4 * n) throw new Error(`pixel bundle: ${e.exposure.id} flags span does not match its window`);
    flags = new Int32Array(readLE(binary, e.flags));
  }
  return {
    exposure: e.exposure,
    header: headerFromBundle(e.header, sharedFlagNames),
    x0: e.x0,
    y0: e.y0,
    nx: e.nx,
    ny: e.ny,
    image,
    ...(flags ? { flags } : {}),
    targetPix: [numFromJson(e.targetPix[0]), numFromJson(e.targetPix[1])],
    wavelength: numFromJson(e.wavelength),
    bandwidth: numFromJson(e.bandwidth),
    channel: e.channel,
    cubeChannel: e.cubeChannel,
    omegaArcsec2: numFromJson(e.omegaArcsec2),
  };
}

/** Inverse of encodeBundle. `binary` must be the UNCOMPRESSED bytes (see gunzipBytes). */
export function decodeBundle(manifest: BundleManifest, binary: Uint8Array): NativeCutout[] {
  validateManifest(manifest);
  if (isGzip(binary)) throw new Error('pixel bundle binary is still gzip-compressed: call gunzipBytes first');
  if (binary.length < manifest.binaryBytes) {
    throw new Error(`pixel bundle binary has ${binary.length} bytes, the manifest expects ${manifest.binaryBytes}`);
  }
  return manifest.cutouts.map((e) => decodeEntry(e, binary, manifest.flagNames));
}

// ---------------------------------------------------------------------------------------------
// Compression

export function isGzip(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export type Gunzip = (bytes: Uint8Array) => Promise<Uint8Array>;

async function streamThrough(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

/** True when this runtime can gunzip without help (DecompressionStream). */
export function canGunzip(): boolean {
  return typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === 'function';
}

/**
 * Remove gzip compression. Bytes that are not gzip (e.g. a host that already decoded a
 * Content-Encoding: gzip response) are returned unchanged.
 */
export async function gunzipBytes(bytes: Uint8Array, gunzip?: Gunzip): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (gunzip) return gunzip(bytes);
  const DS = (globalThis as { DecompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).DecompressionStream;
  if (!DS) throw new Error('this browser cannot decompress the saved pixel bundle (no DecompressionStream)');
  return streamThrough(bytes, new DS('gzip'));
}

/** Gzip with CompressionStream (browsers, Node 18+). The bake script uses node:zlib directly. */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).CompressionStream;
  if (!CS) throw new Error('no CompressionStream in this runtime');
  return streamThrough(bytes, new CS('gzip'));
}
