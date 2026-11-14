// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Wavelength of a SPHEREx detector pixel. Each detector sits behind a linear variable filter, so the
// wavelength depends on where a source lands on the detector (mostly on the row y). The archive ships
// a small lookup table (the WCS-WAVE extension) that is identical for every exposure of a detector.
// We keep the six tables as static JSON (public/data/wcs_wave_tables.json) and interpolate bilinearly,
// which matches astropy's -TAB lookup to 1e-15 micron (tests/wave.test.ts).

import channelsJson from '../../../public/data/spectral_channels.json';
import tablesJson from '../../../public/data/wcs_wave_tables.json';

export interface WaveTable {
  detector: number;
  /** Control-point columns and rows in 1-based FITS pixel coordinates. */
  x: number[];
  y: number[];
  /** wave[iy][ix] and band[iy][ix] in microns. */
  wave: number[][];
  band: number[][];
}

export interface SpectralChannel {
  /** 1..102 = 17 * (detector - 1) + channel. */
  cubeChannel: number;
  detector: number;
  /** 1..17 within the detector (channel 1 = shortest wavelength). */
  channel: number;
  wavelength: number;
  waveMin: number;
  waveMax: number;
  bandwidth: number;
}

/** The 102 nominal spectral channels (17 per detector) from the DR1 channel calibration. */
export const CHANNELS: SpectralChannel[] = channelsJson as SpectralChannel[];

const TABLES = tablesJson as unknown as Record<string, WaveTable>;

/** The six per-detector lookup tables (bundled; no network). */
export function waveTables(): Record<number, WaveTable> {
  const out: Record<number, WaveTable> = {};
  for (const k of Object.keys(TABLES)) out[Number(k)] = TABLES[k];
  return out;
}

/** Async form kept for callers that want to treat the tables as loadable data. */
export async function loadWaveTables(): Promise<Record<number, WaveTable>> {
  return waveTables();
}

function cell(arr: number[], v: number): number {
  let i = 0;
  while (i < arr.length - 2 && v >= arr[i + 1]) i++;
  return i;
}

/** Central wavelength and bandwidth (microns) at 0-based full-frame pixel (x, y). */
export function waveAt(table: WaveTable, x: number, y: number): { wavelength: number; bandwidth: number } {
  const px = x + 1;
  const py = y + 1;
  const i = cell(table.x, px);
  const j = cell(table.y, py);
  const tx = (px - table.x[i]) / (table.x[i + 1] - table.x[i]);
  const ty = (py - table.y[j]) / (table.y[j + 1] - table.y[j]);
  const lerp = (g: number[][]) =>
    g[j][i] * (1 - tx) * (1 - ty) + g[j][i + 1] * tx * (1 - ty) + g[j + 1][i] * (1 - tx) * ty + g[j + 1][i + 1] * tx * ty;
  return { wavelength: lerp(table.wave), bandwidth: lerp(table.band) };
}

/**
 * Spectral channel (1..17) of a detector pixel from the closed-form channel map, which reproduces the
 * official CHANNEL_MAP calibration for 99.94 % of pixels. Returns 0 or 18 in the off-nominal corners.
 * Channel 17 (longest wavelength) is at the bottom of the detector (small y); strips are 116.47 px tall
 * and follow the filter's "smile" (67.5 px sag at the left and right edges).
 */
export function channelAt(x: number, y: number): number {
  const t = (x - 1019.5) / 1019.5;
  const dy = 67.5 * t * t;
  const s = (y - dy - 111.5) / 116.47;
  if (s < -1) return 18;
  if (s < 0) return 17;
  const k = 16 - Math.floor(s);
  return k < 1 ? 0 : k;
}

/** Cube channel 1..102 for a detector pixel (0 when off-nominal). */
export function cubeChannelAt(detector: number, x: number, y: number): number {
  const c = channelAt(x, y);
  return c >= 1 && c <= 17 ? 17 * (detector - 1) + c : 0;
}

/** Nearest nominal channel to a wavelength within one detector's range (used for labels). */
export function channelForWavelength(detector: number, wavelength: number): SpectralChannel | null {
  let best: SpectralChannel | null = null;
  let bestD = Infinity;
  for (const c of CHANNELS) {
    if (c.detector !== detector) continue;
    const d = Math.abs(c.wavelength - wavelength);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Approximate full-frame pixel of a sky position from the SIA footprint polygon alone (no header needed).
 * The four vertices are the outer pixel corners (-0.5,-0.5), (2039.5,-0.5), (2039.5,2039.5), (-0.5,2039.5).
 * Solves the bilinear map on the tangent plane; good to a few pixels, enough to pick which exposures
 * to download and to guess the wavelength before any pixel is fetched. Returns null when off the frame.
 */
export function approxPixFromRegion(sRegion: number[], ra: number, dec: number): [number, number] | null {
  if (!sRegion || sRegion.length < 8) return null;
  const D2R = Math.PI / 180;
  // Project everything on a tangent plane centred on the target, so the target is at (0, 0).
  const pts: [number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const a = sRegion[2 * k] * D2R;
    const d = sRegion[2 * k + 1] * D2R;
    const a0 = ra * D2R;
    const d0 = dec * D2R;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    if (cosc <= 0) return null;
    pts.push([
      (Math.cos(d) * Math.sin(a - a0)) / cosc,
      (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc,
    ]);
  }
  // P(s, t) = P0 (1-s)(1-t) + P1 s (1-t) + P2 s t + P3 (1-s) t = 0 ; solve by Newton iteration.
  const [p0, p1, p2, p3] = pts;
  let s = 0.5;
  let t = 0.5;
  for (let it = 0; it < 25; it++) {
    const fx = p0[0] * (1 - s) * (1 - t) + p1[0] * s * (1 - t) + p2[0] * s * t + p3[0] * (1 - s) * t;
    const fy = p0[1] * (1 - s) * (1 - t) + p1[1] * s * (1 - t) + p2[1] * s * t + p3[1] * (1 - s) * t;
    const dxs = -p0[0] * (1 - t) + p1[0] * (1 - t) + p2[0] * t - p3[0] * t;
    const dxt = -p0[0] * (1 - s) - p1[0] * s + p2[0] * s + p3[0] * (1 - s);
    const dys = -p0[1] * (1 - t) + p1[1] * (1 - t) + p2[1] * t - p3[1] * t;
    const dyt = -p0[1] * (1 - s) - p1[1] * s + p2[1] * s + p3[1] * (1 - s);
    const det = dxs * dyt - dxt * dys;
    if (Math.abs(det) < 1e-30) return null;
    const ds = (fx * dyt - fy * dxt) / det;
    const dt = (fy * dxs - fx * dys) / det;
    s -= ds;
    t -= dt;
    if (Math.abs(ds) < 1e-10 && Math.abs(dt) < 1e-10) break;
  }
  if (!(s >= 0 && s <= 1 && t >= 0 && t <= 1)) return null;
  return [-0.5 + 2040 * s, -0.5 + 2040 * t];
}
