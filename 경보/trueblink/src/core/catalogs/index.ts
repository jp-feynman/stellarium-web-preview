// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Overlays from other catalogues and missions, all callable straight from the browser (every
// service below sends Access-Control-Allow-Origin: *). Each service has an ordered list of mirrors:
// the main CDS hosts in Strasbourg were down during the hackathon, while the Harvard (CfA) and
// IDIA (South Africa) mirrors answered.
//
//  - Gaia DR3 (VizieR I/355/gaiadr3): stars with proper motion and parallax, positions at J2016.0.
//  - SIMBAD (TAP): named objects and their types, positions at J2000.0.
//  - SkyBoT (IMCCE): known asteroids and comets predicted in the field at a given time.
//  - hips2fits / HiPS tiles: older survey images (see external.ts).

import type { CatalogSource, Overlay, SkyPos, SolarSystemObject } from '../types';
import { mjdToJyear } from '../types';
import { tanDeproject } from '../wcs';
import { readText, tryMirrors } from './net';
import { parseGaiaTsv, parseSimbadTapJson, parseSkybotJson } from './parse';

export { externalFrame, EXTERNAL_SURVEYS, HIPS2FITS_HOSTS } from './external';
export type { ExternalSurvey } from './external';
export { parseGaiaTsv, parseSimbadTapJson, parseSkybotJson, parseVizierTsv, parseSexagesimal, GAIA_EPOCH, SIMBAD_EPOCH } from './parse';
export { DEFAULT_TIMEOUT_MS } from './net';

export const VIZIER_MIRRORS = ['https://vizier.cfa.harvard.edu', 'https://vizier.idia.ac.za', 'https://vizier.cds.unistra.fr'];
export const SIMBAD_MIRRORS = ['https://simbad.harvard.edu', 'https://simbad.cds.unistra.fr'];
export const SKYBOT_MIRRORS = ['https://ssp.imcce.fr/webservices/skybot/api/conesearch.php'];

/** Gaia rows kept per query; when capped, the brightest are kept. */
export const GAIA_MAX_ROWS = 500;

const AU_KM = 149597870.7;
const ARCSEC_PER_RAD = (180 / Math.PI) * 3600;

function checkCone(service: string, pos: SkyPos, radiusArcsec: number): void {
  if (!Number.isFinite(pos.ra) || !Number.isFinite(pos.dec) || Math.abs(pos.dec) > 90) {
    throw new Error(`${service}: invalid position`);
  }
  if (!(radiusArcsec > 0)) throw new Error(`${service}: search radius must be positive`);
}

function signed(v: number, digits: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

/**
 * Gaia DR3 stars within radiusArcsec of pos, brightest first (at most 500).
 * Positions are at epoch J2016.0; use propagateCatalog to move them to a frame's date.
 */
export async function gaiaCone(pos: SkyPos, radiusArcsec: number, signal?: AbortSignal): Promise<CatalogSource[]> {
  checkCone('Gaia DR3 (VizieR)', pos, radiusArcsec);
  const query =
    `-source=I/355/gaiadr3&-c=${encodeURIComponent(`${pos.ra.toFixed(6)} ${signed(pos.dec, 6)}`)}` +
    `&-c.rs=${radiusArcsec.toFixed(2)}&-out=Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag` +
    `&-out.max=${GAIA_MAX_ROWS}&-sort=Gmag`;
  const urls = VIZIER_MIRRORS.map((h) => `${h}/viz-bin/asu-tsv?${query}`);
  return tryMirrors('Gaia DR3 (VizieR)', urls, async (res) => parseGaiaTsv(await readText(res)), { signal });
}

/**
 * SIMBAD objects within radiusArcsec of pos (J2000.0 positions). The cone is applied to the
 * catalogue positions, so for a fast-moving star pass a generous radius: WISE 0855-0714 sits about
 * 2 arcmin from its J2000 position by 2025.
 */
export async function simbadCone(pos: SkyPos, radiusArcsec: number, signal?: AbortSignal): Promise<CatalogSource[]> {
  checkCone('SIMBAD', pos, radiusArcsec);
  const adql =
    'SELECT TOP 1000 main_id, ra, dec, pmra, pmdec, plx_value, otype, sp_type FROM basic ' +
    `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${pos.ra.toFixed(7)}, ${pos.dec.toFixed(7)}, ${(radiusArcsec / 3600).toFixed(7)})) = 1`;
  const q = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  const urls = SIMBAD_MIRRORS.map((h) => `${h}/simbad/sim-tap/sync?${q}`);
  return tryMirrors('SIMBAD', urls, async (res) => parseSimbadTapJson(await readText(res)), { signal });
}

/**
 * Known Solar System bodies predicted inside the cone at time mjd, as seen from the Earth's centre
 * (SkyBoT observer code 500). SPHEREx orbits about 700 km up, so nearby asteroids appear shifted by
 * several arcsec: correct with leoParallaxArcsec and the frame's X_SC/Y_SC/Z_SC header values.
 * Returns [] when nothing is there (SkyBoT answers 204 / empty).
 */
export async function skybotCone(pos: SkyPos, radiusArcsec: number, mjd: number, signal?: AbortSignal): Promise<SolarSystemObject[]> {
  checkCone('SkyBoT', pos, radiusArcsec);
  if (!Number.isFinite(mjd)) throw new Error('SkyBoT: invalid date');
  const jd = mjd + 2400000.5;
  const q =
    `-ep=${jd.toFixed(6)}&-ra=${pos.ra.toFixed(6)}&-dec=${pos.dec.toFixed(6)}&-rd=${(radiusArcsec / 3600).toFixed(6)}` +
    '&-mime=json&-output=all&-observer=500&-from=TrueBlink';
  const urls = SKYBOT_MIRRORS.map((u) => `${u}?${q}`);
  return tryMirrors('SkyBoT', urls, async (res) => parseSkybotJson(await readText(res), mjd), { signal });
}

/**
 * Parallax between the Earth's centre and the spacecraft for a body at distance deltaAu.
 * scPosKm is the spacecraft position relative to the Earth's centre (km, equatorial ICRF axes,
 * from the X_SC/Y_SC/Z_SC header keywords). Moving the observer by r makes the body appear to move
 * the other way by r/Delta radians; projecting onto the local east and north directions gives
 *   d(ra cos dec) = -(r . e_E) / Delta,   d(dec) = -(r . e_N) / Delta.
 * Returns [d(ra cos dec), d(dec)] in arcsec, to be added to a geocentric position.
 * About 9.7 arcsec for a body 1 au away seen from low Earth orbit; negligible for stars.
 */
export function leoParallaxArcsec(ra: number, dec: number, deltaAu: number, scPosKm: [number, number, number]): [number, number] {
  if (!(deltaAu > 0)) return [NaN, NaN];
  const a = (ra * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  const r = scPosKm.map((v) => v / AU_KM);
  const eE = [-Math.sin(a), Math.cos(a), 0];
  const eN = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const dotE = r[0] * eE[0] + r[1] * eE[1] + r[2] * eE[2];
  const dotN = r[0] * eN[0] + r[1] * eN[1] + r[2] * eN[2];
  return [(-dotE / deltaAu) * ARCSEC_PER_RAD, (-dotN / deltaAu) * ARCSEC_PER_RAD];
}

/**
 * Move catalogue positions from their own epoch to the date mjd with linear proper motion
 * (straight-line motion on the tangent plane). Annual parallax is ignored: below 1 arcsec for
 * every star except the very nearest, and well under a SPHEREx pixel (6.15 arcsec).
 * Sources without proper motion are returned unchanged apart from the epoch.
 */
export function propagateCatalog(sources: CatalogSource[], mjd: number): CatalogSource[] {
  const jy = mjdToJyear(mjd);
  return sources.map((s) => {
    const dt = jy - s.epoch;
    if (s.pmRa === undefined && s.pmDec === undefined) return { ...s };
    const [ra, dec] = tanDeproject(s.ra, s.dec, ((s.pmRa ?? 0) * dt) / 1000, ((s.pmDec ?? 0) * dt) / 1000);
    return { ...s, ra, dec, epoch: jy };
  });
}

/** Default marker colours, matching src/app/styles/tokens.css (--accent, --good, --warn, --muted). */
export const OVERLAY_COLORS = { gaia: '#7aa2ff', simbad: '#5fd38d', solarSystem: '#f2c14e', other: '#93a0b8' } as const;

export interface CatalogOverlayOptions {
  color?: string;
  /** Circle radius in arcsec (default 8, about 1.3 SPHEREx pixels). */
  sizeArcsec?: number;
  /** Draw text labels (default true). */
  labels?: boolean;
  /** Label only sources brighter than this magnitude (sources without a magnitude are always labelled). */
  labelMagLimit?: number;
  /** Draw a track from the catalogue position to the propagated one for proper motions above this (mas/yr, default 200). */
  trackMinPm?: number;
  /** Show only on this frame (default: all frames). */
  frameIndex?: number;
  idPrefix?: string;
}

/**
 * Circle markers (with labels) for catalogue sources, moved to the frame date mjd. Fast movers also
 * get a 'track' from their catalogue-epoch position, so the user sees where the star came from.
 * Each overlay's data is the propagated CatalogSource.
 */
export function overlaysFromCatalog(sources: CatalogSource[], mjd: number, opts: CatalogOverlayOptions = {}): Overlay[] {
  const out: Overlay[] = [];
  const moved = propagateCatalog(sources, mjd);
  const size = opts.sizeArcsec ?? 8;
  const trackMin = opts.trackMinPm ?? 200;
  moved.forEach((s, k) => {
    const orig = sources[k];
    const color =
      opts.color ??
      (/gaia/i.test(s.catalog) ? OVERLAY_COLORS.gaia : /simbad/i.test(s.catalog) ? OVERLAY_COLORS.simbad : OVERLAY_COLORS.other);
    const id = `${opts.idPrefix ?? s.catalog}:${s.id}`;
    const showLabel = (opts.labels ?? true) && (opts.labelMagLimit === undefined || s.mag === undefined || s.mag <= opts.labelMagLimit);
    out.push({
      id,
      kind: 'circle',
      ra: s.ra,
      dec: s.dec,
      sizeArcsec: size,
      color,
      text: showLabel ? (s.label ?? s.id) : undefined,
      frameIndex: opts.frameIndex,
      data: s,
    });
    const pm = Math.hypot(orig.pmRa ?? 0, orig.pmDec ?? 0);
    if (pm >= trackMin && (orig.ra !== s.ra || orig.dec !== s.dec)) {
      out.push({
        id: `${id}:track`,
        kind: 'track',
        ra: s.ra,
        dec: s.dec,
        path: [
          [orig.ra, orig.dec],
          [s.ra, s.dec],
        ],
        color,
        frameIndex: opts.frameIndex,
        data: s,
      });
    }
  });
  return out;
}

/**
 * Markers for SkyBoT predictions: a circle (radius = max(sizeArcsec, 3 x positional error)) and an
 * arrow showing one hour of apparent motion. Positions are used as given (geocentric unless the
 * caller has already applied leoParallaxArcsec).
 */
export function solarSystemOverlays(
  objects: SolarSystemObject[],
  opts: { color?: string; sizeArcsec?: number; frameIndex?: number; arrowHours?: number } = {},
): Overlay[] {
  const color = opts.color ?? OVERLAY_COLORS.solarSystem;
  const hours = opts.arrowHours ?? 1;
  const out: Overlay[] = [];
  for (const o of objects) {
    const id = `sso:${o.number ?? o.name}`;
    const vm = o.vMag !== undefined ? ` V${o.vMag.toFixed(1)}` : '';
    out.push({
      id,
      kind: 'circle',
      ra: o.ra,
      dec: o.dec,
      sizeArcsec: Math.max(opts.sizeArcsec ?? 10, 3 * (o.errArcsec ?? 0)),
      color,
      text: `${o.number !== undefined ? `(${o.number}) ` : ''}${o.name}${vm}`,
      frameIndex: opts.frameIndex,
      data: o,
    });
    if (o.dRa !== undefined && o.dDec !== undefined) {
      const [ra2, dec2] = tanDeproject(o.ra, o.dec, o.dRa * hours, o.dDec * hours);
      out.push({ id: `${id}:motion`, kind: 'arrow', ra: o.ra, dec: o.dec, path: [[o.ra, o.dec], [ra2, dec2]], color, frameIndex: opts.frameIndex, data: o });
    }
  }
  return out;
}
