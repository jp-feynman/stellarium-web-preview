// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Pure helpers behind the Research-mode charts and tables: scales and ticks, UTC date labels,
// CSV export, sorting, windowed rows, weighted statistics and the plain-language verdicts.
// No DOM and no React here, so everything is unit-tested in node (tests/research.test.ts).

import { DETECTOR_BANDS, FLAG_BITS, FLAG_MASKS } from '../../core/types';

/** Public HTTPS address of a file in the SPHEREx S3 bucket. */
export const S3_BASE = 'https://nasa-irsa-spherex.s3.amazonaws.com/';

export function s3HttpsUrl(key: string): string {
  return S3_BASE + key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

/** Map a value in [d0, d1] linearly onto [r0, r1]. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Logarithmic scale (base 10); non-positive input maps to NaN. */
export function scaleLog(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const k = l1 === l0 ? 0 : (r1 - r0) / (l1 - l0);
  return (v: number) => (v > 0 ? r0 + (Math.log10(v) - l0) * k : NaN);
}

/** "Nice" round tick values (1, 2, 2.5, 5 x 10^n) covering [min, max] with about `count` ticks. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  if (min > max) [min, max] = [max, min];
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * (1 - 1e-9)) ?? 10 * mag;
  const out: number[] = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Decade ticks for a log axis, with 2 and 5 sub-ticks when the range is narrow. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const build = (mult: number[]) => {
    const out: number[] = [];
    for (let e = lo; e <= hi; e++) {
      for (const m of mult) {
        const v = Number((m * Math.pow(10, e)).toPrecision(12));
        if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
      }
    }
    return out;
  };
  // Decades only, unless that leaves fewer than three labelled ticks.
  const decades = build([1]);
  return decades.length >= 3 ? decades : build([1, 2, 5]);
}

/** Padded extent of finite values; falls back to [0, 1]. */
export function extent(values: number[], padFrac = 0.06): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) {
    const d = Math.abs(lo) * 0.1 || 1;
    return [lo - d, hi + d];
  }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

/** Format a number for display; NaN and infinities become an en dash. */
export function fmtNum(v: number | undefined, digits = 3): string {
  if (v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(Math.max(1, digits - 1));
  return v.toFixed(digits);
}

/** Tick label without trailing zeros. */
export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(0);
  return String(Number(v.toPrecision(6)));
}

const MS_PER_DAY = 86400000;
/** MJD 40587 is 1970-01-01T00:00 UTC (the Unix epoch). */
const MJD_UNIX = 40587;

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - MJD_UNIX) * MS_PER_DAY);
}

export function dateToMjd(d: Date): number {
  return d.getTime() / MS_PER_DAY + MJD_UNIX;
}

/** UTC calendar date ("2025-11-07") or date-time ("2025-11-07 13:04:22") of an MJD. */
export function mjdToUtc(mjd: number, withTime = false): string {
  if (!Number.isFinite(mjd)) return '–';
  const iso = mjdToDate(mjd).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

export interface TimeTick {
  mjd: number;
  /** Full date, e.g. "2025-11-07". */
  label: string;
  /** Compact label for narrow panels: "11-07" for day steps, "2025-11" for month steps. */
  short: string;
}

/**
 * Calendar-aligned time ticks: whole UTC days (1, 2, 5, 7, 14 day steps) or the first of a month
 * (1, 2, 3, 6, 12 month steps), whichever gives at most `maxTicks` ticks.
 */
export function timeTicks(mjdMin: number, mjdMax: number, maxTicks = 6): TimeTick[] {
  if (!Number.isFinite(mjdMin) || !Number.isFinite(mjdMax)) return [];
  if (mjdMax < mjdMin) [mjdMin, mjdMax] = [mjdMax, mjdMin];
  const span = Math.max(mjdMax - mjdMin, 1e-6);
  const limit = Math.max(2, maxTicks);
  for (const step of [1, 2, 5, 7, 14]) {
    if (span / step <= limit) {
      const out: TimeTick[] = [];
      for (let m = Math.ceil(mjdMin / step) * step; m <= mjdMax + 1e-9; m += step) {
        const label = mjdToUtc(m);
        out.push({ mjd: m, label, short: label.slice(5) });
      }
      return out;
    }
  }
  for (const months of [1, 2, 3, 6, 12, 24, 60]) {
    if (span / (30.44 * months) <= limit) {
      const d0 = mjdToDate(mjdMin);
      let y = d0.getUTCFullYear();
      let mo = d0.getUTCMonth() + 1;
      mo = Math.ceil(mo / months) * months;
      const out: TimeTick[] = [];
      for (let guard = 0; guard < 200; guard++) {
        while (mo >= 12) {
          mo -= 12;
          y += 1;
        }
        const m = dateToMjd(new Date(Date.UTC(y, mo, 1)));
        if (m > mjdMax + 1e-9) break;
        if (m >= mjdMin - 1e-9) {
          const label = mjdToUtc(m);
          out.push({ mjd: m, label, short: label.slice(0, 7) });
        }
        mo += months;
      }
      return out;
    }
  }
  return [];
}

/** Detector (1..6) whose band contains a wavelength, or 0. Overlap zones go to the shorter band. */
export function detectorForWavelength(um: number): number {
  for (let d = 1; d <= 6; d++) {
    const b = DETECTOR_BANDS[d];
    if (um >= b.min && um <= b.max) return d;
  }
  return 0;
}

/** Detector of an all-sky cube channel (1..102 = 17 * (detector - 1) + channel). */
export function detectorForCubeChannel(cc: number): number {
  return cc >= 1 && cc <= 102 ? Math.ceil(cc / 17) : 0;
}

export function detectorColor(d: number): string {
  return d >= 1 && d <= 6 ? `var(--d${d})` : 'var(--muted)';
}

const VISIT_COLORS = ['var(--accent-time)', 'var(--accent)', 'var(--good)', 'var(--bad)', 'var(--accent-wave)', 'var(--warn)'];
export function visitColor(i: number): string {
  return VISIT_COLORS[((i % VISIT_COLORS.length) + VISIT_COLORS.length) % VISIT_COLORS.length];
}

// ---------------------------------------------------------------------------------------------
// CSV

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * RFC 4180 CSV. Columns default to the keys of the first row. Numbers that are NaN or infinite
 * become empty cells (no data), never zero. Lines end with CRLF as the RFC asks.
 */
export function toCsv<T extends object>(rows: readonly T[], columns?: readonly (keyof T & string)[]): string {
  const cols: string[] = columns ? [...columns] : rows.length ? Object.keys(rows[0]) : [];
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------
// Sorting and windowing

export type SortDir = 'asc' | 'desc';

/** Stable sort by one key; NaN, null and undefined always sort last. Strings compare naturally. */
export function sortRows<T extends object>(rows: readonly T[], key: keyof T, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const missing = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = a.r[key] as unknown;
      const vb = b.r[key] as unknown;
      const ma = missing(va);
      const mb = missing(vb);
      if (ma || mb) return ma === mb ? a.i - b.i : ma ? 1 : -1;
      let c: number;
      if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
      else c = String(va).localeCompare(String(vb), 'en', { numeric: true });
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Row range [start, end) to render for a scrolled list of fixed-height rows. */
export function windowRange(scrollTop: number, viewportPx: number, rowPx: number, total: number, overscan = 8): { start: number; end: number } {
  if (total <= 0 || rowPx <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowPx);
  const visible = Math.ceil(Math.max(0, viewportPx) / rowPx) + 1;
  const start = Math.max(0, Math.min(total, first - overscan));
  const end = Math.min(total, first + visible + overscan);
  return { start, end };
}

// ---------------------------------------------------------------------------------------------
// Statistics

export interface WeightedStats {
  mean: number;
  /** Formal error of the weighted mean. */
  err: number;
  /** Unweighted standard deviation of the values about the weighted mean. */
  scatter: number;
  /** Reduced chi-square of the values about the mean (1 = scatter matches the error bars). */
  chi2r: number;
  n: number;
}

/** Inverse-variance weighted mean, ignoring non-finite values and non-positive errors. */
export function weightedMean(values: readonly number[], errs: readonly number[]): WeightedStats {
  let sw = 0;
  let swx = 0;
  const keep: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const e = errs[i];
    if (!Number.isFinite(v) || !(e > 0) || !Number.isFinite(e)) continue;
    const w = 1 / (e * e);
    sw += w;
    swx += w * v;
    keep.push([v, e]);
  }
  const n = keep.length;
  if (n === 0) return { mean: NaN, err: NaN, scatter: NaN, chi2r: NaN, n: 0 };
  const mean = swx / sw;
  let ss = 0;
  let chi2 = 0;
  for (const [v, e] of keep) {
    ss += (v - mean) ** 2;
    chi2 += ((v - mean) / e) ** 2;
  }
  return {
    mean,
    err: 1 / Math.sqrt(sw),
    scatter: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN,
    chi2r: n > 1 ? chi2 / (n - 1) : NaN,
    n,
  };
}

export function median(values: readonly number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface MotionVerdict {
  /** Median total motion of the field-star controls (same units as total), NaN when none. */
  controlMedian: number;
  /** 3 x max(control median, measurement error). */
  threshold: number;
  significant: boolean;
  /** total / max(control median, error). */
  ratio: number;
}

/**
 * Is a measured motion real? Field stars measured the same way should show (almost) no motion, so
 * their median sets the floor of what the method can fake. We call a motion significant when it
 * exceeds three times the larger of that floor and the formal error.
 */
export function motionVerdict(total: number, totalErr: number, controls: readonly { total: number }[]): MotionVerdict {
  const controlMedian = median(controls.map((c) => c.total));
  const floor = Math.max(Number.isFinite(controlMedian) ? controlMedian : 0, Number.isFinite(totalErr) ? totalErr : 0);
  const threshold = 3 * floor;
  const ratio = floor > 0 ? total / floor : NaN;
  return { controlMedian, threshold, significant: Number.isFinite(total) && floor > 0 && total > threshold, ratio };
}

/** Linear interpolation of y(x) at x0 (x need not be sorted). NaN outside the range. */
export function interpAt(x: readonly number[], y: readonly number[], x0: number): number {
  const idx = x.map((_, i) => i).filter((i) => Number.isFinite(x[i]) && Number.isFinite(y[i])).sort((a, b) => x[a] - x[b]);
  for (let k = 0; k < idx.length - 1; k++) {
    const i = idx[k];
    const j = idx[k + 1];
    if (x0 >= x[i] && x0 <= x[j]) {
      if (x[j] === x[i]) return y[i];
      return y[i] + ((y[j] - y[i]) * (x0 - x[i])) / (x[j] - x[i]);
    }
  }
  if (idx.length === 1 && x[idx[0]] === x0) return y[idx[0]];
  return NaN;
}

/** Divide a spectrum by its interpolated value at `at` microns (Bus-DeMeo near-infrared convention: 1.2 um). */
export function normaliseAt(wavelength: readonly number[], values: readonly number[], at = 1.2): number[] {
  const v0 = interpAt(wavelength, values, at);
  return values.map((v) => (Number.isFinite(v0) && v0 !== 0 ? v / v0 : NaN));
}

// ---------------------------------------------------------------------------------------------
// Time panels (broken axis)

export interface TimeSegment {
  mjdMin: number;
  mjdMax: number;
  /** Visit index when the segment comes from a Visit. */
  visit?: number;
  label: string;
}

/**
 * Split a time axis into panels so that two-week visits six months apart stay readable. Uses the
 * visits when given (each visit is one panel); otherwise starts a new panel at gaps above `gapDays`.
 */
export function timeSegments(mjds: readonly number[], visits?: readonly { index: number; mjdMin: number; mjdMax: number; label: string }[], gapDays = 10): TimeSegment[] {
  if (visits && visits.length) {
    return [...visits]
      .sort((a, b) => a.mjdMin - b.mjdMin)
      .map((v) => ({ mjdMin: v.mjdMin, mjdMax: v.mjdMax, visit: v.index, label: v.label }));
  }
  const t = mjds.filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (!t.length) return [];
  const segs: TimeSegment[] = [];
  let s0 = t[0];
  let prev = t[0];
  for (let i = 1; i <= t.length; i++) {
    if (i === t.length || t[i] - prev > gapDays) {
      segs.push({ mjdMin: s0, mjdMax: prev, label: mjdToUtc((s0 + prev) / 2) });
      if (i < t.length) s0 = t[i];
    }
    if (i < t.length) prev = t[i];
  }
  return segs;
}

// ---------------------------------------------------------------------------------------------
// Flags

export type FlagGroup = 'defect' | 'bright' | 'info';

export interface FlagInfo {
  name: string;
  bit: number;
  group: FlagGroup;
  /** True when the official photometry-fit mask (Explanatory Supplement p. 45) excludes the pixel. */
  inPhotometryMask: boolean;
}

const FLAG_GROUP: Record<string, FlagGroup> = {
  TRANSIENT: 'defect',
  OVERFLOW: 'defect',
  SUR_ERROR: 'defect',
  NONFUNC: 'defect',
  DICHROIC: 'defect',
  MISSING_DATA: 'defect',
  HOT: 'defect',
  COLD: 'defect',
  PHANMISS: 'defect',
  NONLINEAR: 'defect',
  PERSIST: 'defect',
  SNOWBALL: 'defect',
  STREAK: 'defect',
  CROSSTALK: 'bright',
  GHOST: 'bright',
  GHOST_FPA: 'bright',
  GHOST_EXT: 'bright',
  BLOOM: 'bright',
  HALO: 'bright',
  SATELLITE_HALO: 'bright',
  FULLSAMPLE: 'info',
  OUTLIER: 'info',
  SOURCE: 'info',
};

/** The 23 FLAGS bits of pipeline 7.x, in bit order, with their display group. */
export const FLAG_INFO: FlagInfo[] = Object.entries(FLAG_BITS)
  .map(([name, bit]) => ({ name, bit, group: FLAG_GROUP[name] ?? 'defect', inPhotometryMask: (FLAG_MASKS.photometry & (1 << bit)) !== 0 }))
  .sort((a, b) => a.bit - b.bit);

/** Names of the bits set in a FLAGS value. */
export function flagNames(value: number): string[] {
  return FLAG_INFO.filter((f) => (value & (1 << f.bit)) !== 0).map((f) => f.name);
}

// ---------------------------------------------------------------------------------------------
// Evidence ladder

export type EvidenceLevel = 'observed' | 'detected' | 'classified' | 'inferred';
export const EVIDENCE_LEVELS: EvidenceLevel[] = ['observed', 'detected', 'classified', 'inferred'];

/** State of each rung for a claim at `level`: rungs below are done, the rung itself is current, above are not claimed. */
export function evidenceSteps(level: EvidenceLevel): { level: EvidenceLevel; state: 'done' | 'current' | 'todo' }[] {
  const k = EVIDENCE_LEVELS.indexOf(level);
  return EVIDENCE_LEVELS.map((l, i) => ({ level: l, state: i < k ? 'done' : i === k ? 'current' : 'todo' }));
}

/** Replace {name} placeholders in a translated string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
