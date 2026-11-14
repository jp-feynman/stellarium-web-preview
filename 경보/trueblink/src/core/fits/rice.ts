// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// RICE_1 decoder for 32-bit integers (a port of CFITSIO's fits_rdecomp). SPHEREx stores the FLAGS plane
// as a tile-compressed table with one tile per detector row, so we can fetch and decode only the rows
// a cutout needs. Rice coding stores the difference between neighbouring pixels in blocks of 32 values;
// each block starts with a 5-bit code that says how many low bits are stored verbatim.

/** Decode one RICE_1 tile (BYTEPIX = 4) into `nPix` int32 values. Throws if the stream is truncated. */
export function riceDecodeRow(bytes: Uint8Array, nPix: number, blockSize = 32): Int32Array {
  const c = bytes;
  const fsbits = 5;
  const fsmax = 25;
  const bbits = 32;
  const out = new Int32Array(nPix);
  if (c.length < 5) throw new Error(`RICE tile too short (${c.length} bytes)`);
  // The first pixel value is stored verbatim as a big-endian 32-bit integer.
  let lastpix = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) | 0;
  let pos = 4;
  let b = c[pos++];
  let nbits = 8;
  for (let i = 0; i < nPix; ) {
    nbits -= fsbits;
    while (nbits < 0) {
      b = (b << 8) | c[pos++];
      nbits += 8;
    }
    const fs = (b >>> nbits) - 1;
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + blockSize, nPix);
    if (fs < 0) {
      // Low-entropy block: every difference is zero.
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === fsmax) {
      // High-entropy block: differences stored as raw 32-bit values.
      for (; i < imax; i++) {
        let k = bbits - nbits;
        let diff = nbits === 0 ? 0 : b << k;
        for (k -= 8; k >= 0; k -= 8) {
          b = c[pos++];
          diff |= b << k;
        }
        if (nbits > 0) {
          b = c[pos++];
          diff |= b >>> -k;
          b &= (1 << nbits) - 1;
        } else {
          b = 0;
        }
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (diff + lastpix) | 0;
        out[i] = lastpix;
      }
    } else {
      // Normal block: unary-coded high bits followed by fs low bits.
      for (; i < imax; i++) {
        while (b === 0) {
          if (pos >= c.length) throw new Error('RICE tile truncated');
          nbits += 8;
          b = c[pos++];
        }
        const nzero = nbits - (32 - Math.clz32(b));
        nbits -= nzero + 1;
        b ^= 1 << nbits;
        nbits -= fs;
        while (nbits < 0) {
          b = (b << 8) | c[pos++];
          nbits += 8;
        }
        let diff = ((nzero << fs) | (b >>> nbits)) >>> 0;
        b &= (1 << nbits) - 1;
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (diff + lastpix) | 0;
        out[i] = lastpix;
      }
    }
  }
  if (pos > c.length) throw new Error(`RICE tile truncated: needed ${pos} bytes, have ${c.length}`);
  return out;
}
