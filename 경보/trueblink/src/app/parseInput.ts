// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Decide whether the search box holds coordinates or a name. A small local parser so the shell works
// on its own; integration may swap in core/coords parseCoordinates (same result shape).
import type { SkyPos } from '../core/types';

/**
 * Accepts decimal degrees ("269.446 +4.767", "269.446, 4.767") and sexagesimal
 * ("17:57:48.5 +04:41:36", "17 57 48.5 +04 41 36", "08h55m10.83s -07d14m42.5s").
 * Sexagesimal right ascension is in hours; decimal right ascension is in degrees.
 */
export function parseCoordinatesLoose(text: string): SkyPos | null {
  const s = text.trim().replace(/[,;]/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  // Decimal degrees.
  const dm = s.match(/^([+]?\d+(?:\.\d*)?)\s*(?:d|°)?\s+([+-]?\d+(?:\.\d*)?)\s*(?:d|°)?$/i);
  if (dm) {
    const ra = Number(dm[1]);
    const dec = Number(dm[2]);
    if (ra >= 0 && ra < 360 && dec >= -90 && dec <= 90) return { ra, dec };
    return null;
  }
  // Sexagesimal: normalise h/m/s/d/'/" separators to spaces, keep the declination sign.
  const t = s
    .replace(/[hHdD°:'′"″mMsS]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sm = t.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}(?:\.\d*)?) ([+-]?)(\d{1,2}) (\d{1,2}) (\d{1,2}(?:\.\d*)?)$/);
  if (sm) {
    const h = Number(sm[1]) + Number(sm[2]) / 60 + Number(sm[3]) / 3600;
    const sign = sm[4] === '-' ? -1 : 1;
    const d = Number(sm[5]) + Number(sm[6]) / 60 + Number(sm[7]) / 3600;
    const ra = h * 15;
    const dec = sign * d;
    if (h < 24 && Number(sm[2]) < 60 && Number(sm[6]) < 60 && d <= 90) return { ra, dec };
  }
  return null;
}

export function formatRaDeg(ra: number): string {
  return ra.toFixed(4);
}

export function formatDecDeg(dec: number): string {
  return `${dec >= 0 ? '+' : ''}${dec.toFixed(4)}`;
}
