// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// core/coords: read sky coordinates typed by a person, and write them back out.
//
// Right ascension (RA) is the sky's longitude. Astronomers usually write it in hours, minutes and
// seconds of time (24 h = 360 degrees, so 1 h = 15 deg), e.g. 08h55m10.83s = 133.795 deg.
// Declination (Dec) is the sky's latitude in degrees, arcminutes and arcseconds, e.g. -07d14m42.5s.
// Both can also be given as plain decimal degrees: "133.795 -7.245".

import type { SkyPos } from '../types';

interface Token {
  sign: '' | '+' | '-';
  value: number;
  /** Unit letter or separator that followed the number: h, d, m, s, ':' or ''. */
  unit: string;
  /** True when a comma separated this token from the previous one. */
  afterComma: boolean;
}

/** Normalise typographic symbols so the tokenizer sees plain ASCII. */
function normalise(text: string): string {
  return text
    .trim()
    .replace(/[−‒–—]/g, '-') // minus signs and dashes
    .replace(/[°º]/g, 'd') // degree sign
    .replace(/[′’']/g, 'm') // prime = arcminute
    .replace(/[″”"]|''/g, 's') // double prime = arcsecond
    .replace(/\s+/g, ' ');
}

function tokenize(s: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(,?)\s*([+-]?)\s*(\d+(?:\.\d*)?|\.\d+)\s*([hdms:]?)\s*/giy;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || m[0].length === 0) return null;
    tokens.push({ afterComma: m[1] === ',', sign: m[2] as Token['sign'], value: Number(m[3]), unit: m[4].toLowerCase() });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Combine 1-3 sexagesimal parts. Minutes and seconds must be < 60. */
function sexa(parts: Token[]): number | null {
  if (parts.length < 1 || parts.length > 3) return null;
  const [a, b, c] = parts.map((p) => p.value);
  if (parts.length >= 2 && (b >= 60 || !Number.isInteger(a))) return null;
  if (parts.length === 3 && (c >= 60 || !Number.isInteger(b))) return null;
  return a + (b ?? 0) / 60 + (c ?? 0) / 3600;
}

/** Compact designation such as "J085510.83-071442.5" (hhmmss.ss +ddmmss.s). */
function parseDesignation(s: string): SkyPos | null {
  const m = /^J?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([+-])(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/i.exec(s.replace(/\s+/g, ''));
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  const d = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;
  if (Number(m[2]) >= 60 || Number(m[3]) >= 60 || Number(m[6]) >= 60 || Number(m[7]) >= 60) return null;
  return check(h * 15, m[4] === '-' ? -d : d);
}

function check(ra: number, dec: number): SkyPos | null {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  if (ra < 0 || ra > 360 || dec < -90 || dec > 90) return null;
  return { ra: ra === 360 ? 0 : ra, dec };
}

/**
 * Parse "RA Dec" text. Accepted forms (commas optional):
 *   "133.795 -7.245", "133.795, -7.245", "133.795d -7.245d"
 *   "08h55m10.831s -07d14m42.53s", "08:55:10.83 -07:14:42.5", "08 55 10.83 -07 14 42.5"
 *   "J085510.83-071442.5"
 * The RA is read as hours when it carries an "h", uses colons, or has 2-3 parts; otherwise degrees.
 * Returns null when the text is not a valid position (so the caller can try a name lookup instead).
 */
export function parseCoordinates(text: string): SkyPos | null {
  if (typeof text !== 'string') return null;
  const s = normalise(text);
  if (!s) return null;
  const designation = parseDesignation(s);
  if (designation) return designation;
  const tokens = tokenize(s);
  if (!tokens || tokens.length < 2 || tokens.length > 6) return null;
  if (tokens[0].sign === '-') return null;

  // Where does the declination start? A comma, then an explicit sign, then the first "d" unit
  // ("... 07d14m"), then the token after a seconds unit ("...10.8s 07 14"), then an even split.
  let split = tokens.findIndex((t, k) => k > 0 && t.afterComma);
  if (split < 0) split = tokens.findIndex((t, k) => k > 0 && t.sign !== '');
  if (split < 0) split = tokens.findIndex((t, k) => k > 0 && t.unit === 'd');
  if (split < 0) split = tokens.findIndex((t, k) => k > 0 && tokens[k - 1].unit === 's');
  if (split < 0) {
    if (tokens.length % 2 !== 0) return null;
    split = tokens.length / 2;
  }
  const raT = tokens.slice(0, split);
  const decT = tokens.slice(split);
  if (raT.length > 3 || decT.length > 3 || decT.slice(1).some((t) => t.sign !== '') || raT.slice(1).some((t) => t.sign !== '')) return null;

  const raUnits = raT.map((t) => t.unit);
  const raInDegrees = raUnits.includes('d');
  const raInHours = !raInDegrees && (raUnits.includes('h') || raUnits.includes(':') || raT.length >= 2);
  const raVal = sexa(raT);
  const decAbs = sexa(decT);
  if (raVal === null || decAbs === null) return null;
  if (raInHours && raVal > 24) return null;
  const ra = raInHours ? raVal * 15 : raVal;
  return check(ra, decT[0].sign === '-' ? -decAbs : decAbs);
}

/** Split a non-negative value into (whole, minutes, seconds) with seconds rounded to `digits`. */
function splitSexa(value: number, digits: number): [number, number, string] {
  const scale = 10 ** digits;
  let total = Math.round(value * 3600 * scale); // in units of 1/scale seconds
  const secUnits = total % (60 * scale);
  total = (total - secUnits) / (60 * scale);
  const min = total % 60;
  const whole = (total - min) / 60;
  const sec = (secUnits / scale).toFixed(digits);
  return [whole, min, digits > 0 ? sec.padStart(digits + 3, '0') : sec.padStart(2, '0')];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** RA in hours, e.g. "08h55m10.83s" (default) or "08:55:10.83" with style ':'. */
export function formatRa(raDeg: number, opts: { digits?: number; style?: 'hms' | ':' | ' ' } = {}): string {
  if (!Number.isFinite(raDeg)) return '--';
  const digits = opts.digits ?? 2;
  const ra = ((raDeg % 360) + 360) % 360;
  let [h, m, sec] = splitSexa(ra / 15, digits);
  if (h >= 24) h -= 24;
  const style = opts.style ?? 'hms';
  if (style === 'hms') return `${pad2(h)}h${pad2(m)}m${sec}s`;
  return [pad2(h), pad2(m), sec].join(style);
}

/** Dec in degrees, e.g. "-07°14'42.5\"" (default) or "-07:14:42.5" with style ':'. */
export function formatDec(decDeg: number, opts: { digits?: number; style?: 'dms' | ':' | ' ' } = {}): string {
  if (!Number.isFinite(decDeg)) return '--';
  const digits = opts.digits ?? 1;
  const sign = decDeg < 0 ? '-' : '+';
  const [d, m, sec] = splitSexa(Math.abs(decDeg), digits);
  const style = opts.style ?? 'dms';
  if (style === 'dms') return `${sign}${pad2(d)}°${pad2(m)}'${sec}"`;
  return `${sign}${[pad2(d), pad2(m), sec].join(style)}`;
}

/** Decimal degrees with fixed digits, e.g. formatDeg(133.7951294) = "133.79513". */
export function formatDeg(deg: number, digits = 5): string {
  return Number.isFinite(deg) ? deg.toFixed(digits) : '--';
}

/** "133.79513 -7.24515" (decimal) or "08h55m10.83s -07°14'42.5\"" (sexagesimal). */
export function formatPos(pos: SkyPos, style: 'deg' | 'sexagesimal' = 'deg', digits?: number): string {
  if (style === 'deg') return `${formatDeg(pos.ra, digits)} ${pos.dec >= 0 ? '+' : ''}${formatDeg(pos.dec, digits)}`;
  return `${formatRa(pos.ra)} ${formatDec(pos.dec)}`;
}

/** Angle in arcseconds as a short human string: "0.8\"", "12.3\"", "2.1'", "1.25°". */
export function formatAngleArcsec(arcsec: number): string {
  if (!Number.isFinite(arcsec)) return '--';
  const a = Math.abs(arcsec);
  if (a < 60) return `${arcsec.toFixed(a < 10 ? 2 : 1)}"`;
  if (a < 3600) return `${(arcsec / 60).toFixed(2)}'`;
  return `${(arcsec / 3600).toFixed(2)}°`;
}
