// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// core/resolve: turn an object name into a position, and move that position to another date.
//
// Names go to CDS Sesame, which asks SIMBAD (then NED and VizieR) and answers in XML with the J2000
// position, proper motion and parallax. Sesame and its mirrors send CORS headers, so the browser can
// call them directly. SIMBAD's TAP service is the last fallback.
//
// Nearby stars and brown dwarfs move across the sky ("proper motion"). Catalogue positions refer to
// one epoch (J2000.0 here), so before centring a SPHEREx cutout we move the object to the date of the
// exposure: WISE 0855-0714 travels 8.1 arcsec per year, more than one SPHEREx pixel (6.15 arcsec).

import { findPreset } from '../archive/presets';
import { fetchText, type FetchLike } from '../archive/net';
import { mjdToJyear, type SkyPos, type TargetInfo } from '../types';
import { tanDeproject } from '../wcs';

export const SESAME_URLS = [
  'https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?',
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?',
];
export const SIMBAD_TAP_URL = 'https://simbad.harvard.edu/simbad/sim-tap/sync';

export interface ResolveOptions {
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 12 s). */
  timeoutMs?: number;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** SIMBAD prefixes names with catalogue markers ("NAME ", "V* ", "* "); drop them for display. */
function cleanName(oname: string): string {
  return oname.replace(/^(NAME|V\*|\*\*|\*)\s+/, '').trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decodeXml(m[1].trim()) : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Parse a Sesame XML answer (-oxp output). Returns null when Sesame found nothing.
 * Exported for tests.
 */
export function parseSesameXml(xml: string, query: string): TargetInfo | null {
  const resolver = /<Resolver\b[^>]*>([\s\S]*?)<\/Resolver>/i.exec(xml)?.[1];
  if (!resolver) return null;
  const ra = num(tag(resolver, 'jradeg'));
  const dec = num(tag(resolver, 'jdedeg'));
  if (ra === undefined || dec === undefined) return null;
  const pm = tag(resolver, 'pm') ?? '';
  const plx = tag(resolver, 'plx') ?? '';
  const oname = tag(resolver, 'oname') ?? query;
  const aliases = new Set<string>([query.trim(), oname]);
  for (const m of resolver.matchAll(/<alias>([\s\S]*?)<\/alias>/gi)) aliases.add(decodeXml(m[1].trim()));
  const name = cleanName(oname);
  return {
    id: slug(name) || slug(query),
    name,
    ra,
    dec,
    epoch: 2000.0,
    pmRa: num(tag(pm, 'pmRA')),
    pmDec: num(tag(pm, 'pmDE')),
    parallax: num(tag(plx, 'v')),
    objectType: tag(resolver, 'otype'),
    spectralType: tag(resolver, 'spType'),
    aliases: [...aliases].filter(Boolean),
  };
}

async function viaSesame(base: string, query: string, signal: AbortSignal | undefined, opts: ResolveOptions): Promise<TargetInfo | null> {
  const { text } = await fetchText(base + encodeURIComponent(query), {
    signal,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs ?? 12000,
    retries: 0,
    what: 'Name lookup (CDS Sesame)',
  });
  if (!/<Sesame\b/i.test(text)) throw new Error('Name lookup (CDS Sesame) returned an unexpected answer.');
  return parseSesameXml(text, query);
}

async function viaSimbadTap(query: string, signal: AbortSignal | undefined, opts: ResolveOptions): Promise<TargetInfo | null> {
  // ADQL string literal: single quotes are doubled ("Barnard's Star" -> 'Barnard''s Star').
  const lit = query.replace(/'/g, "''");
  const adql =
    'SELECT TOP 1 b.main_id, b.ra, b.dec, b.pmra, b.pmdec, b.plx_value, b.otype, b.sp_type ' +
    `FROM basic AS b JOIN ident AS i ON i.oidref = b.oid WHERE i.id = '${lit}'`;
  const url = `${SIMBAD_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(adql)}`;
  const { text } = await fetchText(url, { signal, fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 12000, retries: 1, what: 'Name lookup (SIMBAD)' });
  const json = JSON.parse(text) as { metadata?: { name: string }[]; data?: unknown[][] };
  const row = json.data?.[0];
  if (!row || !json.metadata) return null;
  const get = (n: string): unknown => row[json.metadata!.findIndex((m) => m.name === n)];
  const ra = Number(get('ra'));
  const dec = Number(get('dec'));
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  const opt = (v: unknown): number | undefined => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const name = cleanName(String(get('main_id') ?? query));
  return {
    id: slug(name),
    name,
    ra,
    dec,
    epoch: 2000.0,
    pmRa: opt(get('pmra')),
    pmDec: opt(get('pmdec')),
    parallax: opt(get('plx_value')),
    objectType: get('otype') ? String(get('otype')) : undefined,
    spectralType: get('sp_type') ? String(get('sp_type')) : undefined,
    aliases: [query, String(get('main_id') ?? '')].filter(Boolean),
  };
}

/**
 * Resolve an object name to a TargetInfo (position at epoch 2000.0, proper motion in mas/yr with
 * pmRa including cos(dec), parallax in mas, object and spectral type).
 * Names of the built-in presets are understood even where Sesame is not ("WISE 0855-0714").
 * Resolves null when no service knows the name; rejects only when every service is unreachable
 * and the name is not a preset.
 */
export async function resolveName(name: string, signal?: AbortSignal, opts: ResolveOptions = {}): Promise<TargetInfo | null> {
  const q = (name ?? '').trim();
  if (!q) return null;
  const preset = findPreset(q);
  const queries = [...new Set([preset?.sesameName, q].filter((s): s is string => !!s))];
  const decorate = (t: TargetInfo): TargetInfo => {
    if (!preset) return t;
    return { ...t, id: preset.id, mags: t.mags ?? preset.mags, aliases: [...new Set([...(t.aliases ?? []), ...(preset.aliases ?? [])])] };
  };

  const errors: string[] = [];
  let answered = false;
  for (const base of SESAME_URLS) {
    try {
      for (const query of queries) {
        const t = await viaSesame(base, query, signal, opts);
        answered = true;
        if (t) return decorate(t);
      }
      break; // Sesame answered "nothing found": the mirror would say the same.
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!answered) {
    for (const query of queries) {
      try {
        const t = await viaSimbadTap(query, signal, opts);
        answered = true;
        if (t) return decorate(t);
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (preset) {
    // Offline or not found: fall back to the verified preset astrometry.
    const { challenge: _c, blurb: _b, sesameName: _s, briefPos: _p, deepField: _d, ...info } = preset;
    return { ...info };
  }
  if (answered) return null;
  throw new Error(`Name lookup failed: no lookup service could be reached. ${errors[0] ?? ''}`.trim());
}

/**
 * Position of a target at `mjd`. Applies proper motion along a straight line on the tangent plane:
 * the shift is pmRa*dt east and pmDec*dt north (dt in years, pm in mas/yr, so 3.6e6 mas = 1 deg),
 * which to first order is dec += pmDec*dt/3.6e6 and ra += pmRa*dt/3.6e6/cos(dec).
 * With opts.parallax and opts.observerAu (observer's barycentric position in au, ICRS axes) the
 * annual parallax shift is added as well; without observerAu parallax is ignored.
 */
export function propagate(
  target: TargetInfo,
  mjd: number,
  opts: { parallax?: boolean; observerAu?: [number, number, number] } = {},
): SkyPos {
  const dt = mjdToJyear(mjd) - (target.epoch ?? 2000);
  let xi = ((target.pmRa ?? 0) * dt) / 1000; // arcsec east
  let eta = ((target.pmDec ?? 0) * dt) / 1000; // arcsec north
  if (opts.parallax && opts.observerAu && target.parallax) {
    // The star appears displaced away from the observer's offset from the Sun's barycentre:
    // shift = -parallax * (component of the observer position across the line of sight).
    const [x, y, z] = opts.observerAu;
    const a = (target.ra * Math.PI) / 180;
    const d = (target.dec * Math.PI) / 180;
    const p = target.parallax / 1000;
    xi += p * (x * Math.sin(a) - y * Math.cos(a));
    eta += p * (x * Math.cos(a) * Math.sin(d) + y * Math.sin(a) * Math.sin(d) - z * Math.cos(d));
  }
  if (xi === 0 && eta === 0) return { ra: target.ra, dec: target.dec };
  const [ra, dec] = tanDeproject(target.ra, target.dec, xi, eta);
  return { ra: ((ra % 360) + 360) % 360, dec };
}
