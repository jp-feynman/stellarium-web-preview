// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The Sun as a light source for asteroids. An asteroid shines in the near-infrared mostly by reflecting
// sunlight, so its spectrum has the shape of the solar spectrum multiplied by its reflectance. To recover
// the reflectance we divide by a real solar spectrum. A 5772 K blackbody is not good enough: it is 19-23 %
// too bright at 4.4-5 um (solar CO absorption) and 7 % too faint at 0.55 um.
//
// public/data/solar_spectrum.json is the CALSPEC solar model sun_mod_001 (Kurucz, normalised to observed
// irradiance) averaged over the SPHEREx channel width (R = 40 below 3.8 um, 112 in band 5, 130 in band 6)
// on a 0.01 um grid from 0.50 to 5.20 um, as flux density at 1 au in mJy.

import sunJson from '../../../public/data/solar_spectrum.json';

interface SolarTable {
  wavelength_um: number[];
  flux_mJy: number[];
}

const SUN = sunJson as unknown as SolarTable;
const LOG_W = SUN.wavelength_um.map(Math.log);
const LOG_F = SUN.flux_mJy.map(Math.log);

/** Shortest and longest wavelength (micron) covered by the solar table. */
export const SOLAR_TABLE_RANGE_UM: readonly [number, number] = [
  SUN.wavelength_um[0],
  SUN.wavelength_um[SUN.wavelength_um.length - 1],
];

/**
 * Solar flux density in mJy at wavelength `wavelengthUm` (micron) seen from `rAu` au (default 1 au).
 * Log-log interpolation in the tabulated spectrum; NaN outside 0.50-5.20 um (no data, never extrapolated).
 */
export function solarFluxMjy(wavelengthUm: number, rAu = 1): number {
  if (!Number.isFinite(wavelengthUm) || !(rAu > 0)) return NaN;
  const w = SUN.wavelength_um;
  const n = w.length;
  if (wavelengthUm < w[0] - 1e-9 || wavelengthUm > w[n - 1] + 1e-9) return NaN;
  // The grid is uniform (0.01 um), so locate the interval directly and then fix rounding at the ends.
  let i = Math.floor((wavelengthUm - w[0]) / (w[1] - w[0]));
  i = Math.min(Math.max(i, 0), n - 2);
  const lw = Math.log(Math.min(Math.max(wavelengthUm, w[0]), w[n - 1]));
  const t = (lw - LOG_W[i]) / (LOG_W[i + 1] - LOG_W[i]);
  return Math.exp(LOG_F[i] + t * (LOG_F[i + 1] - LOG_F[i])) / (rAu * rAu);
}
