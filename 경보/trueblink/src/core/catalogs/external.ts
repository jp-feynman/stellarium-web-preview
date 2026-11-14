// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Images of the same patch from older surveys (AllWISE, 2MASS, DSS2), put on exactly the SkyGrid of
// our SPHEREx frames, so a user can blink "then" against "now": a star that moved since 1990 or 2010
// shows up as a jump. Route 1 is the CDS hips2fits cutout service; when it is down we read the
// survey's HiPS tiles (512 x 512 HEALPix image tiles) straight from a mirror and resample them here.

import type { SkyFrame, SkyGrid } from '../types';
import { gridPixToSky, skyToPix, wcsFromCards } from '../wcs';
import { parseFitsImage, sampleBilinear, type FitsImage } from './fitsimage';
import { hipsLocate, hipsPixelArcsec, hipsTilePath, TILE_WIDTH } from './hips';
import { fetchWithTimeout, isAbortError, hostOf } from './net';

export type ExternalSurvey = 'allwise-w1' | 'allwise-w2' | '2mass-j' | '2mass-h' | '2mass-k' | 'dss2-red';

interface SurveyInfo {
  hips: string;
  source: string;
  wavelength: number;
  waveMin: number;
  waveMax: number;
  /** Nominal epoch (Julian year) and the span over which the survey observed (MJD). */
  epochJy: number;
  mjdMin: number;
  mjdMax: number;
  maxOrder: number;
  /** HiPS directories holding FITS tiles, in order of preference. */
  tileBases: string[];
}

const IRSA_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/CDS';
const ALASKY = 'https://alasky.cds.unistra.fr';

/** hips2fits hosts in order of preference (the main host also sends CORS when it is up). */
export const HIPS2FITS_HOSTS = ['https://alasky.cds.unistra.fr', 'https://alaskybis.cds.unistra.fr'];

export const EXTERNAL_SURVEYS: Record<ExternalSurvey, SurveyInfo> = {
  'allwise-w1': {
    hips: 'CDS/P/allWISE/W1', source: 'AllWISE W1 (2010)', wavelength: 3.4, waveMin: 2.8, waveMax: 3.9,
    epochJy: 2010.5, mjdMin: 55203, mjdMax: 55593, maxOrder: 8,
    tileBases: [`${IRSA_HIPS}/AllWISE/W1`, `${ALASKY}/AllWISE/W1`],
  },
  'allwise-w2': {
    hips: 'CDS/P/allWISE/W2', source: 'AllWISE W2 (2010)', wavelength: 4.6, waveMin: 4.0, waveMax: 5.2,
    epochJy: 2010.5, mjdMin: 55203, mjdMax: 55593, maxOrder: 8,
    tileBases: [`${IRSA_HIPS}/AllWISE/W2`, `${ALASKY}/AllWISE/W2`],
  },
  // IRSA mirrors 2MASS as JPEG tiles only, which carry no linear pixel values, so only CDS serves it.
  '2mass-j': {
    hips: 'CDS/P/2MASS/J', source: '2MASS J (about 1999)', wavelength: 1.235, waveMin: 1.08, waveMax: 1.41,
    epochJy: 1999.5, mjdMin: 50606, mjdMax: 51955, maxOrder: 9, tileBases: [`${ALASKY}/2MASS/J`],
  },
  '2mass-h': {
    hips: 'CDS/P/2MASS/H', source: '2MASS H (about 1999)', wavelength: 1.662, waveMin: 1.48, waveMax: 1.82,
    epochJy: 1999.5, mjdMin: 50606, mjdMax: 51955, maxOrder: 9, tileBases: [`${ALASKY}/2MASS/H`],
  },
  '2mass-k': {
    hips: 'CDS/P/2MASS/K', source: '2MASS Ks (about 1999)', wavelength: 2.159, waveMin: 1.95, waveMax: 2.36,
    epochJy: 1999.5, mjdMin: 50606, mjdMax: 51955, maxOrder: 9, tileBases: [`${ALASKY}/2MASS/K`],
  },
  'dss2-red': {
    hips: 'CDS/P/DSS2/red', source: 'DSS2 red (about 1990)', wavelength: 0.65, waveMin: 0.59, waveMax: 0.715,
    epochJy: 1990.0, mjdMin: 45700, mjdMax: 51179, maxOrder: 9, tileBases: [`${IRSA_HIPS}/DSS2/red`],
  },
};

function jyToMjd(jy: number): number {
  return 51544.5 + (jy - 2000) * 365.25;
}

async function readFits(res: Response): Promise<FitsImage> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return parseFitsImage(buf);
}

/** Route 1: hips2fits returns a TAN image already near our grid; resample through its own WCS. */
async function viaHips2fits(s: SurveyInfo, grid: SkyGrid, host: string, signal?: AbortSignal, timeoutMs?: number): Promise<Float32Array> {
  const fov = (grid.n * grid.scaleArcsec) / 3600;
  const q = new URLSearchParams({
    hips: s.hips,
    width: String(grid.n),
    height: String(grid.n),
    fov: fov.toFixed(8),
    projection: 'TAN',
    coordsys: 'icrs',
    ra: grid.ra0.toFixed(8),
    dec: grid.dec0.toFixed(8),
    format: 'fits',
  });
  const img = await fetchWithTimeout(`${host}/hips-image-services/hips2fits?${q}`, readFits, { signal, timeoutMs });
  // Whatever the returned axis directions (CDELT1 is normally negative = east to the left), going through
  // the image's own WCS puts every value on the right SkyGrid pixel; no manual flip is needed.
  const wcs = wcsFromCards({ ...img.cards, NAXIS1: img.nx, NAXIS2: img.ny });
  const out = new Float32Array(grid.n * grid.n);
  for (let j = 0; j < grid.n; j++) {
    for (let i = 0; i < grid.n; i++) {
      const [ra, dec] = gridPixToSky(grid, i, j);
      const [x, y] = skyToPix(wcs, ra, dec);
      out[j * grid.n + i] = sampleBilinear(img, x, y);
    }
  }
  return out;
}

/** Choose the HiPS order whose pixels are just finer than the grid's. */
function chooseOrder(scaleArcsec: number, maxOrder: number): number {
  for (let k = 3; k <= maxOrder; k++) if (hipsPixelArcsec(k) <= scaleArcsec) return k;
  return maxOrder;
}

const MAX_TILES = 24;

/** Route 2: read HiPS FITS tiles and average the HEALPix pixels that fall inside each grid pixel. */
async function viaTiles(s: SurveyInfo, grid: SkyGrid, base: string, signal?: AbortSignal, timeoutMs?: number): Promise<Float32Array> {
  const order = chooseOrder(grid.scaleArcsec, s.maxOrder);
  const ss = Math.max(1, Math.min(4, Math.round(grid.scaleArcsec / hipsPixelArcsec(order))));
  const n = grid.n;
  const nSamp = n * n * ss * ss;
  const tileOf = new Float64Array(nSamp);
  const pixOf = new Int32Array(nSamp);
  const tiles = new Set<number>();
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      for (let b = 0; b < ss; b++) {
        for (let a = 0; a < ss; a++) {
          const [ra, dec] = gridPixToSky(grid, i + (a + 0.5) / ss - 0.5, j + (b + 0.5) / ss - 0.5);
          const loc = hipsLocate(order, ra, dec);
          tileOf[k] = loc.tile;
          pixOf[k] = loc.y * TILE_WIDTH + loc.x;
          tiles.add(loc.tile);
          k++;
        }
      }
    }
  }
  if (tiles.size > MAX_TILES) throw new Error(`field needs ${tiles.size} tiles (limit ${MAX_TILES})`);
  const loaded = new Map<number, Float32Array | null>();
  const reasons: string[] = [];
  await Promise.all(
    [...tiles].map(async (t) => {
      try {
        const img = await fetchWithTimeout(`${base}/${hipsTilePath(order, t)}`, readFits, { signal, timeoutMs });
        if (img.nx !== TILE_WIDTH || img.ny !== TILE_WIDTH) throw new Error(`tile is ${img.nx}x${img.ny}`);
        loaded.set(t, img.data);
      } catch (e) {
        if (isAbortError(e)) throw e;
        reasons.push(e instanceof Error ? e.message : String(e));
        loaded.set(t, null); // a missing tile leaves NaN (no data), never zeros
      }
    }),
  );
  if (![...loaded.values()].some((d) => d !== null)) throw new Error(`no tile could be read (${reasons[0] ?? 'unknown'})`);
  const out = new Float32Array(n * n);
  const per = ss * ss;
  for (let p = 0; p < n * n; p++) {
    let sum = 0;
    let cnt = 0;
    for (let q = p * per; q < (p + 1) * per; q++) {
      const d = loaded.get(tileOf[q]);
      if (!d) continue;
      const v = d[pixOf[q]];
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    out[p] = cnt > 0 ? sum / cnt : NaN;
  }
  return out;
}

function median(data: Float32Array): number {
  const v = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

/**
 * An older survey's image of the grid's patch, on exactly that grid (north up, east left), with the
 * median background subtracted. Pixel units are the survey's own (not MJy/sr).
 * Tries hips2fits on the main CDS host, then HiPS tiles from the mirrors, then the backup hips2fits host.
 */
export async function externalFrame(survey: ExternalSurvey, grid: SkyGrid, signal?: AbortSignal): Promise<SkyFrame> {
  const s = EXTERNAL_SURVEYS[survey];
  if (!s) throw new Error(`External image: unknown survey "${survey}"`);
  const routes: { name: string; run: () => Promise<Float32Array> }[] = [
    { name: `hips2fits at ${hostOf(HIPS2FITS_HOSTS[0])}`, run: () => viaHips2fits(s, grid, HIPS2FITS_HOSTS[0], signal) },
    ...s.tileBases.map((b) => ({ name: `HiPS tiles at ${hostOf(b)}`, run: () => viaTiles(s, grid, b, signal) })),
    ...HIPS2FITS_HOSTS.slice(1).map((h) => ({ name: `hips2fits at ${hostOf(h)}`, run: () => viaHips2fits(s, grid, h, signal) })),
  ];
  const reasons: string[] = [];
  let data: Float32Array | null = null;
  let used = '';
  for (const r of routes) {
    try {
      data = await r.run();
      used = r.name;
      break;
    } catch (e) {
      if (isAbortError(e)) throw e;
      reasons.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!data) throw new Error(`External image ${s.source} is unavailable (${reasons.join('; ')})`);
  const bg = median(data);
  if (Number.isFinite(bg)) for (let p = 0; p < data.length; p++) data[p] -= bg;
  const mjd = jyToMjd(s.epochJy);
  return {
    grid: { ...grid },
    data,
    meta: {
      kind: 'external',
      label: `${s.source} · ${s.wavelength} um`,
      mjd,
      mjdMin: s.mjdMin,
      mjdMax: s.mjdMax,
      wavelength: s.wavelength,
      waveMin: s.waveMin,
      waveMax: s.waveMax,
      detectors: [],
      nExposures: 0,
      exposureIds: [],
      source: s.source,
      notes: [
        `Nominal epoch ${s.epochJy.toFixed(1)}; the true observation date varies across the sky (survey span ${new Date((s.mjdMin - 40587) * 86400000).getUTCFullYear()}-${new Date((s.mjdMax - 40587) * 86400000).getUTCFullYear()}).`,
        'Pixel values are survey units, not MJy/sr; median background subtracted.',
        `Image from ${s.hips} via ${used}.`,
      ],
    },
  };
}
