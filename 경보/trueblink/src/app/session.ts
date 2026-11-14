// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Non-reactive working data of the current field. Large typed arrays live here, not in the zustand
// store; components subscribe to a version counter and read what they need.
import { useSyncExternalStore } from 'react';
import type { CatalogSource, Exposure, NativeCutout, SkyFrame, SkyGrid, SkyPos, SolarSystemObject, TargetInfo, Visit } from '../core/types';

export type ExposureStatus = 'pending' | 'loading' | 'loaded' | 'off-detector' | 'error' | 'skipped';

export interface Session {
  /** Increases every time a new field is opened; async work must drop results whose id is stale. */
  id: number;
  target: TargetInfo | null;
  /** Field centre used for the grid (the target propagated to the newest epoch, or the typed coordinates). */
  center: SkyPos | null;
  grid: SkyGrid | null;
  fovArcsec: number;
  exposures: Exposure[];
  visits: Visit[];
  /** Visit index by exposure id. */
  visitOf: Map<string, number>;
  /** Wavelength (microns) expected at the target for each exposure before it is loaded (from the footprint), then the measured one. */
  wavelengthOf: Map<string, number>;
  status: Map<string, ExposureStatus>;
  /** Loaded native-pixel windows by exposure id. */
  cutouts: Map<string, NativeCutout>;
  /** Single-exposure frames reprojected on `grid`, by exposure id. */
  exposureFrames: Map<string, SkyFrame>;
  /** Frames from other surveys on the same grid (2MASS, AllWISE...). */
  external: SkyFrame[];
  gaia: CatalogSource[] | null;
  simbad: CatalogSource[] | null;
  /** Known Solar System objects predicted in the field, keyed by visit index. */
  solarSystem: Map<number, SolarSystemObject[]>;
  /** Where the exposure list came from. */
  source: 'live' | 'preset' | 'none';
  warnings: string[];
  /** Per-exposure notes from reprojection (edge distance, filter corner), by exposure id. Optional for older readers. */
  exposureNotes?: Map<string, string[]>;
  /** Where each loaded cutout's pixels came from: the baked bundle, the browser cache or the live archive. */
  pixelSource?: Map<string, 'bundle' | 'cache' | 'archive'>;
  /** The baked pixel bundle used for this field (challenge targets only). */
  bundle?: { presetId: string; generated: string; cutouts: number } | null;
}

/** Count loaded cutouts by pixel source. */
export function pixelSourceCounts(s: Session): { bundle: number; cache: number; archive: number } {
  const out = { bundle: 0, cache: 0, archive: 0 };
  for (const v of s.pixelSource?.values() ?? []) out[v]++;
  return out;
}

function emptySession(id: number): Session {
  return {
    id,
    target: null,
    center: null,
    grid: null,
    fovArcsec: 180,
    exposures: [],
    visits: [],
    visitOf: new Map(),
    wavelengthOf: new Map(),
    status: new Map(),
    cutouts: new Map(),
    exposureFrames: new Map(),
    external: [],
    gaia: null,
    simbad: null,
    solarSystem: new Map(),
    source: 'none',
    warnings: [],
    exposureNotes: new Map(),
    pixelSource: new Map(),
    bundle: null,
  };
}

/** The live session object. Replace its contents with resetSession(); mutate fields then call bumpSession(). */
export let session: Session = emptySession(0);

let version = 0;
const listeners = new Set<() => void>();
let scheduled = false;

/** Start a new session (new field). Returns the new session id. */
export function resetSession(): number {
  session = emptySession(session.id + 1);
  bumpSession();
  return session.id;
}

/** Tell subscribers that session data changed (coalesced to one notification per animation frame). */
export function bumpSession(): void {
  version++;
  if (scheduled) return;
  scheduled = true;
  const fire = () => {
    scheduled = false;
    listeners.forEach((l) => l());
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire);
  else setTimeout(fire, 0);
}

export function onSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: re-render when the session changes. Returns the version number. */
export function useSessionVersion(): number {
  return useSyncExternalStore(onSession, () => version, () => version);
}
