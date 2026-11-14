// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Reading SPHEREx Level-2 files straight from the public S3 bucket with HTTP Range requests.
//
// A Level-2 file holds one detector's 2040 x 2040 frame of one exposure as seven FITS units:
// PRIMARY, IMAGE (calibrated surface brightness), FLAGS (bit mask per pixel), VARIANCE, ZODI (the
// zodiacal-light model), EPSF and WCS-WAVE. Only FLAGS is compressed (RICE, one tile per row), so the
// byte position of everything after it changes from file to file. Two small requests locate it all:
//   1. bytes 0-34559: PRIMARY + IMAGE headers -> sky coordinates (WCS), times, first IMAGE pixel;
//   2. the FLAGS header + its row table -> where each compressed row is, and where VARIANCE/ZODI start.
// After that, a window of an uncompressed plane is a single range from its first to its last pixel.
// Byte offsets are always discovered from headers, never hard-coded per file.

import { FLAG_BITS, type DetectorId, type FrameHeader, type L2Layout } from '../types';
import { wcsFromCards } from '../wcs';
import { BLOCK, hduDataBytes, padBlock, parseHeader, type Cards } from './header';
import { fetchRange, s3Url } from './net';
import { riceDecodeRow } from './rice';

export { parseHeader, padBlock, hduDataBytes, BLOCK } from './header';
export type { Cards, CardValue } from './header';
export { riceDecodeRow } from './rice';
export { fetchRange, s3Url, S3_HOSTS, RequestQueue, defaultQueue, fetchSettings, withLimit, isAbortError } from './net';
export type { FetchSettings } from './net';

/** Detector size in pixels (both axes). */
export const NX = 2040;
export const NY = 2040;
/** Bytes of one uncompressed 2040 x 2040 4-byte plane (exactly 5780 FITS blocks, so no padding). */
export const PLANE_BYTES = NX * NY * 4;
/** First request: PRIMARY (1 block) + IMAGE header (8 or 9 blocks in DR1) + slack. */
export const FIRST_FETCH = 34560;
/** FLAGS request: header (6 blocks) + 2040-row descriptor table (16320 bytes) + slack. */
export const FLAGS_FETCH = 40320;
/**
 * VARIANCE and ZODI header length. Not stored anywhere we can read cheaply, so this is the "forward
 * layout rule" verified on all 258 DR1 files and on QR2/QR3 samples; verifyLayout() re-checks it.
 */
export const PLANE_HEADER_BYTES = 11520;

// ------------------------------------------------------------------ header cache

const headerCache = new Map<string, Promise<FrameHeader>>();
const HEADER_CACHE_MAX = 4000;

/** Forget all cached headers (for tests or when memory is tight). */
export function clearHeaderCache(): void {
  headerCache.clear();
}

/** A header already fetched for this key, if any (no network). */
export async function cachedHeader(s3Key: string): Promise<FrameHeader | undefined> {
  const p = headerCache.get(s3Key);
  if (!p) return undefined;
  try {
    return await p;
  } catch {
    return undefined;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function numCard(cards: Cards, key: string): number | undefined {
  const v = cards[key];
  return typeof v === 'number' ? v : undefined;
}

function requireNum(cards: Cards, key: string, where: string): number {
  const v = numCard(cards, key);
  if (v === undefined) throw new Error(`${where}: keyword ${key} missing or not a number`);
  return v;
}

/** Build a FrameHeader from parsed PRIMARY and IMAGE header cards (exported for offline tests). */
export function frameHeaderFromCards(
  primary: Cards,
  image: Cards,
  url: string,
  imageDataOffset: number,
): FrameHeader {
  const where = `IMAGE header of ${url}`;
  if (String(image.EXTNAME ?? '').trim() !== 'IMAGE' || image.BITPIX !== -32 || image.NAXIS1 !== NX || image.NAXIS2 !== NY) {
    throw new Error(
      `${where}: unexpected HDU (EXTNAME=${String(image.EXTNAME)}, BITPIX=${String(image.BITPIX)}, ` +
        `NAXIS=${String(image.NAXIS1)}x${String(image.NAXIS2)}); this file layout is not supported`,
    );
  }
  const det = requireNum(image, 'DETECTOR', where);
  if (!Number.isInteger(det) || det < 1 || det > 6) throw new Error(`${where}: DETECTOR=${det} is not 1..6`);
  const mjdBeg = numCard(image, 'MJD-BEG') ?? requireNum(image, 'MJD-OBS', where);
  const mjdEnd = numCard(image, 'MJD-END') ?? mjdBeg;
  const mjdAvg = numCard(image, 'MJD-AVG') ?? (mjdBeg + mjdEnd) / 2;
  const x = numCard(image, 'X_SC');
  const y = numCard(image, 'Y_SC');
  const z = numCard(image, 'Z_SC');
  const version = primary.VERSION ?? image.VERSION;
  return {
    wcs: wcsFromCards(image),
    detector: det as DetectorId,
    obsId: String(image.OBSID ?? '').trim(),
    mjdAvg,
    mjdBeg,
    mjdEnd,
    exptime: numCard(image, 'XPOSURE') ?? numCard(image, 'EXPTIME') ?? NaN,
    version: version === undefined ? undefined : String(version).trim(),
    epa: numCard(image, 'SPS_EPA'),
    scPosKm: x !== undefined && y !== undefined && z !== undefined ? [x, y, z] : undefined,
    psfFwhmArcsec: numCard(image, 'PSF_FWHM'),
    omegaMedianArcsec2: numCard(image, 'OMEGA_MEDIAN'),
    cards: image,
    layout: {
      url,
      imageDataOffset,
      flagsHeaderOffset: imageDataOffset + PLANE_BYTES,
    },
  };
}

/**
 * Parse PRIMARY + IMAGE headers from the first bytes of a Level-2 file. Returns null when the IMAGE
 * header's END card is not inside `bytes` yet (fetch more).
 */
export function parseL2Start(bytes: Uint8Array, url: string): FrameHeader | null {
  const p = parseHeader(bytes, 0);
  if (!p) return null;
  if (p.cards.SIMPLE !== true) throw new Error(`${url} does not start with a FITS PRIMARY header`);
  const imageHeaderOffset = p.length + padBlock(hduDataBytes(p.cards));
  const im = parseHeader(bytes, imageHeaderOffset);
  if (!im) return null;
  return frameHeaderFromCards(p.cards, im.cards, url, imageHeaderOffset + im.length);
}

async function openL2Uncached(s3Key: string, shard: number | undefined, signal?: AbortSignal): Promise<FrameHeader> {
  const url = s3Url(s3Key, shard);
  let b = await fetchRange(url, 0, FIRST_FETCH - 1, signal);
  let h = parseL2Start(b, url);
  // A longer IMAGE header (more cards in a future release) needs more blocks: grow 8 blocks at a time.
  for (let k = 0; !h && k < 4; k++) {
    const more = await fetchRange(url, b.length, b.length + 8 * BLOCK - 1, signal);
    b = concat(b, more);
    h = parseL2Start(b, url);
  }
  if (!h) throw new Error(`IMAGE header of ${url} has no END card in the first ${b.length} bytes`);
  return h;
}

/**
 * Request 1 for a file: PRIMARY + IMAGE headers -> FrameHeader with WCS, times and IMAGE data offset.
 * Cached in memory by S3 key; concurrent calls for the same key share one request.
 */
export async function openL2(s3Key: string, opts: { signal?: AbortSignal; shard?: number } = {}): Promise<FrameHeader> {
  const cached = headerCache.get(s3Key);
  if (cached) {
    try {
      return await cached;
    } catch (e) {
      // The shared request failed (perhaps another caller aborted it): try again with our own signal.
      if (opts.signal?.aborted) throw e;
    }
  }
  const p = openL2Uncached(s3Key, opts.shard, opts.signal);
  headerCache.set(s3Key, p);
  if (headerCache.size > HEADER_CACHE_MAX) {
    const oldest = headerCache.keys().next().value;
    if (oldest !== undefined) headerCache.delete(oldest);
  }
  p.catch(() => {
    if (headerCache.get(s3Key) === p) headerCache.delete(s3Key);
  });
  return p;
}

// ------------------------------------------------------------------ FLAGS and the rest of the layout

/** Bit number -> flag name from MSKNnnnn (name) and MSKMnnnn (mask value) cards of the FLAGS header. */
export function flagNamesFromCards(cards: Cards): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(cards)) {
    const m = /^MSKN(\d{1,4})$/.exec(k);
    if (!m || typeof v !== 'string') continue;
    const mask = cards[`MSKM${m[1]}`];
    let bit = Number(m[1]);
    if (typeof mask === 'number' && mask > 0 && Number.isInteger(Math.log2(mask))) bit = Math.log2(mask);
    out[bit] = v.trim();
  }
  return out;
}

/** Layout plus the FLAGS details that only the decoder needs. */
export type FlagsLayout = Omit<L2Layout, 'flagsRowTable'> & { rowTableOffset?: number; nRows?: number; blockSize?: number };

/**
 * Pure layout arithmetic from a parsed FLAGS header (offset `flagsHeaderOffset`, length `headerLength`).
 * Exported for offline tests. Throws on any FLAGS format we have not verified.
 */
export function layoutFromFlagsHeader(
  base: L2Layout,
  cards: Cards,
  headerLength: number,
): FlagsLayout {
  const F = base.flagsHeaderOffset;
  const ext = String(cards.EXTNAME ?? '').trim();
  if (ext !== 'FLAGS') throw new Error(`expected the FLAGS HDU at byte ${F} of ${base.url}, found '${ext}'`);
  let dataBytes: number;
  const out: FlagsLayout = { ...base };
  if (cards.XTENSION === 'BINTABLE' && cards.ZIMAGE === true) {
    // DR1 / QR3: tile-compressed image stored as a binary table, one RICE tile per detector row.
    const bad: string[] = [];
    if (cards.ZCMPTYPE !== 'RICE_1') bad.push(`ZCMPTYPE=${String(cards.ZCMPTYPE)}`);
    if (cards.ZBITPIX !== 32) bad.push(`ZBITPIX=${String(cards.ZBITPIX)}`);
    if (cards.ZNAXIS1 !== NX || cards.ZNAXIS2 !== NY) bad.push(`ZNAXIS=${String(cards.ZNAXIS1)}x${String(cards.ZNAXIS2)}`);
    if (cards.ZTILE1 !== NX || (cards.ZTILE2 ?? 1) !== 1) bad.push(`ZTILE=${String(cards.ZTILE1)}x${String(cards.ZTILE2)}`);
    if (cards.TFIELDS !== 1 || String(cards.TTYPE1 ?? '').trim() !== 'COMPRESSED_DATA') bad.push('extra table columns');
    if (!/^1P[BJ]?/.test(String(cards.TFORM1 ?? '')) || cards.NAXIS1 !== 8) bad.push(`TFORM1=${String(cards.TFORM1)}`);
    if (cards.NAXIS2 !== NY) bad.push(`NAXIS2=${String(cards.NAXIS2)}`);
    for (let k = 1; k <= 9; k++) {
      const name = cards[`ZNAME${k}`];
      if (name === undefined) break;
      const val = cards[`ZVAL${k}`];
      if (name === 'BYTEPIX' && val !== 4) bad.push(`BYTEPIX=${String(val)}`);
      if (name === 'BLOCKSIZE') {
        if (typeof val === 'number' && val > 0) out.blockSize = val;
        else bad.push(`BLOCKSIZE=${String(val)}`);
      }
    }
    if (cards.ZQUANTIZ !== undefined && cards.ZQUANTIZ !== 'NONE') bad.push(`ZQUANTIZ=${String(cards.ZQUANTIZ)}`);
    if (bad.length) throw new Error(`unsupported FLAGS compression in ${base.url}: ${bad.join(', ')}`);
    const naxis1 = 8;
    const nRows = NY;
    const theap = numCard(cards, 'THEAP') ?? naxis1 * nRows;
    dataBytes = naxis1 * nRows + requireNum(cards, 'PCOUNT', 'FLAGS header');
    out.flagsFormat = 'rice';
    out.flagsDataOffset = F + headerLength;
    out.rowTableOffset = F + headerLength;
    out.nRows = nRows;
    out.flagsHeapOffset = F + headerLength + theap;
  } else if (cards.XTENSION === 'IMAGE' && cards.BITPIX === 32 && cards.NAXIS1 === NX && cards.NAXIS2 === NY) {
    // QR2-era files: plain big-endian int32 image.
    const bzero = numCard(cards, 'BZERO') ?? 0;
    const bscale = numCard(cards, 'BSCALE') ?? 1;
    if (bzero !== 0 || bscale !== 1) throw new Error(`FLAGS image in ${base.url} has BZERO/BSCALE; not supported`);
    dataBytes = PLANE_BYTES;
    out.flagsFormat = 'plain';
    out.flagsDataOffset = F + headerLength;
  } else {
    throw new Error(
      `unsupported FLAGS HDU in ${base.url} (XTENSION=${String(cards.XTENSION)}, BITPIX=${String(cards.BITPIX)}, ZIMAGE=${String(cards.ZIMAGE)})`,
    );
  }
  // Forward layout rule: VARIANCE follows FLAGS, ZODI follows VARIANCE, each with a 4-block header.
  const V = F + headerLength + padBlock(dataBytes);
  out.varianceDataOffset = V + PLANE_HEADER_BYTES;
  out.zodiDataOffset = out.varianceDataOffset + PLANE_BYTES + PLANE_HEADER_BYTES;
  return out;
}

const layoutInFlight = new WeakMap<FrameHeader, Promise<L2Layout>>();
const blockSizes = new WeakMap<FrameHeader, number>();

async function ensureLayoutUncached(header: FrameHeader, signal?: AbortSignal): Promise<L2Layout> {
  const base = header.layout;
  const F = base.flagsHeaderOffset;
  let b = await fetchRange(base.url, F, F + FLAGS_FETCH - 1, signal);
  let fh = parseHeader(b, 0);
  for (let k = 0; !fh && k < 4; k++) {
    b = concat(b, await fetchRange(base.url, F + b.length, F + b.length + 8 * BLOCK - 1, signal));
    fh = parseHeader(b, 0);
  }
  if (!fh) throw new Error(`FLAGS header of ${base.url} has no END card`);
  const lay = layoutFromFlagsHeader(base, fh.cards, fh.length);
  let rowTable: Int32Array | undefined;
  if (lay.flagsFormat === 'rice') {
    const nRows = lay.nRows ?? NY;
    const need = fh.length + 8 * nRows;
    if (b.length < need) b = concat(b, await fetchRange(base.url, F + b.length, F + need - 1, signal));
    // Each row descriptor is (uint32 compressed length, uint32 offset into the heap), big-endian.
    const dv = new DataView(b.buffer, b.byteOffset + fh.length, 8 * nRows);
    rowTable = new Int32Array(2 * nRows);
    for (let r = 0; r < nRows; r++) {
      const len = dv.getUint32(8 * r, false);
      const off = dv.getUint32(8 * r + 4, false);
      if (len > 0x7fffffff || off > 0x7fffffff) throw new Error(`FLAGS row table of ${base.url} is corrupt at row ${r}`);
      rowTable[2 * r] = len;
      rowTable[2 * r + 1] = off;
    }
  }
  const result: L2Layout = {
    url: lay.url,
    imageDataOffset: lay.imageDataOffset,
    flagsFormat: lay.flagsFormat,
    flagsHeaderOffset: lay.flagsHeaderOffset,
    flagsDataOffset: lay.flagsDataOffset,
    flagsRowTable: rowTable,
    flagsHeapOffset: lay.flagsHeapOffset,
    varianceDataOffset: lay.varianceDataOffset,
    zodiDataOffset: lay.zodiDataOffset,
  };
  blockSizes.set(header, lay.blockSize ?? 32);
  const names = flagNamesFromCards(fh.cards);
  header.flagNames = Object.keys(names).length ? names : invertFlagBits();
  header.layout = result;
  return result;
}

function invertFlagBits(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [name, bit] of Object.entries(FLAG_BITS)) out[bit] = name;
  return out;
}

/**
 * Request 2 for a file (only when FLAGS, VARIANCE or ZODI are wanted): reads the FLAGS header and row
 * table once, fills the remaining offsets in header.layout and header.flagNames, and returns the layout.
 */
export async function ensureLayout(header: FrameHeader, signal?: AbortSignal): Promise<L2Layout> {
  if (header.layout.flagsFormat) return header.layout;
  const inflight = layoutInFlight.get(header);
  if (inflight) {
    try {
      return await inflight;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  const p = ensureLayoutUncached(header, signal);
  layoutInFlight.set(header, p);
  p.catch(() => {
    if (layoutInFlight.get(header) === p) layoutInFlight.delete(header);
  });
  return p;
}

/**
 * Optional safety check of the forward layout rule: reads the VARIANCE and ZODI headers (two small
 * requests) and throws if either is not where the rule puts it. Use after a new data release appears.
 */
export async function verifyLayout(header: FrameHeader, signal?: AbortSignal): Promise<void> {
  const lay = await ensureLayout(header, signal);
  for (const [name, dataOff] of [
    ['VARIANCE', lay.varianceDataOffset],
    ['ZODI', lay.zodiDataOffset],
  ] as const) {
    if (dataOff === undefined) throw new Error(`${name} offset unknown for ${lay.url}`);
    const start = dataOff - PLANE_HEADER_BYTES;
    const b = await fetchRange(lay.url, start, dataOff - 1, signal);
    const h = parseHeader(b, 0);
    if (!h || String(h.cards.EXTNAME ?? '').trim() !== name || h.length !== PLANE_HEADER_BYTES || h.cards.BITPIX !== -32) {
      throw new Error(`${name} HDU of ${lay.url} is not at byte ${start}: the layout rule does not hold for this file`);
    }
  }
}

// ------------------------------------------------------------------ pixel windows

function checkWindow(x0: number, y0: number, nx: number, ny: number): void {
  const ok =
    [x0, y0, nx, ny].every(Number.isInteger) && nx > 0 && ny > 0 && x0 >= 0 && y0 >= 0 && x0 + nx <= NX && y0 + ny <= NY;
  if (!ok) throw new Error(`pixel window x0=${x0} y0=${y0} nx=${nx} ny=${ny} is not inside the 2040x2040 detector`);
}

/** Byte range [a, b] covering pixels (x0, y0) .. (x0+nx-1, y0+ny-1) of a plane starting at dataOffset. */
export function windowByteRange(dataOffset: number, x0: number, y0: number, nx: number, ny: number): [number, number] {
  const y1 = y0 + ny - 1;
  const x1 = x0 + nx - 1;
  return [dataOffset + (y0 * NX + x0) * 4, dataOffset + (y1 * NX + x1 + 1) * 4 - 1];
}

/**
 * Read a window of an uncompressed float32 plane with one Range request (whole rows in between are
 * downloaded and skipped). Row-major result, index = (y - y0) * nx + (x - x0). NaN stays NaN.
 */
export async function readWindow(
  header: FrameHeader,
  plane: 'IMAGE' | 'VARIANCE' | 'ZODI',
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  checkWindow(x0, y0, nx, ny);
  let off: number | undefined;
  if (plane === 'IMAGE') off = header.layout.imageDataOffset;
  else {
    const lay = await ensureLayout(header, signal);
    off = plane === 'VARIANCE' ? lay.varianceDataOffset : lay.zodiDataOffset;
  }
  if (off === undefined) throw new Error(`${plane} offset unknown for ${header.layout.url}`);
  const [a, b] = windowByteRange(off, x0, y0, nx, ny);
  const raw = await fetchRange(header.layout.url, a, b, signal);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const rowBase = j * NX * 4;
    for (let i = 0; i < nx; i++) out[j * nx + i] = dv.getFloat32(rowBase + 4 * i, false);
  }
  return out;
}

/** Read a window of the FLAGS bit mask (RICE rows are fetched in one request and decoded). */
export async function readFlagsWindow(
  header: FrameHeader,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  signal?: AbortSignal,
): Promise<Int32Array> {
  checkWindow(x0, y0, nx, ny);
  const lay = await ensureLayout(header, signal);
  const out = new Int32Array(nx * ny);
  if (lay.flagsFormat === 'plain') {
    if (lay.flagsDataOffset === undefined) throw new Error(`FLAGS offset unknown for ${lay.url}`);
    const [a, b] = windowByteRange(lay.flagsDataOffset, x0, y0, nx, ny);
    const raw = await fetchRange(lay.url, a, b, signal);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = dv.getInt32((j * NX + i) * 4, false);
    return out;
  }
  const rt = lay.flagsRowTable;
  const heap = lay.flagsHeapOffset;
  if (lay.flagsFormat !== 'rice' || !rt || heap === undefined) throw new Error(`FLAGS layout incomplete for ${lay.url}`);
  // Rows are stored in order in the heap, so rows y0..y1 form one contiguous byte span.
  const y1 = y0 + ny - 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = y0; y <= y1; y++) {
    lo = Math.min(lo, rt[2 * y + 1]);
    hi = Math.max(hi, rt[2 * y + 1] + rt[2 * y]);
  }
  const raw = await fetchRange(lay.url, heap + lo, heap + hi - 1, signal);
  const blockSize = blockSizeOf(header);
  for (let j = 0; j < ny; j++) {
    const y = y0 + j;
    const s = rt[2 * y + 1] - lo;
    const row = riceDecodeRow(raw.subarray(s, s + rt[2 * y]), NX, blockSize);
    out.set(row.subarray(x0, x0 + nx), j * nx);
  }
  return out;
}

function blockSizeOf(header: FrameHeader): number {
  return blockSizes.get(header) ?? 32;
}
