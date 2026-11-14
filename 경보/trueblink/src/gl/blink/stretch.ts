// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Display stretch and colour maps, CPU side. The fragment shader in shaders.ts implements exactly the
// same arithmetic, so a thumbnail made with frameToImageData looks like the frame on the stage.
//
// A "stretch" turns surface brightness (MJy/sr) into a display level between 0 and 1. Infrared sky
// images have a huge dynamic range: a bright star can be 10,000 times the sky noise. A linear map either
// shows the faint sky or the star, never both; asinh behaves linearly near the sky level and
// logarithmically for bright sources, which is why survey viewers (and SDSS colour images) use it.

import type { SkyFrame, Stretch } from '../../core/types';

export type ColormapName = Stretch['colormap'];
export type Rgb = [number, number, number];

/** Colour map stops (0..255 RGB), evenly spaced from level 0 to level 1. */
export const COLOR_MAPS: Record<ColormapName, Rgb[]> = {
  gray: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  // Black body-like "heat": black, deep red, orange, yellow, white.
  heat: [
    [0, 0, 0],
    [110, 10, 8],
    [210, 70, 10],
    [255, 170, 40],
    [255, 240, 150],
    [255, 255, 255],
  ],
  // Viridis (perceptually uniform), 9 stops sampled from the matplotlib table.
  viridis: [
    [68, 1, 84],
    [71, 44, 122],
    [59, 81, 139],
    [44, 113, 142],
    [33, 144, 141],
    [39, 173, 129],
    [92, 200, 99],
    [170, 220, 50],
    [253, 231, 37],
  ],
  // Dark-centred diverging map for difference images: negative (fainter now) = blue,
  // zero = near-black, positive (brighter now) = red. A dark centre keeps the noise quiet so a
  // moving source reads as a blue/red dipole.
  diverging: [
    [190, 225, 255],
    [70, 130, 240],
    [22, 24, 30],
    [235, 75, 50],
    [255, 220, 185],
  ],
};

/** Value written in place of NaN when a frame is uploaded to the GPU (shaders cannot test NaN reliably). */
export const NO_DATA_SENTINEL = -1e30;
/** Anything below this is treated as "no data" by the shader and by the CPU stretch. */
export const NO_DATA_THRESHOLD = -1e29;

/** Colours of the "no data" hatch (dim neutral grey, visibly different from dark sky). */
export const HATCH_DARK: Rgb = [38, 42, 52];
export const HATCH_LIGHT: Rgb = [72, 78, 92];

/** Log stretch exponent (as in SAOImage DS9): level = log10(1 + a u) / log10(1 + a). */
export const LOG_A = 1000;

/** Interpolate a colour map at level t in [0, 1]. */
export function colormapLookup(name: ColormapName, t: number): Rgb {
  const stops = COLOR_MAPS[name] ?? COLOR_MAPS.gray;
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x));
  const f = x - k;
  const a = stops[k];
  const b = stops[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 256-entry RGBA lookup table of a colour map (used as a GPU texture). */
export function colormapLut(name: ColormapName, size = 256): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let k = 0; k < size; k++) {
    const c = colormapLookup(name, k / (size - 1));
    out[4 * k] = Math.round(c[0]);
    out[4 * k + 1] = Math.round(c[1]);
    out[4 * k + 2] = Math.round(c[2]);
    out[4 * k + 3] = 255;
  }
  return out;
}

/** Shape a clipped level u in [0, 1] with the stretch curve (no invert, no colour map). */
export function stretchCurve(u: number, mode: Stretch['mode'], q: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (mode) {
    case 'linear':
      return x;
    case 'sqrt':
      return Math.sqrt(x);
    case 'log':
      return Math.log10(1 + LOG_A * x) / Math.log10(1 + LOG_A);
    case 'asinh':
    default:
      return q > 1e-6 ? Math.asinh(q * x) / Math.asinh(q) : x;
  }
}

/** Display level in [0, 1] of one value, or NaN for no data. Mirrors the shader's `level()`. */
export function stretchValue(v: number, s: Stretch): number {
  if (!Number.isFinite(v) || v < NO_DATA_THRESHOLD) return NaN;
  const span = s.hi - s.lo;
  const u = span !== 0 ? (v - s.lo) / span : v >= s.hi ? 1 : 0;
  const t = stretchCurve(u, s.mode, s.q);
  return s.invert ? 1 - t : t;
}

/**
 * Display level of a difference value d (= a - b) for the diverging map: 0.5 is "no change", the range
 * is symmetric, +-stretch.hi maps to 1 / 0. The same curve shapes both signs so a dipole is symmetric.
 */
export function differenceLevel(d: number, s: Stretch): number {
  if (!Number.isFinite(d)) return NaN;
  const r = Math.abs(s.hi) > 0 ? Math.abs(s.hi) : 1;
  const x = d / r;
  const t = stretchCurve(Math.abs(x), s.mode, s.q);
  return 0.5 + 0.5 * Math.sign(x) * t;
}

/**
 * Lupton et al. (2004) colour mapping for three images: all channels share one asinh of the mean
 * intensity, so the ratio between R, G and B (the colour of a source) is kept even in bright cores
 * that would otherwise clip to white. Returns 0..1 values, or null when any channel has no data.
 */
export function luptonRgb(r: number, g: number, b: number, s: Stretch): Rgb | null {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  if (r < NO_DATA_THRESHOLD || g < NO_DATA_THRESHOLD || b < NO_DATA_THRESHOLD) return null;
  const span = s.hi - s.lo !== 0 ? s.hi - s.lo : 1;
  const x: Rgb = [Math.max(r - s.lo, 0) / span, Math.max(g - s.lo, 0) / span, Math.max(b - s.lo, 0) / span];
  const I = (x[0] + x[1] + x[2]) / 3;
  if (I <= 0) return [0, 0, 0];
  const q = s.q > 1e-6 ? s.q : 0;
  const f = q > 0 ? Math.asinh(q * I) / (Math.asinh(q) * I) : 1;
  let c: Rgb = [x[0] * f, x[1] * f, x[2] * f];
  const m = Math.max(c[0], c[1], c[2]);
  if (m > 1) c = [c[0] / m, c[1] / m, c[2] / m];
  if (s.invert) c = [1 - c[0], 1 - c[1], 1 - c[2]];
  return c;
}

/** RGBA bytes of a frame, top row first (north up, east left), for a canvas. NaN pixels get the hatch. */
export function frameToRGBA(frame: SkyFrame, stretch: Stretch): Uint8ClampedArray {
  const n = frame.grid.n;
  const out = new Uint8ClampedArray(n * n * 4);
  for (let row = 0; row < n; row++) {
    // Canvas row 0 is the top of the picture = the northernmost grid row j = n - 1.
    const j = n - 1 - row;
    for (let i = 0; i < n; i++) {
      const o = 4 * (row * n + i);
      const t = stretchValue(frame.data[j * n + i], stretch);
      let c: Rgb;
      if (Number.isNaN(t)) c = (i + row) % 4 < 2 ? HATCH_LIGHT : HATCH_DARK;
      else c = colormapLookup(stretch.colormap, t);
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Thumbnail of one frame with the shared stretch (same look as the stage, at one canvas pixel per grid pixel). */
export function frameToImageData(frame: SkyFrame, stretch: Stretch): ImageData {
  const n = frame.grid.n;
  const rgba = frameToRGBA(frame, stretch);
  if (typeof ImageData !== 'undefined') return new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, n, n);
  // Outside a browser (tests, workers without ImageData) return a structurally compatible object.
  return { data: rgba, width: n, height: n, colorSpace: 'srgb' } as unknown as ImageData;
}

/**
 * A shared stretch from percentiles of all finite pixels of all frames (never per frame, so that a
 * change in brightness between dates stays visible). Defaults follow common survey-viewer practice.
 */
export function percentileStretch(
  frames: SkyFrame[],
  opts: { loPct?: number; hiPct?: number; mode?: Stretch['mode']; q?: number; colormap?: ColormapName } = {},
): Stretch {
  const loPct = opts.loPct ?? 50;
  const hiPct = opts.hiPct ?? 99.7;
  const vals: number[] = [];
  for (const f of frames) {
    // Subsample large frames so this stays cheap.
    const step = Math.max(1, Math.floor(f.data.length / 200000));
    for (let k = 0; k < f.data.length; k += step) {
      const v = f.data[k];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  vals.sort((a, b) => a - b);
  const pick = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.max(0, Math.round((p / 100) * (vals.length - 1))))] : 0);
  let lo = pick(loPct);
  let hi = pick(hiPct);
  if (!(hi > lo)) hi = lo + 1;
  return { lo, hi, mode: opts.mode ?? 'asinh', q: opts.q ?? 10, invert: false, colormap: opts.colormap ?? 'gray' };
}
