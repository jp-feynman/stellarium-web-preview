// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Shared data contracts. Every module in src/core, src/gl and src/app speaks these types.
//
// CONVENTIONS (do not deviate):
//  - Sky positions are ICRS, decimal degrees.
//  - Times are MJD in UTC. A frame's epoch is the mid-exposure time (FITS MJD-AVG).
//    Julian year = 2000 + (MJD - 51544.5) / 365.25.
//  - Detector pixels are 0-based, pixel centres at integers, x = column, y = row. FITS pixel = value + 1.
//    A full SPHEREx Level-2 frame is 2040 x 2040 pixels, about 6.15 arcsec per pixel.
//  - Surface brightness is MJy/sr. Flux density: F[uJy] = 23.5044 * Omega[arcsec^2] * S[MJy/sr].
//  - Wavelengths and bandwidths are microns.
//  - A SkyGrid is a north-up, east-left tangent-plane (TAN) image: column i = 0 is the EAST edge,
//    row j = 0 is the SOUTH edge, data index = j * n + i. (So drawn with row 0 at the bottom and
//    column 0 at the left, north is up and east is left, as on the sky.)
//  - NaN in a Float32Array always means "no valid data here". Never zero-fill.

export interface SkyPos {
  ra: number;
  dec: number;
}

export type DetectorId = 1 | 2 | 3 | 4 | 5 | 6;

/** One Level-2 file: one detector's frame of one exposure, as listed by the archive. */
export interface Exposure {
  /** Unique id: `${obsId}D${detector}`. */
  id: string;
  /** Observation id, e.g. "2025W19_1B_0116_1". Dichroic partners share it (detectors 1/4, 2/5, 3/6). */
  obsId: string;
  detector: DetectorId;
  /** SIA collection, e.g. "spherex_dr1", "spherex_qr3", "spherex_dr1_deep". */
  collection: string;
  /** Release folder taken from the file path: "dr1", "qr3", ... */
  release: string;
  /** Exposure start / end (SIA t_min / t_max), MJD UTC. */
  mjdStart: number;
  mjdEnd: number;
  /** Mid-exposure MJD (mean of start and end until the header's MJD-AVG is known). */
  mjd: number;
  /** IRSA URL of the full file (no CORS: never fetched from a browser). */
  url: string;
  /** Key in the public S3 bucket nasa-irsa-spherex, e.g. "dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_...fits". */
  s3Key: string;
  /** Frame centre from SIA (s_ra, s_dec). */
  sRa: number;
  sDec: number;
  /** Footprint corners [ra0, dec0, ra1, dec1, ra2, dec2, ra3, dec3] in pixel-corner order
   *  (-0.5,-0.5), (2039.5,-0.5), (2039.5,2039.5), (-0.5,2039.5). */
  sRegion: number[];
  /** Detector band limits in microns (SIA em_min / em_max). NOT the wavelength at the target. */
  emMin: number;
  emMax: number;
  /** Processing tag folder, e.g. "l2b-v27-2026-197" (do not hard-code; "l2b_retry-v27-..." also exists). */
  pipelineTag: string;
}

/** Order-3 SIP polynomial: coeff[p][q] multiplies u^p * v^q. */
export type SipPoly = number[][];

/** TAN + SIP celestial WCS of a full Level-2 frame (0-based pixel convention handled inside core/wcs). */
export interface TanSipWcs {
  /** CRVAL1, CRVAL2 (deg). */
  crval: [number, number];
  /** CRPIX1, CRPIX2 as written in the FITS header (1-based). */
  crpix: [number, number];
  /** 2x2 matrix in deg/pixel: [[cd11, cd12], [cd21, cd22]] (PC * CDELT already multiplied). */
  cd: [[number, number], [number, number]];
  a?: SipPoly;
  b?: SipPoly;
  ap?: SipPoly;
  bp?: SipPoly;
  aOrder?: number;
  bOrder?: number;
  naxis: [number, number];
}

/** Byte layout of one Level-2 file, discovered by parsing headers (never hard-coded). */
export interface L2Layout {
  url: string;
  imageDataOffset: number;
  /** FLAGS: 'rice' (DR1/QR3 tile-compressed table) or 'plain' (older int32 image). */
  flagsFormat?: 'rice' | 'plain';
  flagsHeaderOffset: number;
  flagsDataOffset?: number;
  /** For 'rice': per-row [byteLength, heapOffset] table (2040 rows) and absolute heap start. */
  flagsRowTable?: Int32Array;
  flagsHeapOffset?: number;
  varianceDataOffset?: number;
  zodiDataOffset?: number;
}

/** What we keep from the PRIMARY + IMAGE headers of one file. */
export interface FrameHeader {
  wcs: TanSipWcs;
  detector: DetectorId;
  obsId: string;
  /** Mid-exposure (MJD-AVG), start (MJD-BEG / MJD-OBS) and end (MJD-END), UTC. */
  mjdAvg: number;
  mjdBeg: number;
  mjdEnd: number;
  /** XPOSURE seconds (113.58). */
  exptime: number;
  /** Pipeline software version from the PRIMARY header (e.g. "7.0.5"). */
  version?: string;
  /** SPS_EPA: position angle of the focal plane (0 or 180 deg). */
  epa?: number;
  /** Geocentric spacecraft position at mid-exposure in km (X_SC, Y_SC, Z_SC; inertial, ICRF-like axes). */
  scPosKm?: [number, number, number];
  psfFwhmArcsec?: number;
  omegaMedianArcsec2?: number;
  /** Flag plane names by bit number, read from MSKNnnnn cards of the FLAGS header when available. */
  flagNames?: Record<number, string>;
  /** All IMAGE header cards (value only). */
  cards: Record<string, string | number | boolean>;
  layout: L2Layout;
}

/** A window of native detector pixels around a sky position, with everything needed to use it. */
export interface NativeCutout {
  exposure: Exposure;
  header: FrameHeader;
  /** Window origin (0-based full-frame pixel of element [0]) and size. */
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** IMAGE plane, MJy/sr, row-major (index = (y - y0) * nx + (x - x0)); NaN = invalid. NOT background-subtracted. */
  image: Float32Array;
  /** ZODI model plane (MJy/sr), VARIANCE ((MJy/sr)^2), FLAGS (int32 bit mask): present when requested. */
  zodi?: Float32Array;
  variance?: Float32Array;
  flags?: Int32Array;
  /** Full-frame pixel coordinates (0-based, fractional) of the requested sky position. */
  targetPix: [number, number];
  /** Wavelength and bandwidth (microns) at the target pixel from the WCS-WAVE lookup. */
  wavelength: number;
  bandwidth: number;
  /** Spectral channel within the detector, 1..17 (0 or 18 = off-nominal corner). */
  channel: number;
  /** All-sky cube channel 1..102 = 17 * (detector - 1) + channel (0 when off-nominal). */
  cubeChannel: number;
  /** Pixel solid angle at the target in arcsec^2 (from the WCS Jacobian). */
  omegaArcsec2: number;
}

/** North-up, east-left TAN grid. See conventions at the top of this file. */
export interface SkyGrid {
  ra0: number;
  dec0: number;
  /** Pixels per side. */
  n: number;
  /** Arcsec per pixel. */
  scaleArcsec: number;
}

export type FrameKind = 'exposure' | 'stack' | 'difference' | 'external';

export interface FrameMeta {
  kind: FrameKind;
  /** Short label for the UI, e.g. "2025-11-07 · D5+D6 · 3.8-5.0 um · 37 exp". */
  label: string;
  /** Representative epoch and time span (MJD UTC). */
  mjd: number;
  mjdMin: number;
  mjdMax: number;
  /** Effective wavelength and span (microns). */
  wavelength: number;
  waveMin: number;
  waveMax: number;
  detectors: number[];
  nExposures: number;
  exposureIds: string[];
  /** Visit index this frame belongs to (see Visit), when applicable. */
  visit?: number;
  /** Cube channels (1..102) that contributed, for like-with-like bookkeeping. */
  cubeChannels?: number[];
  /** Plain-language warnings, e.g. "saturated core", "only 4 exposures", "wavelength mix differs". */
  notes?: string[];
  /** For external frames: survey name, e.g. "2MASS Ks (1998)". */
  source?: string;
}

/** An image on a SkyGrid, ready to display or stack. Background already removed unless stated in meta.notes. */
export interface SkyFrame {
  grid: SkyGrid;
  /** n*n surface brightness in MJy/sr (or arbitrary units for external frames); NaN = no data. */
  data: Float32Array;
  /** Optional 0..1 coverage / weight per pixel. */
  weight?: Float32Array;
  meta: FrameMeta;
}

/** A group of exposures taken close together in time (one pass of the survey over this position). */
export interface Visit {
  index: number;
  mjdMin: number;
  mjdMax: number;
  mjdMid: number;
  exposureIds: string[];
  /** ISO date of mjdMid, e.g. "2025-11-07". */
  label: string;
}

/** A named target with astrometry, used for presets, search results and epoch propagation. */
export interface TargetInfo {
  id: string;
  name: string;
  /** Catalogue position at `epoch` (Julian year, usually 2000.0 for SIMBAD or 2016.0 for Gaia DR3). */
  ra: number;
  dec: number;
  epoch: number;
  /** Proper motion in mas/yr: pmRa already includes cos(dec). */
  pmRa?: number;
  pmDec?: number;
  /** Parallax in mas. */
  parallax?: number;
  /** Free-form object type / spectral type from the resolver. */
  objectType?: string;
  spectralType?: string;
  /** Magnitudes when known (Vega unless noted): keys like "J", "H", "K", "W1", "W2", "G". */
  mags?: Record<string, number>;
  aliases?: string[];
}

/** A catalogue source to overlay (Gaia, 2MASS, AllWISE, SIMBAD...). */
export interface CatalogSource {
  catalog: string;
  id: string;
  ra: number;
  dec: number;
  /** Epoch of ra/dec as a Julian year. */
  epoch: number;
  pmRa?: number;
  pmDec?: number;
  parallax?: number;
  mag?: number;
  magBand?: string;
  label?: string;
}

/** A known Solar System object predicted inside a field at some time. */
export interface SolarSystemObject {
  name: string;
  number?: number;
  /** Predicted position for the observer and time used in the query. */
  ra: number;
  dec: number;
  mjd: number;
  /** Class, e.g. "MB>Inner", "NEA>Apollo". */
  objectClass?: string;
  vMag?: number;
  /** Apparent motion in arcsec/hour (east and north components). */
  dRa?: number;
  dDec?: number;
  /** Geocentric / heliocentric distances in au, phase angle in deg, when the service returns them. */
  deltaAu?: number;
  rAu?: number;
  phaseDeg?: number;
  /** Positional uncertainty in arcsec, when given. */
  errArcsec?: number;
}

/** One photometric measurement of a source in one exposure. */
export interface PhotPoint {
  exposureId: string;
  obsId: string;
  detector: number;
  mjd: number;
  wavelength: number;
  bandwidth: number;
  cubeChannel: number;
  /** Flux density and 1-sigma error in mJy. */
  flux: number;
  fluxErr: number;
  /** Method used. */
  method: 'aperture' | 'epsf';
  /** OR of FLAGS bits inside the measurement footprint, and convenience booleans. */
  flags: number;
  saturated: boolean;
  /** True when the point should be kept for science plots by default. */
  good: boolean;
  /** Measured centroid on the sky (when computed) for motion work. */
  ra?: number;
  dec?: number;
  /** Signal-to-noise of the detection. */
  snr: number;
  visit?: number;
}

/** A marker to draw over the blink view. Positions are sky coordinates; the stage projects them. */
export interface Overlay {
  id: string;
  kind: 'circle' | 'cross' | 'box' | 'label' | 'track' | 'arrow';
  ra: number;
  dec: number;
  /** Radius / half-size in arcsec for circle, cross, box. */
  sizeArcsec?: number;
  /** For 'track' and 'arrow': polyline of sky positions [ra, dec][]. */
  path?: [number, number][];
  color?: string;
  text?: string;
  /** Show only on the frame with this index (undefined = all frames). */
  frameIndex?: number;
  /** Interaction payload returned by onPick. */
  data?: unknown;
}

/** Display stretch shared by every frame of a sequence (never per-frame auto-scaling). */
export interface Stretch {
  lo: number;
  hi: number;
  mode: 'asinh' | 'linear' | 'sqrt' | 'log';
  /** Softening for asinh (larger = harder stretch). */
  q: number;
  invert: boolean;
  colormap: 'gray' | 'heat' | 'viridis' | 'diverging';
}

/** Named sets of detectors used to build band stacks. */
export interface BandGroup {
  id: string;
  label: string;
  detectors: number[];
  /** Optional wavelength window in microns that further restricts exposures. */
  waveMin?: number;
  waveMax?: number;
}

export const DETECTOR_BANDS: Record<number, { min: number; max: number; R: number }> = {
  1: { min: 0.744, max: 1.116, R: 39 },
  2: { min: 1.099, max: 1.651, R: 41 },
  3: { min: 1.636, max: 2.421, R: 41 },
  4: { min: 2.423, max: 3.822, R: 35 },
  5: { min: 3.809, max: 4.42, R: 112 },
  6: { min: 4.412, max: 5.002, R: 128 },
};

export const BAND_GROUPS: BandGroup[] = [
  { id: 'all', label: 'All six arrays (0.75-5.0 um)', detectors: [1, 2, 3, 4, 5, 6] },
  { id: 'swir', label: 'Short-wave arrays 1-3 (0.75-2.4 um)', detectors: [1, 2, 3] },
  { id: 'mwir', label: 'Mid-wave arrays 4-6 (2.4-5.0 um)', detectors: [4, 5, 6] },
  { id: 'd1', label: 'Array 1 (0.75-1.1 um)', detectors: [1] },
  { id: 'd2', label: 'Array 2 (1.1-1.65 um)', detectors: [2] },
  { id: 'd3', label: 'Array 3 (1.64-2.42 um)', detectors: [3] },
  { id: 'd4', label: 'Array 4 (2.42-3.82 um)', detectors: [4] },
  { id: 'd5', label: 'Array 5 (3.81-4.42 um)', detectors: [5] },
  { id: 'd6', label: 'Array 6 (4.41-5.0 um)', detectors: [6] },
  { id: 'cold', label: 'Cold objects: arrays 5+6 (3.8-5.0 um)', detectors: [5, 6] },
];

/** FLAGS bit numbers of pipeline 7.x (DR1 / QR3). Prefer the names read from MSKNnnnn cards when present. */
export const FLAG_BITS: Record<string, number> = {
  TRANSIENT: 0,
  OVERFLOW: 1,
  SUR_ERROR: 2,
  NONFUNC: 6,
  DICHROIC: 7,
  MISSING_DATA: 9,
  HOT: 10,
  COLD: 11,
  FULLSAMPLE: 12,
  PHANMISS: 14,
  NONLINEAR: 15,
  PERSIST: 17,
  OUTLIER: 19,
  CROSSTALK: 20,
  SOURCE: 21,
  GHOST: 22,
  GHOST_FPA: 23,
  GHOST_EXT: 24,
  STREAK: 25,
  BLOOM: 26,
  SNOWBALL: 27,
  HALO: 28,
  SATELLITE_HALO: 29,
};

/** Official mask sets from the SPHEREx Explanatory Supplement v2.1 (pp. 44-46). SOURCE and OUTLIER are never "bad". */
export const FLAG_MASKS = {
  /** Pixels excluded from the project's own forced photometry fits. */
  photometry: 0x3c028e44,
  /** Pixels excluded when estimating the background. */
  background: 0x3c2a8e47,
  /** Pixels set to NaN by the official mosaic tool; our default for display stacks. */
  mosaic: 0x3fd2cec5,
  /** Saturation-related bits. */
  saturation: (1 << 1) | (1 << 26),
} as const;

/** Convert MJD (UTC) to a Julian year. */
export function mjdToJyear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

/** ISO date (YYYY-MM-DD) of an MJD. */
export function mjdToIsoDate(mjd: number): string {
  return new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);
}

/** Micro-Jansky per (MJy/sr) for a pixel of solid angle omega (arcsec^2). */
export const UJY_PER_MJYSR_ARCSEC2 = 23.5044;
