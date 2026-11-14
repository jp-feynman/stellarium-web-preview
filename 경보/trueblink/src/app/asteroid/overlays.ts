// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Known Solar System objects over the blink view. One SkyBoT cone search per visit (geocentric
// positions at the frame epoch), cached per field and visit in session.solarSystem, shifted from the
// Earth's centre to the SPHEREx spacecraft with the X_SC/Y_SC/Z_SC vector of a loaded Level-2 header,
// then moved linearly to each frame's own epoch.

import { OVERLAY_COLORS, leoParallaxArcsec, skybotCone } from '../../core/catalogs';
import { skyToGridPix, tanDeproject } from '../../core/wcs';
import type { NativeCutout, Overlay, SkyFrame, SkyGrid, SolarSystemObject } from '../../core/types';
import { bumpSession, session, type Session } from '../session';

/** Extra cone radius beyond the grid's half diagonal (arcsec). */
export const CONE_MARGIN_ARCSEC = 60;

/** Plain-language explanation carried in every overlay's data (and repeated in the Asteroid tab). */
export const SMEAR_NOTE =
  'A visit spans days and asteroids move tens of arcseconds per hour, so a per-visit stack smears a moving object into a faint streak or loses it. ' +
  'Single exposures (the "Colour sweep" sequence) show it as a dot that jumps from frame to frame.';

export interface SsoOverlayData {
  object: SolarSystemObject;
  visit: number | undefined;
  /** Position used for the marker (after the parallax shift and the move to the frame epoch). */
  ra: number;
  dec: number;
  frameMjd: number;
  /** 'spacecraft' when a header vector was used, 'geocentric' when none was loaded for this visit. */
  observer: 'spacecraft' | 'geocentric';
  parallaxArcsec?: [number, number];
  /** Exposure whose header vector was used. */
  vectorFrom?: string;
  note: string;
}

type SkybotFn = (pos: { ra: number; dec: number }, radiusArcsec: number, mjd: number, signal?: AbortSignal) => Promise<SolarSystemObject[]>;

let skybot: SkybotFn = skybotCone;
/** Test hook: replace the SkyBoT client (pass null to restore the real one). */
export function setSkybotClient(fn: SkybotFn | null): void {
  skybot = fn ?? skybotCone;
}

const inflight = new Map<string, Promise<SolarSystemObject[]>>();

/** Cone radius that covers the whole grid plus a margin for motion (arcsec). */
export function coneRadiusArcsec(grid: SkyGrid): number {
  return (grid.n * grid.scaleArcsec * Math.SQRT2) / 2 + CONE_MARGIN_ARCSEC;
}

/** Cached SkyBoT answer for one visit of the current field (one request per field and visit). */
async function objectsForVisit(s: Session, key: number, grid: SkyGrid, mjd: number, signal?: AbortSignal): Promise<SolarSystemObject[]> {
  const cached = s.solarSystem.get(key);
  if (cached) return cached;
  const id = `${s.id}:${key}:${grid.ra0.toFixed(5)},${grid.dec0.toFixed(5)}`;
  let p = inflight.get(id);
  if (!p) {
    p = skybot({ ra: grid.ra0, dec: grid.dec0 }, coneRadiusArcsec(grid), mjd, signal);
    inflight.set(id, p);
    p.then(
      (objs) => {
        inflight.delete(id);
        if (session.id === s.id) {
          session.solarSystem.set(key, objs);
          bumpSession();
        }
      },
      () => inflight.delete(id),
    );
  }
  return p;
}

/** Spacecraft vector for a frame: its own exposures first, else the visit's exposure nearest in time. */
function headerVector(s: Session, frame: SkyFrame): { pos: [number, number, number]; from: string } | null {
  for (const id of frame.meta.exposureIds) {
    const c = s.cutouts.get(id);
    if (c?.header.scPosKm && frame.meta.nExposures === 1) return { pos: c.header.scPosKm, from: id };
  }
  const visit = frame.meta.visit;
  let best: NativeCutout | null = null;
  let bestDt = Infinity;
  const ids = new Set(frame.meta.exposureIds);
  for (const [id, c] of s.cutouts) {
    if (!c.header.scPosKm) continue;
    const inFrame = ids.has(id);
    const inVisit = visit !== undefined && s.visitOf.get(id) === visit;
    if (!inFrame && !inVisit) continue;
    const dt = Math.abs((c.header.mjdAvg || c.exposure.mjd) - frame.meta.mjd) - (inFrame ? 1e6 : 0);
    if (dt < bestDt) {
      bestDt = dt;
      best = c;
    }
  }
  return best?.header.scPosKm ? { pos: best.header.scPosKm, from: best.exposure.id } : null;
}

function label(o: SolarSystemObject): string {
  const name = `${o.number !== undefined ? `(${o.number}) ` : ''}${o.name}`;
  return o.vMag !== undefined && Number.isFinite(o.vMag) ? `${name} (V ${o.vMag.toFixed(1)})` : name;
}

/**
 * Build markers for one frame from a list of objects predicted at o.mjd (geocentric): shift to the
 * spacecraft when a header vector is given, move linearly to the frame epoch, keep what lands on the grid.
 */
export function objectOverlays(
  objects: SolarSystemObject[],
  frame: SkyFrame,
  frameIndex: number,
  vector: { pos: [number, number, number]; from: string } | null,
  opts: { color?: string; arrowHours?: number; marginPix?: number } = {},
): Overlay[] {
  const color = opts.color ?? OVERLAY_COLORS.solarSystem;
  const hours = opts.arrowHours ?? 1;
  const margin = opts.marginPix ?? 2;
  const grid = frame.grid;
  const out: Overlay[] = [];
  for (const o of objects) {
    const dtH = (frame.meta.mjd - o.mjd) * 24;
    const rate: [number, number] = [o.dRa ?? 0, o.dDec ?? 0];
    let [ra, dec] = tanDeproject(o.ra, o.dec, rate[0] * dtH, rate[1] * dtH);
    let par: [number, number] | undefined;
    if (vector && o.deltaAu && o.deltaAu > 0) {
      par = leoParallaxArcsec(ra, dec, o.deltaAu, vector.pos);
      if (Number.isFinite(par[0]) && Number.isFinite(par[1])) [ra, dec] = tanDeproject(ra, dec, par[0], par[1]);
      else par = undefined;
    }
    const [i, j] = skyToGridPix(grid, ra, dec);
    if (!(i >= -margin && j >= -margin && i <= grid.n - 1 + margin && j <= grid.n - 1 + margin)) continue;
    const data: SsoOverlayData = {
      object: o,
      visit: frame.meta.visit,
      ra,
      dec,
      frameMjd: frame.meta.mjd,
      observer: par ? 'spacecraft' : 'geocentric',
      parallaxArcsec: par,
      vectorFrom: par ? vector?.from : undefined,
      note: SMEAR_NOTE,
    };
    const id = `sso:${frame.meta.visit ?? 'f'}:${frameIndex}:${o.number ?? o.name}`;
    out.push({ id, kind: 'circle', ra, dec, sizeArcsec: Math.max(10, 3 * (o.errArcsec ?? 0)), color, text: label(o), frameIndex, data });
    if (o.dRa !== undefined && o.dDec !== undefined && (o.dRa !== 0 || o.dDec !== 0)) {
      const [ra2, dec2] = tanDeproject(ra, dec, o.dRa * hours, o.dDec * hours);
      out.push({ id: `${id}:motion`, kind: 'arrow', ra, dec, path: [[ra, dec], [ra2, dec2]], color, frameIndex, data });
    }
  }
  return out;
}

function pushWarning(msg: string): void {
  if (!session.warnings.includes(msg)) {
    session.warnings.push(msg);
    bumpSession();
  }
}

/**
 * Markers for known Solar System objects predicted in the field at each frame's time.
 * One SkyBoT request per distinct visit (cached per field and visit in session.solarSystem).
 * SkyBoT failures resolve to the overlays that could be built (often []) plus a warning in session.warnings.
 */
export async function solarSystemOverlays(frames: SkyFrame[], signal?: AbortSignal): Promise<Overlay[]> {
  if (frames.length === 0) return [];
  const s = session;
  // Group frames by visit; frames without a visit get their own key (negative, never clashes with visits).
  const groups = new Map<number, number[]>();
  frames.forEach((f, i) => {
    const key = f.meta.visit ?? -(i + 1);
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const out: Overlay[] = [];
  const failures: string[] = [];
  await Promise.all(
    [...groups.entries()].map(async ([key, idx]) => {
      const first = frames[idx[0]];
      try {
        const objs = await objectsForVisit(s, key, first.grid, first.meta.mjd, signal);
        if (signal?.aborted || session.id !== s.id) return;
        for (const i of idx) out.push(...objectOverlays(objs, frames[i], i, headerVector(s, frames[i])));
      } catch (e) {
        if (signal?.aborted) return;
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }),
  );
  if (signal?.aborted || session.id !== s.id) return [];
  if (failures.length > 0) {
    pushWarning(`Known Solar System objects could not be loaded for ${failures.length} visit(s): ${failures[0]}`);
  }
  return out;
}
