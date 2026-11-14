// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// CPU rendering of a SkyFrame to RGBA pixels: used by the 2D fallback stage and by thumbnails.
// Orientation: a SkyGrid has row 0 at the SOUTH edge and column 0 at the EAST edge, so we write
// grid row j to image row (n - 1 - j). The picture then has north up and east left, as on the sky.
import type { SkyFrame, Stretch } from '../core/types';

type Rgb = [number, number, number];

// Colour maps are data, not UI roles, so they are defined here rather than as tokens.
const MAPS: Record<Stretch['colormap'], Rgb[]> = {
  gray: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  heat: [
    [0, 0, 0],
    [120, 20, 10],
    [230, 90, 20],
    [255, 200, 60],
    [255, 255, 255],
  ],
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  // Dark blue (fainter than the reference) through near-black to orange (brighter).
  diverging: [
    [90, 170, 255],
    [30, 60, 120],
    [12, 14, 20],
    [140, 70, 20],
    [255, 190, 90],
  ],
};

function lerpMap(map: Rgb[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (map.length - 1);
  const i = Math.min(map.length - 2, Math.floor(x));
  const f = x - i;
  const a = map[i];
  const b = map[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Map a surface brightness to 0..1 with the shared stretch. asinh behaves like linear for faint
 * values and like a logarithm for bright ones, so faint sky and bright stars are visible at once.
 */
export function stretchValue(v: number, s: Stretch): number {
  const span = s.hi - s.lo || 1;
  let t = (v - s.lo) / span;
  if (s.colormap === 'diverging') {
    // Signed data (differences): keep zero in the middle and stay linear so the sign is honest.
    t = Math.min(1, Math.max(0, t));
  } else {
    t = Math.min(1, Math.max(0, t));
    switch (s.mode) {
      case 'asinh':
        t = Math.asinh(t * s.q) / Math.asinh(s.q || 1);
        break;
      case 'sqrt':
        t = Math.sqrt(t);
        break;
      case 'log':
        t = Math.log10(1 + 999 * t) / 3;
        break;
      default:
        break;
    }
  }
  return s.invert ? 1 - t : t;
}

/** RGBA pixels (n*n*4), north up. NaN pixels are fully transparent so the "no data" hatch shows through. */
export function frameToRgba(frame: SkyFrame, s: Stretch): Uint8ClampedArray {
  const n = frame.grid.n;
  const out = new Uint8ClampedArray(n * n * 4);
  const map = MAPS[s.colormap] ?? MAPS.gray;
  // Pre-compute a 256-entry palette for speed.
  const lut = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const c = lerpMap(map, k / 255);
    lut[k * 3] = c[0];
    lut[k * 3 + 1] = c[1];
    lut[k * 3 + 2] = c[2];
  }
  for (let j = 0; j < n; j++) {
    const row = n - 1 - j;
    for (let i = 0; i < n; i++) {
      const v = frame.data[j * n + i];
      const o = (row * n + i) * 4;
      if (!Number.isFinite(v)) {
        out[o + 3] = 0;
        continue;
      }
      const k = Math.round(stretchValue(v, s) * 255);
      out[o] = lut[k * 3];
      out[o + 1] = lut[k * 3 + 1];
      out[o + 2] = lut[k * 3 + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Robust display range over all frames (shared by the whole sequence, never per frame). */
export function sharedRange(frames: SkyFrame[], loPct = 0.5, hiPct = 99.7): { lo: number; hi: number } {
  const sample: number[] = [];
  for (const f of frames) {
    const step = Math.max(1, Math.floor(f.data.length / 4000));
    for (let k = 0; k < f.data.length; k += step) {
      const v = f.data[k];
      if (Number.isFinite(v)) sample.push(v);
    }
  }
  if (sample.length === 0) return { lo: 0, hi: 1 };
  sample.sort((a, b) => a - b);
  const q = (p: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.round((p / 100) * (sample.length - 1))))];
  // Robust noise estimate: 1.4826 x median absolute deviation equals sigma for Gaussian noise.
  const med = q(50);
  const dev = sample.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const sigma = 1.4826 * dev[Math.floor(dev.length / 2)];
  // Sky noise sits low on the scale (lo just under the sky, hi at least 16 sigma above it), so
  // faint fields do not turn into static and bright fields still show their faint stars.
  const lo = Math.max(q(loPct), med - 2 * sigma);
  let hi = Math.max(q(hiPct), med + 16 * sigma);
  if (!(hi > lo)) hi = lo + 1;
  return { lo, hi };
}

/** Draw a frame into a canvas 2D context at the given size (nearest-neighbour, pixels stay square). */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: SkyFrame, s: Stretch, w: number, h: number): void {
  const n = frame.grid.n;
  const rgba = frameToRgba(frame, s);
  const src = document.createElement('canvas');
  src.width = n;
  src.height = n;
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
}
