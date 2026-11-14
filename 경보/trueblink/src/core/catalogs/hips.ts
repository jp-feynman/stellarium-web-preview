// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// HEALPix and HiPS helpers, used when the hips2fits cutout service is down and we read the
// survey's HiPS tiles directly from a mirror.
//
// HEALPix cuts the sphere into 12 equal-area base "faces"; each is split into nside x nside
// diamond-shaped pixels. In the NESTED numbering a pixel's index is its face number followed by the
// bits of its (ix, iy) position inside the face, interleaved. A HiPS survey of order k stores one
// 512 x 512 image ("tile") per HEALPix pixel of order k, so a tile's own pixels are HEALPix pixels of
// order k + 9, and the low 9 bits of ix and iy say where inside the tile a sky position falls.

const TWO_THIRDS = 2 / 3;

/**
 * Position -> (face, ix, iy) in the NESTED scheme for nside = 2^order.
 * theta is the colatitude (pi/2 - dec), phi the longitude (ra), both in radians.
 * Port of the standard ang2pix_nest geometry (Gorski et al. 2005).
 */
export function ang2xyf(order: number, theta: number, phi: number): { face: number; ix: number; iy: number } {
  const nside = 2 ** order;
  const z = Math.cos(theta);
  const za = Math.abs(z);
  let tt = (phi * 2) / Math.PI;
  tt = ((tt % 4) + 4) % 4;
  if (za <= TWO_THIRDS) {
    // Equatorial belt.
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    const face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    const ix = jm - nside * Math.floor(jm / nside);
    const iy = nside - (jp - nside * Math.floor(jp / nside)) - 1;
    return { face, ix, iy };
  }
  // Polar caps.
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  const tmp = nside * Math.sqrt(3 * (1 - za));
  const jp = Math.min(nside - 1, Math.floor(tp * tmp));
  const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
  if (z >= 0) return { face: ntt, ix: nside - jm - 1, iy: nside - jp - 1 };
  return { face: ntt + 8, ix: jp, iy: jm };
}

/** Interleave the bits of ix (even positions) and iy (odd positions); valid for ix, iy < 2^15. */
export function interleave(ix: number, iy: number): number {
  let r = 0;
  for (let b = 0; b < 15; b++) {
    r += ((ix >> b) & 1) * 2 ** (2 * b) + ((iy >> b) & 1) * 2 ** (2 * b + 1);
  }
  return r;
}

/** NESTED pixel index for (face, ix, iy) at the given order (exact while order <= 15). */
export function xyf2nest(order: number, face: number, ix: number, iy: number): number {
  return face * 4 ** order + interleave(ix, iy);
}

/** Bits of the tile width: HiPS tiles here are 512 = 2^9 pixels wide. */
export const TILE_BITS = 9;
export const TILE_WIDTH = 1 << TILE_BITS;

/**
 * Where a sky position falls in a HiPS survey of tile order k:
 * the tile's NESTED index and the 0-based (x, y) array position inside the tile, with y counting
 * FITS rows (row 0 is the first row stored in the file).
 */
export function hipsLocate(order: number, raDeg: number, decDeg: number): { tile: number; x: number; y: number } {
  const theta = Math.PI / 2 - (decDeg * Math.PI) / 180;
  const phi = (raDeg * Math.PI) / 180;
  const { face, ix, iy } = ang2xyf(order + TILE_BITS, theta, phi);
  const tile = xyf2nest(order, face, ix >> TILE_BITS, iy >> TILE_BITS);
  const sx = ix & (TILE_WIDTH - 1);
  const sy = iy & (TILE_WIDTH - 1);
  return { tile, ...tileXY(sx, sy) };
}

/**
 * Map the in-tile HEALPix (ix, iy) to the FITS array (x, y). Measured on a real AllWISE W2 tile
 * (IRSA mirror, order 8): 10 of 11 Gaia stars with G < 18.5 peak within one pixel of this mapping,
 * against 1 of 11 for the next-best of the eight possible flips/transposes.
 * tests/catalogs.test.ts repeats the check on a saved tile.
 */
export function tileXY(sx: number, sy: number): { x: number; y: number } {
  return { x: sy, y: TILE_WIDTH - 1 - sx };
}

/** HiPS tile path: Norder{k}/Dir{floor(N/10000)*10000}/Npix{N}.fits */
export function hipsTilePath(order: number, tile: number): string {
  return `Norder${order}/Dir${Math.floor(tile / 10000) * 10000}/Npix${tile}.fits`;
}

/** Approximate pixel size in arcsec of tile pixels at tile order k (HEALPix order k + 9). */
export function hipsPixelArcsec(order: number): number {
  const nside = 2 ** (order + TILE_BITS);
  return (Math.sqrt(Math.PI / 3) / nside) * (180 / Math.PI) * 3600;
}
