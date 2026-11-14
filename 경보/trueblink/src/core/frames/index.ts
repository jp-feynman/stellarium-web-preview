// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Cutouts and reprojection. A SPHEREx detector is tilted on the sky, its orientation flips by about
// 180 degrees between survey visits six months apart, and the optics add several pixels of distortion
// (SIP). To blink frames we therefore resample every cutout onto one common north-up, east-left sky grid.
// The native pixels stay available in NativeCutout for photometry.

import {
  FLAG_BITS,
  FLAG_MASKS,
  mjdToIsoDate,
  type Exposure,
  type NativeCutout,
  type SkyFrame,
  type SkyGrid,
  type SkyPos,
  type TanSipWcs,
} from '../types';
import { readFlagsWindow, readWindow, openL2 } from '../fits';
import { gridPixToSky, inFrontOfPlane, pixelAreaArcsec2, skyToPix, tanDeproject } from '../wcs';
import { channelAt, cubeChannelAt, waveAt, waveTables, type WaveTable } from '../wave';

/** Default display grid: half a native pixel (native pixels are about 6.15 arcsec). */
export const DEFAULT_GRID_SCALE = 3.075;
/** Largest grid side in pixels (odd so the target sits on a pixel centre). */
export const MAX_GRID_N = 257;
/** Extra native pixels around the field so bilinear sampling at the edges has neighbours. */
export const WINDOW_MARGIN_PX = 3;
/** Targets closer than this to the detector edge (in pixels) are treated as off the detector. */
export const EDGE_MIN_PX = 2;

/** Flag bits that mark real sky sources or statistical outliers; never treated as bad pixels. */
const NEVER_BAD = (1 << FLAG_BITS.SOURCE) | (1 << FLAG_BITS.OUTLIER);

/**
 * Native pixel window covering a square field of side `fovArcsec` centred on `pos`, plus a 3-pixel margin,
 * clipped to the detector. Null when the position is off the detector or within 2 px of its edge.
 */
export function planWindow(
  wcs: TanSipWcs,
  pos: SkyPos,
  fovArcsec: number,
): { x0: number; y0: number; nx: number; ny: number } | null {
  const [W, H] = wcs.naxis;
  if (!inFrontOfPlane(wcs, pos.ra, pos.dec)) return null;
  const [xt, yt] = skyToPix(wcs, pos.ra, pos.dec);
  // The detector's outer edge is at -0.5 and N - 0.5 in 0-based pixel-centre coordinates.
  const lo = -0.5 + EDGE_MIN_PX;
  if (!(xt >= lo && yt >= lo && xt <= W - 0.5 - EDGE_MIN_PX && yt <= H - 0.5 - EDGE_MIN_PX)) return null;
  // Map the corners and edge midpoints of the sky square to the detector: the square is rotated and
  // slightly distorted there, so take the bounding box of all eight points.
  const h = Math.max(fovArcsec, 1) / 2;
  let minx = xt;
  let maxx = xt;
  let miny = yt;
  let maxy = yt;
  for (const [sx, sy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ]) {
    const [ra, dec] = tanDeproject(pos.ra, pos.dec, sx * h, sy * h);
    const [x, y] = skyToPix(wcs, ra, dec);
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    miny = Math.min(miny, y);
    maxy = Math.max(maxy, y);
  }
  const x0 = Math.max(0, Math.floor(minx) - WINDOW_MARGIN_PX);
  const y0 = Math.max(0, Math.floor(miny) - WINDOW_MARGIN_PX);
  const x1 = Math.min(W - 1, Math.ceil(maxx) + WINDOW_MARGIN_PX);
  const y1 = Math.min(H - 1, Math.ceil(maxy) + WINDOW_MARGIN_PX);
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}

/**
 * Fetch the native pixels around `pos` from one exposure: IMAGE always, plus any requested planes.
 * Fills wavelength, bandwidth, channel and pixel solid angle at the target. Null when off the detector.
 */
export async function loadCutout(
  exposure: Exposure,
  pos: SkyPos,
  fovArcsec: number,
  opts: { planes?: ('ZODI' | 'VARIANCE' | 'FLAGS')[]; signal?: AbortSignal; waveTables?: Record<number, WaveTable> } = {},
): Promise<NativeCutout | null> {
  const { signal } = opts;
  const planes = opts.planes ?? [];
  const header = await openL2(exposure.s3Key, { signal });
  const win = planWindow(header.wcs, pos, fovArcsec);
  if (!win) return null;
  const { x0, y0, nx, ny } = win;
  const [image, zodi, variance, flags] = await Promise.all([
    readWindow(header, 'IMAGE', x0, y0, nx, ny, signal),
    planes.includes('ZODI') ? readWindow(header, 'ZODI', x0, y0, nx, ny, signal) : Promise.resolve(undefined),
    planes.includes('VARIANCE') ? readWindow(header, 'VARIANCE', x0, y0, nx, ny, signal) : Promise.resolve(undefined),
    planes.includes('FLAGS') ? readFlagsWindow(header, x0, y0, nx, ny, signal) : Promise.resolve(undefined),
  ]);
  const [xt, yt] = skyToPix(header.wcs, pos.ra, pos.dec);
  const det = header.detector;
  const tables = opts.waveTables ?? waveTables();
  const table = tables[det];
  if (!table) throw new Error(`no wavelength table for detector ${det}`);
  // The linear variable filter makes the wavelength depend on where the target falls on the detector.
  const { wavelength, bandwidth } = waveAt(table, xt, yt);
  return {
    exposure,
    header,
    x0,
    y0,
    nx,
    ny,
    image,
    zodi,
    variance,
    flags,
    targetPix: [xt, yt],
    wavelength,
    bandwidth,
    channel: channelAt(xt, yt),
    cubeChannel: cubeChannelAt(det, xt, yt),
    omegaArcsec2: pixelAreaArcsec2(header.wcs, xt, yt),
  };
}

/**
 * North-up, east-left grid centred on `pos` covering at least `fovArcsec`. The side n is odd and at most
 * 257; for larger fields the pixel scale grows instead of n.
 */
export function makeGrid(pos: SkyPos, fovArcsec: number, scaleArcsec: number = DEFAULT_GRID_SCALE): SkyGrid {
  if (!(fovArcsec > 0) || !(scaleArcsec > 0)) throw new Error(`invalid grid: fov ${fovArcsec}", scale ${scaleArcsec}"`);
  let scale = scaleArcsec;
  let n = Math.ceil(fovArcsec / scale - 1e-9);
  if (n % 2 === 0) n += 1;
  if (n < 3) n = 3;
  if (n > MAX_GRID_N) {
    n = MAX_GRID_N;
    scale = fovArcsec / MAX_GRID_N;
  }
  return { ra0: pos.ra, dec0: pos.dec, n, scaleArcsec: scale };
}

/** Median of the finite values in `v` (sorted copy). NaN when empty. */
function median(v: Float32Array | number[], n: number): number {
  if (n === 0) return NaN;
  const a = Float64Array.from(v.slice(0, n) as ArrayLike<number>).sort();
  return n % 2 ? a[(n - 1) / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

/**
 * Sigma-clipped median: repeatedly drop values more than `nsigma` robust sigmas (1.4826 x MAD) from the
 * median. Bright stars inflate a plain mean; the clipped median is a stable estimate of the sky level.
 */
export function sigmaClippedMedian(values: Float32Array, nsigma = 3, iterations = 5): { median: number; sigma: number; n: number } {
  let buf = new Float32Array(values.length);
  let n = 0;
  for (let k = 0; k < values.length; k++) if (Number.isFinite(values[k])) buf[n++] = values[k];
  let med = median(buf, n);
  let sigma = NaN;
  for (let it = 0; it < iterations && n > 2; it++) {
    const dev = new Float32Array(n);
    for (let k = 0; k < n; k++) dev[k] = Math.abs(buf[k] - med);
    sigma = 1.4826 * median(dev, n);
    if (!(sigma > 0)) break;
    const next = new Float32Array(n);
    let m = 0;
    for (let k = 0; k < n; k++) if (Math.abs(buf[k] - med) <= nsigma * sigma) next[m++] = buf[k];
    if (m === n) break;
    buf = next;
    n = m;
    med = median(buf, n);
  }
  return { median: med, sigma, n };
}

/**
 * Background-subtracted native window with bad pixels set to NaN. Exported for photometry and tests.
 * badMask never includes the SOURCE or OUTLIER bits, whatever the caller passes.
 */
export function cleanNative(
  cutout: NativeCutout,
  opts: { background?: 'zodi+median' | 'median' | 'none'; badMask?: number } = {},
): { data: Float32Array; level: number; notes: string[] } {
  const notes: string[] = [];
  const n = cutout.nx * cutout.ny;
  const flags = cutout.flags;
  const badMask = (opts.badMask ?? (flags ? FLAG_MASKS.mosaic : 0)) & ~NEVER_BAD;
  const data = new Float32Array(n);
  for (let k = 0; k < n; k++) data[k] = flags && (flags[k] & badMask) !== 0 ? NaN : cutout.image[k];
  let mode = opts.background ?? 'zodi+median';
  if (mode === 'zodi+median' && !cutout.zodi) {
    mode = 'median';
    notes.push('no zodiacal-light model loaded: window median subtracted instead');
  }
  if (mode === 'zodi+median' && cutout.zodi) {
    const z = cutout.zodi;
    for (let k = 0; k < n; k++) data[k] = data[k] - z[k];
  }
  let level = 0;
  if (mode !== 'none') {
    // Estimate the remaining sky level from pixels without sources when enough of them exist
    // (FLAG_MASKS.background marks sources and artefacts); otherwise from every valid pixel.
    let sample = data;
    if (flags) {
      const bg = new Float32Array(n);
      let m = 0;
      let valid = 0;
      for (let k = 0; k < n; k++) {
        if (!Number.isFinite(data[k])) continue;
        valid++;
        if ((flags[k] & FLAG_MASKS.background) === 0) bg[m++] = data[k];
      }
      if (m >= 20 && m >= 0.2 * valid) sample = bg.subarray(0, m);
    }
    level = sigmaClippedMedian(sample).median;
    if (Number.isFinite(level)) for (let k = 0; k < n; k++) data[k] -= level;
    else level = 0;
  } else {
    notes.push('background not subtracted');
  }
  return { data, level, notes };
}

/**
 * Lattice step (grid pixels) for evaluating the exact sky -> detector mapping before interpolating.
 * The mapping is smooth (TAN + cubic SIP), so over ~8 grid pixels (~4 native pixels) bilinear
 * interpolation is good to about 1e-5 px.
 */
const LATTICE_STEP = 8;

/** Native (full-frame) pixel coordinates of every grid pixel centre, x and y arrays of n*n. */
export function gridToNative(wcs: TanSipWcs, grid: SkyGrid, step: number = LATTICE_STEP): { x: Float64Array; y: Float64Array } {
  const n = grid.n;
  const nodes: number[] = [];
  for (let k = 0; k < n - 1; k += step) nodes.push(k);
  nodes.push(n - 1);
  const m = nodes.length;
  const lx = new Float64Array(m * m);
  const ly = new Float64Array(m * m);
  for (let b = 0; b < m; b++) {
    for (let a = 0; a < m; a++) {
      const [ra, dec] = gridPixToSky(grid, nodes[a], nodes[b]);
      const [x, y] = inFrontOfPlane(wcs, ra, dec) ? skyToPix(wcs, ra, dec) : [NaN, NaN];
      lx[b * m + a] = x;
      ly[b * m + a] = y;
    }
  }
  const x = new Float64Array(n * n);
  const y = new Float64Array(n * n);
  let b = 0;
  for (let j = 0; j < n; j++) {
    while (b < m - 2 && j >= nodes[b + 1]) b++;
    const tj = m > 1 ? (j - nodes[b]) / (nodes[b + 1] - nodes[b]) : 0;
    let a = 0;
    for (let i = 0; i < n; i++) {
      while (a < m - 2 && i >= nodes[a + 1]) a++;
      const ti = m > 1 ? (i - nodes[a]) / (nodes[a + 1] - nodes[a]) : 0;
      const k00 = b * m + a;
      const k10 = k00 + 1;
      const k01 = k00 + m;
      const k11 = k01 + 1;
      const w00 = (1 - ti) * (1 - tj);
      const w10 = ti * (1 - tj);
      const w01 = (1 - ti) * tj;
      const w11 = ti * tj;
      x[j * n + i] = lx[k00] * w00 + lx[k10] * w10 + lx[k01] * w01 + lx[k11] * w11;
      y[j * n + i] = ly[k00] * w00 + ly[k10] * w10 + ly[k01] * w01 + ly[k11] * w11;
    }
  }
  return { x, y };
}

/**
 * Resample a cutout onto a north-up, east-left sky grid (bilinear, NaN-aware). A grid pixel is NaN when
 * less than half of its interpolation weight falls on valid native pixels. `weight` holds that fraction.
 */
export function reprojectCutout(
  cutout: NativeCutout,
  grid: SkyGrid,
  opts: { background?: 'zodi+median' | 'median' | 'none'; badMask?: number } = {},
): SkyFrame {
  const { data: src, notes } = cleanNative(cutout, opts);
  const { nx, ny, x0, y0 } = cutout;
  const n = grid.n;
  const { x: gx, y: gy } = gridToNative(cutout.header.wcs, grid);
  const out = new Float32Array(n * n);
  const weight = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const x = gx[k] - x0;
    const y = gy[k] - y0;
    if (!(x > -1 && y > -1 && x < nx && y < ny)) {
      out[k] = NaN;
      continue;
    }
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    let s = 0;
    let w = 0;
    for (let dy = 0; dy <= 1; dy++) {
      const yy = iy + dy;
      if (yy < 0 || yy >= ny) continue;
      const wy = dy ? fy : 1 - fy;
      for (let dx = 0; dx <= 1; dx++) {
        const xx = ix + dx;
        if (xx < 0 || xx >= nx) continue;
        const v = src[yy * nx + xx];
        if (!Number.isFinite(v)) continue;
        const ww = wy * (dx ? fx : 1 - fx);
        s += ww * v;
        w += ww;
      }
    }
    weight[k] = w;
    out[k] = w >= 0.5 ? s / w : NaN;
  }
  const h = cutout.header;
  const det = h.detector;
  const edgeDist = Math.min(cutout.targetPix[0] + 0.5, cutout.targetPix[1] + 0.5, h.wcs.naxis[0] - 0.5 - cutout.targetPix[0], h.wcs.naxis[1] - 0.5 - cutout.targetPix[1]);
  if (edgeDist < 20) notes.push(`target ${edgeDist.toFixed(0)} px from the detector edge`);
  if (cutout.channel < 1 || cutout.channel > 17) notes.push('target in an off-nominal filter corner');
  return {
    grid,
    data: out,
    weight,
    meta: {
      kind: 'exposure',
      label: `${mjdToIsoDate(h.mjdAvg)} · D${det} · ${cutout.wavelength.toFixed(2)} um`,
      mjd: h.mjdAvg,
      mjdMin: h.mjdBeg,
      mjdMax: h.mjdEnd,
      wavelength: cutout.wavelength,
      waveMin: cutout.wavelength - cutout.bandwidth / 2,
      waveMax: cutout.wavelength + cutout.bandwidth / 2,
      detectors: [det],
      nExposures: 1,
      exposureIds: [cutout.exposure.id],
      cubeChannels: cutout.cubeChannel > 0 ? [cutout.cubeChannel] : [],
      notes: notes.length ? notes : undefined,
    },
  };
}
