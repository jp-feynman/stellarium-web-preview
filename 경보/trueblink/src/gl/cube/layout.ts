// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Where each SkyFrame sits along the third axis of the cube view. Pure functions, no DOM, unit-tested.
//
// SPHEREx sees a given sky position in "visits": a couple of weeks of repeated exposures, then nothing
// for about six months until the survey comes round again. Plotting slices at their true times would
// squash every visit into a thin sliver separated by huge empty gaps. Instead slices are placed by
// their rank inside a visit, and a fixed, clearly visible gap separates one visit from the next.
// In wavelength mode slices are simply ordered from blue to red (every exposure has its own
// wavelength because of the linear variable filter).

import type { SkyFrame } from '../../core/types';
import { mjdToIsoDate } from '../../core/types';

export type CubeAxis = 'time' | 'wavelength';

export interface SliceGroup {
  /** First and last slice (sorted order) of the group, inclusive. */
  first: number;
  last: number;
  /** Position (0..1 along the stack) of the group's middle. */
  pos: number;
  mjdMin: number;
  mjdMax: number;
  label: string;
}

export interface AxisTick {
  /** Position 0..1 along the stack. */
  pos: number;
  text: string;
}

export interface CubeLayout {
  axis: CubeAxis;
  /** order[k] = index into the input frames array of the k-th slice along the stack. */
  order: number[];
  /** pos[k] = position of slice k along the stack, 0 (first / bluest / earliest) .. 1. */
  pos: number[];
  /** Visits (time mode) or a single group (wavelength mode). */
  groups: SliceGroup[];
  /** Labels to draw along the stack axis. */
  ticks: AxisTick[];
}

/** Gap between visits when frames carry no meta.visit, in days (same default as core/archive groupVisits). */
export const VISIT_GAP_DAYS = 10;

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Short date range label, e.g. "2025-05-04 to 05-15". */
export function dateRangeLabel(mjdMin: number, mjdMax: number): string {
  const a = mjdToIsoDate(mjdMin);
  const b = mjdToIsoDate(mjdMax);
  if (a === b) return a;
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${a} to ${sameYear ? b.slice(5) : b}`;
}

/** Evenly spaced indices 0..count-1, at most maxTicks of them, always including the first and last. */
export function tickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, k) => k);
  const out = new Set<number>();
  for (let t = 0; t < maxTicks; t++) out.add(Math.round((t * (count - 1)) / (maxTicks - 1)));
  return [...out].sort((a, b) => a - b);
}

/** Compute the slice layout of a set of frames along the chosen axis. */
export function computeLayout(frames: SkyFrame[], axis: CubeAxis, opts: { maxTicks?: number } = {}): CubeLayout {
  const maxTicks = opts.maxTicks ?? 8;
  const idx = frames.map((_, k) => k);
  if (frames.length === 0) return { axis, order: [], pos: [], groups: [], ticks: [] };

  if (axis === 'wavelength') {
    // Bluest first; ties broken by time so the order is stable.
    idx.sort((a, b) => {
      const ma = frames[a].meta;
      const mb = frames[b].meta;
      return finiteOr(ma.wavelength, 0) - finiteOr(mb.wavelength, 0) || finiteOr(ma.mjd, 0) - finiteOr(mb.mjd, 0) || a - b;
    });
    const n = idx.length;
    const pos = idx.map((_, k) => (n === 1 ? 0.5 : k / (n - 1)));
    const mjds = idx.map((k) => frames[k].meta.mjd).filter(Number.isFinite);
    const mjdMin = mjds.length ? Math.min(...mjds) : NaN;
    const mjdMax = mjds.length ? Math.max(...mjds) : NaN;
    const ticks = tickIndices(n, maxTicks).map((k) => ({
      pos: pos[k],
      text: `${finiteOr(frames[idx[k]].meta.wavelength, NaN).toFixed(2)} µm`,
    }));
    return {
      axis,
      order: idx,
      pos,
      groups: [{ first: 0, last: n - 1, pos: 0.5, mjdMin, mjdMax, label: 'All frames' }],
      ticks,
    };
  }

  // Time mode: sort by epoch.
  idx.sort((a, b) => finiteOr(frames[a].meta.mjd, 0) - finiteOr(frames[b].meta.mjd, 0) || a - b);

  // Split into visits: by meta.visit when every frame has one, else by gaps longer than VISIT_GAP_DAYS.
  const allHaveVisit = frames.every((f) => typeof f.meta.visit === 'number');
  const groupsIdx: number[][] = [];
  for (let k = 0; k < idx.length; k++) {
    const f = frames[idx[k]];
    let newGroup = k === 0;
    if (k > 0) {
      const prev = frames[idx[k - 1]];
      newGroup = allHaveVisit ? f.meta.visit !== prev.meta.visit : finiteOr(f.meta.mjd, 0) - finiteOr(prev.meta.mjd, 0) > VISIT_GAP_DAYS;
    }
    if (newGroup) groupsIdx.push([]);
    groupsIdx[groupsIdx.length - 1].push(k);
  }

  // Rank inside a visit = 1 unit; between visits a fixed gap that stays visible however many slices there are.
  const maxGroup = Math.max(...groupsIdx.map((g) => g.length));
  const gapUnits = groupsIdx.length > 1 ? Math.max(4, Math.round(0.3 * maxGroup)) : 0;
  const units: number[] = [];
  let u = 0;
  groupsIdx.forEach((g, gi) => {
    if (gi > 0) u += gapUnits;
    g.forEach((_, r) => {
      if (r > 0) u += 1;
      units.push(u);
    });
  });
  const uMax = units[units.length - 1];
  const pos = units.map((v) => (uMax > 0 ? v / uMax : 0.5));

  const groups: SliceGroup[] = groupsIdx.map((g) => {
    const first = g[0];
    const last = g[g.length - 1];
    const mjdMin = frames[idx[first]].meta.mjd;
    const mjdMax = frames[idx[last]].meta.mjd;
    return {
      first,
      last,
      pos: (pos[first] + pos[last]) / 2,
      mjdMin,
      mjdMax,
      label: `${dateRangeLabel(mjdMin, mjdMax)}\n${g.length} frame${g.length === 1 ? '' : 's'}`,
    };
  });

  // Several visits: one label per visit. A single visit: dated ticks along it.
  const ticks: AxisTick[] =
    groups.length > 1
      ? groups.map((g) => ({ pos: g.pos, text: g.label }))
      : tickIndices(idx.length, maxTicks).map((k) => ({ pos: pos[k], text: mjdToIsoDate(frames[idx[k]].meta.mjd) }));

  return { axis, order: idx, pos, groups, ticks };
}

/**
 * Map an epoch (MJD) to a position along a time-mode stack. Piecewise linear between the slices'
 * own epochs, so a track point taken at a slice's time lands exactly on that slice; times between
 * visits fall into the visible gap; times outside the data are clamped to the ends.
 */
export function mjdToStackPos(layout: CubeLayout, frames: SkyFrame[], mjd: number): number {
  const n = layout.order.length;
  if (n === 0) return 0.5;
  const t = layout.order.map((k) => frames[k].meta.mjd);
  if (!(mjd > t[0])) return layout.pos[0];
  if (!(mjd < t[n - 1])) return layout.pos[n - 1];
  for (let k = 1; k < n; k++) {
    if (mjd <= t[k]) {
      const span = t[k] - t[k - 1];
      const f = span > 0 ? (mjd - t[k - 1]) / span : 1;
      return layout.pos[k - 1] + f * (layout.pos[k] - layout.pos[k - 1]);
    }
  }
  return layout.pos[n - 1];
}
