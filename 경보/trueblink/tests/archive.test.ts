// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSiaUrl,
  dedupeExposures,
  discoverCollectionsDetailed,
  FALLBACK_COLLECTIONS,
  findPreset,
  groupVisits,
  loadPreset,
  parseCollectionsFromSelfDescription,
  parseSiaCsv,
  parseSRegion,
  PRESETS,
  RELAY_MISSING_MESSAGE,
  RelayMissingError,
  searchExposuresDetailed,
  siaErrorMessage,
  setApiBase,
  siaEndpoint,
  apiBase,
  type PresetBundle,
} from '../src/core/archive';
import { approxPixFromRegion } from '../src/core/wave';
import { parseSesameXml, propagate } from '../src/core/resolve';
import { angularSepArcsec } from '../src/core/wcs';
import type { Exposure } from '../src/core/types';

// A real IRSA SIA2 answer (2026-11-14) at R Dra for COLLECTION=spherex_dr1, _qr3, _dr1_cube, _dr1_deep
// with BAND=4.9e-6, cut to a few rows, plus two l2b_retry rows from the WISE 0855 field.
const csv = readFileSync(new URL('./fixtures/sia_sample.csv', import.meta.url), 'utf8');
// targets.json was written by Python and contains bare NaN values, which JSON.parse rejects.
const targets: unknown = JSON.parse(readFileSync(new URL('./fixtures/targets.json', import.meta.url), 'utf8').replace(/\bNaN\b/g, 'null'));

function fakeExposure(over: Partial<Exposure>): Exposure {
  const obsId = over.obsId ?? '2025W20_2D_0243_1';
  const detector = over.detector ?? 6;
  return {
    id: `${obsId}D${detector}`,
    obsId,
    detector,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: 60000,
    mjdEnd: 60000.0013,
    mjd: 60000.00065,
    url: '',
    s3Key: '',
    sRa: 0,
    sDec: 0,
    sRegion: [],
    emMin: 4.4115,
    emMax: 5.0096,
    pipelineTag: 'l2b-v27-2026-198',
    ...over,
  };
}

describe('parseSiaCsv', () => {
  const rows = parseSiaCsv(csv);

  it('survives the unquoted cloud_access column (53 fields vs 51 header names)', () => {
    const header = csv.split('\n')[0].split(',');
    expect(header.length).toBe(51);
    expect(csv.split('\n')[1].split(',').length).toBe(53);
    // 14 rows in the file, one is an all-sky cube tile (calib_level 3, dataproduct_type cube).
    expect(rows.length).toBe(13);
  });

  it('reads every field of the first row', () => {
    const e = rows[0];
    expect(e.obsId).toBe('2025W20_2D_0243_1');
    expect(e.detector).toBe(6);
    expect(e.id).toBe('2025W20_2D_0243_1D6');
    expect(e.collection).toBe('spherex_dr1');
    expect(e.release).toBe('dr1');
    expect(e.mjdStart).toBeCloseTo(60811.955829, 6);
    expect(e.mjdEnd).toBeCloseTo(60811.957162, 6);
    expect(e.mjd).toBeCloseTo((60811.955829 + 60811.957162) / 2, 6);
    expect(e.s3Key).toBe('dr1/level2/2025W20_2D/l2b-v27-2026-198/6/level2_2025W20_2D_0243_1D6_spx_l2b-v27-2026-198.fits');
    expect(e.url).toBe(`https://irsa.ipac.caltech.edu/ibe/data/spherex/${e.s3Key}`);
    expect(e.pipelineTag).toBe('l2b-v27-2026-198');
    expect(e.sRa).toBeCloseTo(253.59040304547804, 10);
    expect(e.sDec).toBeCloseTo(67.049214205434552, 10);
    expect(e.sRegion).toEqual([
      259.99143750908775, 67.34662051064976, 254.51493338800745, 64.66954081311222, 247.3007082551434, 66.49656555259199, 252.40488054282457,
      69.44161778918311,
    ]);
    expect(e.emMin).toBe(4.4115);
    expect(e.emMax).toBe(5.0096);
  });

  it('handles quick-release, deep and l2b_retry rows', () => {
    const qr3 = rows.filter((e) => e.collection === 'spherex_qr3');
    expect(qr3.length).toBe(3);
    expect(qr3.every((e) => e.release === 'qr3' && e.s3Key.startsWith('qr3/level2/'))).toBe(true);
    expect(rows.filter((e) => e.collection === 'spherex_dr1_deep').length).toBe(3);
    const retry = rows.filter((e) => e.pipelineTag.startsWith('l2b_retry-'));
    expect(retry.length).toBe(2);
    expect(retry[0].pipelineTag).toBe('l2b_retry-v27-2026-207');
    expect(rows.every((e) => e.sRegion.length === 8)).toBe(true);
  });

  it('s_region corners are in pixel-corner order, so the footprint homography finds the target', () => {
    // R Dra (the search position of this answer) must land inside each R Dra frame.
    for (const e of rows.filter((r) => !r.pipelineTag.startsWith('l2b_retry'))) {
      const p = approxPixFromRegion(e.sRegion, 248.1676, 66.755);
      expect(p).not.toBeNull();
      expect(p![0]).toBeGreaterThan(-0.5);
      expect(p![0]).toBeLessThan(2039.5);
      expect(p![1]).toBeGreaterThan(-0.5);
      expect(p![1]).toBeLessThan(2039.5);
    }
  });

  it('copes with CRLF line ends, quoted fields and empty input; rejects VOTable errors', () => {
    expect(parseSiaCsv(csv.replace(/\n/g, '\r\n')).length).toBe(13);
    expect(parseSiaCsv('')).toEqual([]);
    const lines = csv.split('\n');
    const quoted = lines[1].replace('SPHEREx LVF Survey Data', '"SPHEREx LVF Survey, Data"');
    expect(parseSiaCsv([lines[0], quoted].join('\n'))[0].obsId).toBe('2025W20_2D_0243_1');
    const err = '<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">POS out of range</INFO></RESOURCE></VOTABLE>';
    expect(() => parseSiaCsv(err)).toThrow(/POS out of range/);
    expect(() => parseSiaCsv('a,b,c\n1,2,3')).toThrow(/missing column/);
  });

  it('parseSRegion keeps four corners', () => {
    expect(parseSRegion('ICRS 1 2 3 4 5 6 7 8 1 2')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseSRegion('ICRS 1 2 3')).toEqual([]);
  });
});

describe('dedupeExposures', () => {
  it('keeps one row per (obsId, detector), preferring dr over qr and then the newest processing', () => {
    const a = fakeExposure({ collection: 'spherex_qr3', release: 'qr3', pipelineTag: 'l2b-v28-2026-300' });
    const b = fakeExposure({ pipelineTag: 'l2b-v27-2026-198' });
    const c = fakeExposure({ pipelineTag: 'l2b_retry-v27-2026-207' });
    const other = fakeExposure({ detector: 3, mjd: 59999 });
    const out = dedupeExposures([a, b, c, other]);
    expect(out.length).toBe(2);
    expect(out[0].detector).toBe(3); // sorted by time
    expect(out[1].pipelineTag).toBe('l2b_retry-v27-2026-207');
    expect(dedupeExposures([c, b])[0].pipelineTag).toBe('l2b_retry-v27-2026-207');
  });
  it('leaves the real sample alone (no duplicates there)', () => {
    const rows = parseSiaCsv(csv);
    expect(dedupeExposures(rows).length).toBe(rows.length);
    expect(dedupeExposures([...rows, ...rows]).length).toBe(rows.length);
  });
});

describe('groupVisits', () => {
  it('splits on gaps longer than gapDays and labels by the middle date', () => {
    const rows = parseSiaCsv(csv);
    const visits = groupVisits(rows);
    // 2025-04-28 (deep), 2025-05-15..19, 2025-11-07..11 (retry rows), 2026-05-16 (qr3)
    expect(visits.map((v) => v.exposureIds.length)).toEqual([3, 5, 2, 3]);
    expect(visits.map((v) => v.index)).toEqual([0, 1, 2, 3]);
    expect(visits[1].label).toBe('2025-05-18'); // middle = MJD 60813.83 = 2025-05-18T19:47 UTC
    expect(visits[3].label).toBe('2026-05-16');
    for (const v of visits) {
      expect(v.mjdMid).toBeCloseTo((v.mjdMin + v.mjdMax) / 2, 9);
      expect(v.mjdMax).toBeGreaterThanOrEqual(v.mjdMin);
    }
    expect(groupVisits(rows, 2).length).toBe(6);
    expect(groupVisits([])).toEqual([]);
  });
});

describe('collections and search plumbing (mock fetch)', () => {
  const selfDescription = `<VOTABLE><RESOURCE type="meta"><GROUP name="inputParams">
    <PARAM name="COLLECTION" datatype="char" arraysize="*" value=""><VALUES>
      <OPTION value="sofia_hawc"/><OPTION value="spherex_dr1"/><OPTION value="spherex_dr1_cube"/>
      <OPTION value="spherex_dr1_deep"/><OPTION value="spherex_qr3"/><OPTION value="spherex_qr3_deep"/>
      <OPTION value="spherex_dr1_cal"/></VALUES></PARAM></GROUP></RESOURCE></VOTABLE>`;

  it('keeps only Level-2 image collections, wide survey first', () => {
    expect(parseCollectionsFromSelfDescription(selfDescription)).toEqual(['spherex_dr1', 'spherex_qr3', 'spherex_dr1_deep', 'spherex_qr3_deep']);
  });

  it('falls back with a warning when discovery fails, and caches success', async () => {
    setApiBase('https://relay.example');
    let calls = 0;
    const failing = async (): Promise<Response> => {
      calls++;
      return new Response('nope', { status: 500 });
    };
    const d = await discoverCollectionsDetailed({ fetch: failing });
    expect(d.collections).toEqual(FALLBACK_COLLECTIONS);
    expect(d.warning).toMatch(/built-in list/);
    const ok = async (): Promise<Response> => {
      calls++;
      return new Response(selfDescription, { status: 200 });
    };
    const before = calls;
    expect((await discoverCollectionsDetailed({ fetch: ok })).warning).toBeUndefined();
    await discoverCollectionsDetailed({ fetch: ok });
    expect(calls - before).toBe(1);
    setApiBase(null);
  });

  it('builds the SIA URL and maps the api base', () => {
    expect(apiBase()).toBe('./api');
    expect(siaEndpoint()).toBe('./api/sia');
    setApiBase('https://irsa.ipac.caltech.edu/');
    expect(siaEndpoint()).toBe('https://irsa.ipac.caltech.edu/SIA');
    setApiBase(null);
    const url = buildSiaUrl('./api/sia', 'spherex_dr1_deep', { ra: 248.1676, dec: 66.755 }, { maxrec: 3001, bandMicrons: [4.4, 5.0] });
    expect(url).toBe('./api/sia?COLLECTION=spherex_dr1_deep&POS=circle+248.167600+66.755000+0.001&RESPONSEFORMAT=CSV&BAND=4.400000e-6+5.000000e-6&MAXREC=3001');
  });

  it('searches each collection, reports truncation and failed collections', async () => {
    const urls: string[] = [];
    const lines = csv.trimEnd().split('\n');
    const fake = async (u: string): Promise<Response> => {
      urls.push(u);
      const coll = /COLLECTION=([^&]+)/.exec(u)![1];
      if (coll === 'spherex_qr3_deep') return new Response('Bad request', { status: 400 });
      const max = /MAXREC=(\d+)/.exec(u);
      let body = [lines[0], ...lines.slice(1).filter((l) => l.includes(`,${coll},`))];
      if (max) body = body.slice(0, Number(max[1]) + 1);
      return new Response(body.join('\n'), { status: 200 });
    };
    const warnings: string[] = [];
    const res = await searchExposuresDetailed(
      { ra: 248.1676, dec: 66.755 },
      { collections: ['spherex_dr1', 'spherex_qr3', 'spherex_dr1_deep', 'spherex_qr3_deep'], maxPerCollection: 2, endpoint: 'https://relay.example/sia', fetch: fake, onWarning: (m) => warnings.push(m) },
    );
    expect(urls.length).toBe(4);
    expect(urls.every((u) => u.includes('MAXREC=3'))).toBe(true);
    expect(res.truncated.sort()).toEqual(['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3']);
    expect(res.rowsByCollection).toEqual({ spherex_dr1: 2, spherex_qr3: 2, spherex_dr1_deep: 2 });
    expect(res.exposures.length).toBe(6);
    expect(warnings.some((w) => w.includes('spherex_qr3_deep could not be searched'))).toBe(true);
    for (let k = 1; k < res.exposures.length; k++) expect(res.exposures[k].mjd).toBeGreaterThanOrEqual(res.exposures[k - 1].mjd);
  });

  it('rejects with a clear message when every collection fails, and honours AbortSignal', async () => {
    const down = async (): Promise<Response> => new Response('Server busy, retry later.', { status: 400 });
    await expect(
      searchExposuresDetailed({ ra: 10, dec: 10 }, { collections: ['spherex_dr1'], endpoint: 'https://x.example/sia', fetch: down }),
    ).rejects.toThrow(/HTTP 400/);
    const ctrl = new AbortController();
    const slow = (_u: string, init?: RequestInit): Promise<Response> =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const p = searchExposuresDetailed({ ra: 10, dec: 10 }, { collections: ['spherex_dr1'], endpoint: 'https://y.example/sia', fetch: slow, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow();
  });
});

describe('relay missing (a static host answers /api/sia with index.html)', () => {
  const page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>TrueBlink for SPHEREx</title></head><body><div id="root"></div></body></html>';

  it('recognises an HTML page instead of quoting its title', () => {
    expect(siaErrorMessage(page)).toBe(RELAY_MISSING_MESSAGE);
    expect(siaErrorMessage('<HTML><BODY>x</BODY></HTML>')).toBe(RELAY_MISSING_MESSAGE);
    expect(() => parseSiaCsv(page)).toThrow(RELAY_MISSING_MESSAGE);
    expect(siaErrorMessage('<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">POS out of range</INFO></VOTABLE>')).toMatch(/POS out of range/);
  });

  it('rejects the search at once with RelayMissingError (discovery and searches both get the page)', async () => {
    let calls = 0;
    const staticHost = async (): Promise<Response> => {
      calls++;
      return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const err = await searchExposuresDetailed({ ra: 10, dec: 10 }, { endpoint: 'https://static.example/api/sia', fetch: staticHost }).catch((e) => e);
    expect(err).toBeInstanceOf(RelayMissingError);
    expect(err.message).toBe('The archive search relay is not set up on this site.');
    expect(calls).toBe(1);
    // Explicit collections skip discovery; every collection answers with the page: one clear message.
    const err2 = await searchExposuresDetailed({ ra: 10, dec: 10 }, { collections: ['spherex_dr1', 'spherex_qr3'], endpoint: 'https://static2.example/api/sia', fetch: staticHost }).catch((e) => e);
    expect(err2).toBeInstanceOf(RelayMissingError);
    expect(String(err2.message)).not.toMatch(/TrueBlink for SPHEREx/);
  });
});

describe('presets', () => {
  it('has the five challenge targets with astrometry from targets.json', () => {
    expect(PRESETS.filter((p) => p.challenge).map((p) => p.id)).toEqual(['barnard', 'epsIndB', 'wise0855', 'rwaur', 'rdra']);
    const tj = (targets as { targets: { key: string; ra_dec_2000_0: number[]; pmra_mas_yr: number; pmdec_mas_yr: number; parallax_mas: number }[] }).targets;
    for (const p of PRESETS) {
      const t = tj.find((x) => x.key === p.id);
      expect(t, p.id).toBeTruthy();
      // Challenge targets to 0.05 arcsec; the plain sky fields are rounded (NEP: exact pole position).
      expect(angularSepArcsec(p.ra, p.dec, t!.ra_dec_2000_0[0], t!.ra_dec_2000_0[1])).toBeLessThan(p.challenge ? 0.05 : 3);
      expect(p.pmRa).toBeCloseTo(t!.pmra_mas_yr, 2);
      expect(p.pmDec).toBeCloseTo(t!.pmdec_mas_yr, 2);
    }
    expect(findPreset('WISE 0855-0714')?.id).toBe('wise0855');
    expect(findPreset("barnard's star")?.id).toBe('barnard');
    expect(findPreset('eps Ind B')?.id).toBe('epsIndB');
    expect(findPreset('nothing like this')).toBeUndefined();
  });

  it('loadPreset reads a bundle, returns null for 404 and odd ids', async () => {
    const bundle: PresetBundle = { target: PRESETS[0], generated: '2026-11-14T00:00:00Z', collections: ['spherex_dr1'], exposures: [] };
    const fake = async (u: string): Promise<Response> =>
      u.endsWith('/barnard.json') ? new Response(JSON.stringify(bundle), { status: 200 }) : new Response('not found', { status: 404 });
    expect((await loadPreset('barnard', { fetch: fake }))?.target.id).toBe('barnard');
    expect(await loadPreset('missing', { fetch: fake })).toBeNull();
    expect(await loadPreset('../etc', { fetch: fake })).toBeNull();
  });

  it('baked bundles (when present) are valid and propagated', () => {
    for (const p of PRESETS) {
      let text: string;
      try {
        text = readFileSync(new URL(`../public/presets/${p.id}.json`, import.meta.url), 'utf8');
      } catch {
        continue;
      }
      const b = JSON.parse(text) as PresetBundle;
      expect(b.target.id).toBe(p.id);
      expect(b.exposures.length).toBeGreaterThan(0);
      expect(b.exposures.every((e) => e.s3Key && e.sRegion.length === 8 && e.detector >= 1 && e.detector <= 6)).toBe(true);
    }
  });
});

describe('resolve helpers (offline)', () => {
  it('parses a Sesame answer', () => {
    const xml = `<?xml version="1.0"?><Sesame><Target option="SNV"><name>WISE J085510.83-071442.5</name>
      <Resolver name="S=Simbad"><oid>8596164</oid><oname>WISEA J085510.74-071442.5</oname><otype>BD*</otype>
      <jradeg>133.81890825</jradeg><jdedeg>-7.247048</jdedeg>
      <pm><v>8151.5</v><e>1.8</e><pmRA>-8123.7</pmRA><epmRA>1.3</epmRA><pmDE>673.2</pmDE><epmDE>1.3</epmDE></pm>
      <plx><v>439.0</v><e>2.4</e></plx><spType>Y2</spType></Resolver></Target></Sesame>`;
    const t = parseSesameXml(xml, 'WISE J085510.83-071442.5')!;
    expect(t.ra).toBe(133.81890825);
    expect(t.dec).toBe(-7.247048);
    expect(t.pmRa).toBe(-8123.7);
    expect(t.pmDec).toBe(673.2);
    expect(t.parallax).toBe(439);
    expect(t.spectralType).toBe('Y2');
    expect(t.objectType).toBe('BD*');
    expect(t.epoch).toBe(2000);
    expect(parseSesameXml('<Sesame><Target><INFO> *** Nothing found *** </INFO></Target></Sesame>', 'x')).toBeNull();
  });

  it('propagate reproduces the Gaia-propagated positions in targets.json', () => {
    const tj = (targets as { targets: { key: string; ra_dec_2016_0: number[]; ra_dec_2025_5: number[] }[] }).targets;
    for (const key of ['barnard', 'epsIndB', 'wise0855', 'rwaur', 'rdra']) {
      const p = PRESETS.find((x) => x.id === key)!;
      const t = tj.find((x) => x.key === key)!;
      // Julian epochs 2016.0 and 2025.5 as MJD.
      const at2016 = propagate(p, 51544.5 + 16 * 365.25);
      const at2025 = propagate(p, 51544.5 + 25.5 * 365.25);
      // The research table used rigorous space motion including radial velocity; our straight-line
      // model misses Barnard's Star's perspective acceleration (about 0.17 arcsec over 16-26 years),
      // which is tiny next to a 6.15 arcsec SPHEREx pixel.
      expect(angularSepArcsec(at2016.ra, at2016.dec, t.ra_dec_2016_0[0], t.ra_dec_2016_0[1]), key).toBeLessThan(0.3);
      expect(angularSepArcsec(at2025.ra, at2025.dec, t.ra_dec_2025_5[0], t.ra_dec_2025_5[1]), key).toBeLessThan(0.3);
    }
  });

  it('WISE 0855: the brief position is ~2 arcmin from where the object is during SPHEREx', () => {
    const p = findPreset('wise0855')!;
    const now = propagate(p, 61000); // 2025-11
    const sep = angularSepArcsec(now.ra, now.dec, p.briefPos!.ra, p.briefPos!.dec);
    expect(sep).toBeGreaterThan(115);
    expect(sep).toBeLessThan(135);
  });

  it('parallax option shifts by at most the parallax and needs an observer position', () => {
    const p = findPreset('barnard')!;
    const a = propagate(p, 61000);
    expect(propagate(p, 61000, { parallax: true })).toEqual(a);
    const b = propagate(p, 61000, { parallax: true, observerAu: [1, 0, 0] });
    const sep = angularSepArcsec(a.ra, a.dec, b.ra, b.dec);
    expect(sep).toBeGreaterThan(0.3);
    expect(sep).toBeLessThanOrEqual(0.547 + 1e-6);
  });
});
