// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Reads a simple (single-HDU) 2-D FITS image, as returned by hips2fits or stored in HiPS tiles.
// FITS stores numbers big-endian; physical value = BZERO + BSCALE * stored, and integer pixels equal
// to BLANK mean "no data". The first stored row is FITS row 1 (0-based y = 0).

import { parseHeader, type Cards } from '../fits';

export interface FitsImage {
  cards: Cards;
  nx: number;
  ny: number;
  /** Row-major, index = y * nx + x; NaN = no data. */
  data: Float32Array;
}

export function parseFitsImage(buf: ArrayBuffer | Uint8Array): FitsImage {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 2880 || String.fromCharCode(...bytes.subarray(0, 6)) !== 'SIMPLE') {
    throw new Error('not a FITS file');
  }
  const h = parseHeader(bytes, 0);
  if (!h) throw new Error('FITS header has no END card');
  const c = h.cards;
  const bitpix = Number(c.BITPIX);
  const naxis = Number(c.NAXIS);
  const nx = Number(c.NAXIS1);
  const ny = Number(c.NAXIS2);
  if (naxis < 2 || !(nx > 0) || !(ny > 0)) throw new Error(`FITS image has NAXIS=${naxis}`);
  const bscale = typeof c.BSCALE === 'number' ? c.BSCALE : 1;
  const bzero = typeof c.BZERO === 'number' ? c.BZERO : 0;
  const blank = typeof c.BLANK === 'number' ? c.BLANK : undefined;
  const bpp = Math.abs(bitpix) / 8;
  const n = nx * ny;
  const start = h.length;
  if (bytes.length < start + n * bpp) throw new Error('FITS data are truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, n * bpp);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v: number;
    switch (bitpix) {
      case 8:
        v = view.getUint8(i);
        break;
      case 16:
        v = view.getInt16(i * 2, false);
        break;
      case 32:
        v = view.getInt32(i * 4, false);
        break;
      case -32:
        v = view.getFloat32(i * 4, false);
        break;
      case -64:
        v = view.getFloat64(i * 8, false);
        break;
      default:
        throw new Error(`unsupported BITPIX ${bitpix}`);
    }
    if (bitpix > 0 && blank !== undefined && v === blank) data[i] = NaN;
    else data[i] = bzero + bscale * v;
  }
  return { cards: c, nx, ny, data };
}

/** Bilinear sample at 0-based (x, y); NaN outside the image or when any neighbour is NaN. */
export function sampleBilinear(img: { nx: number; ny: number; data: Float32Array }, x: number, y: number): number {
  if (!(x >= -0.5 && y >= -0.5 && x <= img.nx - 0.5 && y <= img.ny - 0.5)) return NaN;
  const x0 = Math.max(0, Math.min(img.nx - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.ny - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const d = img.data;
  const i = y0 * img.nx + x0;
  return (
    d[i] * (1 - fx) * (1 - fy) + d[i + 1] * fx * (1 - fy) + d[i + img.nx] * (1 - fx) * fy + d[i + img.nx + 1] * fx * fy
  );
}
