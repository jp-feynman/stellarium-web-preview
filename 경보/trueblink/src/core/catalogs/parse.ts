// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Parsers for the text the catalogue services return. They are pure functions so that the tests
// can run them on saved real responses (tests/fixtures/catalogs/).

import type { CatalogSource, SolarSystemObject } from '../types';

/** Gaia DR3 positions are given at the reference epoch J2016.0. */
export const GAIA_EPOCH = 2016.0;
/** SIMBAD positions are given at J2000.0. */
export const SIMBAD_EPOCH = 2000.0;

function numOrUndef(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * VizieR "asu-tsv" output: '#' comment lines, then a header row of column names, a units row,
 * a row of dashes and the data rows, all tab separated. Returns one record per data row.
 */
export function parseVizierTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  let start = 1;
  // Skip the units row and the dashes row when present.
  while (start < lines.length && start <= 2 && (lines[start].startsWith('-') || lines[start].trim().split('\t').every((c) => !/^[+-]?\d/.test(c.trim())))) {
    start++;
  }
  const rows: Record<string, string>[] = [];
  for (let k = start; k < lines.length; k++) {
    const cells = lines[k].split('\t');
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (cells[i] ?? '').trim()));
    rows.push(rec);
  }
  return rows;
}

/** Gaia DR3 rows from VizieR I/355/gaiadr3 (columns Source, RA_ICRS, DE_ICRS, pmRA, pmDE, Plx, Gmag). */
export function parseGaiaTsv(text: string): CatalogSource[] {
  if (/<html/i.test(text.slice(0, 500))) throw new Error('returned an HTML page instead of a table');
  const out: CatalogSource[] = [];
  for (const r of parseVizierTsv(text)) {
    const ra = numOrUndef(r.RA_ICRS);
    const dec = numOrUndef(r.DE_ICRS);
    if (ra === undefined || dec === undefined || !r.Source) continue;
    const g = numOrUndef(r.Gmag);
    out.push({
      catalog: 'Gaia DR3',
      id: r.Source,
      ra,
      dec,
      epoch: GAIA_EPOCH,
      pmRa: numOrUndef(r.pmRA),
      pmDec: numOrUndef(r.pmDE),
      parallax: numOrUndef(r.Plx),
      mag: g,
      magBand: g === undefined ? undefined : 'G',
      label: g === undefined ? `Gaia ${r.Source}` : `G ${g.toFixed(1)}`,
    });
  }
  return out;
}

interface TapJson {
  metadata: { name: string }[];
  data: (string | number | null)[][];
}

/** SIMBAD TAP (FORMAT=json) rows of main_id, ra, dec, pmra, pmdec, plx_value, otype, sp_type. */
export function parseSimbadTapJson(text: string): CatalogSource[] {
  let doc: TapJson;
  try {
    doc = JSON.parse(text) as TapJson;
  } catch {
    throw new Error('returned something that is not JSON');
  }
  if (!doc || !Array.isArray(doc.metadata) || !Array.isArray(doc.data)) throw new Error('unexpected TAP reply');
  const col = (name: string) => doc.metadata.findIndex((m) => m.name.toLowerCase() === name);
  const iId = col('main_id');
  const iRa = col('ra');
  const iDec = col('dec');
  const iPmra = col('pmra');
  const iPmdec = col('pmdec');
  const iPlx = col('plx_value');
  const iOt = col('otype');
  const iSp = col('sp_type');
  if (iId < 0 || iRa < 0 || iDec < 0) throw new Error('TAP reply lacks main_id/ra/dec');
  const n = (row: (string | number | null)[], i: number): number | undefined =>
    i >= 0 && typeof row[i] === 'number' && Number.isFinite(row[i] as number) ? (row[i] as number) : undefined;
  const s = (row: (string | number | null)[], i: number): string | undefined =>
    i >= 0 && row[i] !== null && row[i] !== undefined && String(row[i]).trim() !== '' ? String(row[i]).trim() : undefined;
  const out: CatalogSource[] = [];
  for (const row of doc.data) {
    const ra = n(row, iRa);
    const dec = n(row, iDec);
    const id = s(row, iId);
    if (ra === undefined || dec === undefined || !id) continue;
    const otype = s(row, iOt);
    const sp = s(row, iSp);
    const extra = [otype, sp].filter(Boolean).join(', ');
    out.push({
      catalog: 'SIMBAD',
      id: id.replace(/\s+/g, ' '),
      ra,
      dec,
      epoch: SIMBAD_EPOCH,
      pmRa: n(row, iPmra),
      pmDec: n(row, iPmdec),
      parallax: n(row, iPlx),
      label: extra ? `${id.replace(/\s+/g, ' ')} (${extra})` : id.replace(/\s+/g, ' '),
    });
  }
  return out;
}

/** "12 19 51.7572" (hours) or "-04 03 16.909" (degrees) -> decimal value of the same unit. */
export function parseSexagesimal(s: string): number {
  const t = s.trim();
  const neg = t.startsWith('-');
  const parts = t.replace(/^[+-]/, '').split(/[\s:]+/).map(Number);
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return NaN;
  const v = (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return neg ? -v : v;
}

/**
 * SkyBoT cone search, -mime=json. SkyBoT answers HTTP 204 or an empty body when no known body is in
 * the cone: that is a valid "nothing here" and yields []. Positions are geocentric (observer 500).
 */
export function parseSkybotJson(text: string, mjd: number): SolarSystemObject[] {
  const t = text.trim();
  if (t === '' || t === 'null' || t === '[]') return [];
  let doc: unknown;
  try {
    doc = JSON.parse(t);
  } catch {
    throw new Error('returned something that is not JSON');
  }
  if (!Array.isArray(doc)) {
    const msg = typeof doc === 'object' && doc !== null ? JSON.stringify(doc).slice(0, 200) : String(doc);
    throw new Error(`unexpected reply ${msg}`);
  }
  const out: SolarSystemObject[] = [];
  for (const item of doc as Record<string, unknown>[]) {
    const rec = item ?? {};
    const num = (k: string): number | undefined => {
      const v = rec[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return undefined;
    };
    const raH = typeof rec['RA (hms)'] === 'string' ? parseSexagesimal(rec['RA (hms)'] as string) : NaN;
    const dec = typeof rec['DEC (dms)'] === 'string' ? parseSexagesimal(rec['DEC (dms)'] as string) : NaN;
    if (!Number.isFinite(raH) || !Number.isFinite(dec)) continue;
    out.push({
      name: String(rec.Name ?? 'unnamed'),
      number: num('Num'),
      ra: raH * 15,
      dec,
      mjd,
      objectClass: typeof rec.Class === 'string' ? rec.Class : undefined,
      vMag: num('VMag (mag)'),
      // SkyBoT's dRA is the rate along the sky (already multiplied by cos dec), in arcsec per hour.
      dRa: num('dRA (arcsec/h)'),
      dDec: num('dDEC (arcsec/h)'),
      deltaAu: num('dg (ua)'),
      rAu: num('dh (ua)'),
      phaseDeg: num('Phase (deg)'),
      errArcsec: num('Err (arcsec)'),
    });
  }
  return out;
}
