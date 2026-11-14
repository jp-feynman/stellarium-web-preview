// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from './fixtures/golden_l2.json';
import {
  BLOCK,
  clearHeaderCache,
  ensureLayout,
  fetchRange,
  fetchSettings,
  flagNamesFromCards,
  layoutFromFlagsHeader,
  NX,
  openL2,
  parseHeader,
  parseL2Start,
  PLANE_BYTES,
  readFlagsWindow,
  readWindow,
  RequestQueue,
  riceDecodeRow,
  s3Url,
  S3_HOSTS,
  type Cards,
} from '../src/core/fits';

const G = golden as any;
const files = G.files as Record<string, any>;

// ---------------------------------------------------------------- helpers to build synthetic FITS bytes

function fmtValue(v: string | number | boolean): string {
  if (typeof v === 'boolean') return (v ? 'T' : 'F').padStart(20);
  if (typeof v === 'number') return String(v).toUpperCase().padStart(20);
  return `'${v.replace(/'/g, "''").padEnd(8)}'`;
}
function card(key: string, v: string | number | boolean): string {
  const s = key.length > 8 || key.includes(' ') ? `HIERARCH ${key} = ${fmtValue(v).trim()}` : `${key.padEnd(8)}= ${fmtValue(v)} / comment`;
  return s.slice(0, 80).padEnd(80);
}
function header(cards: [string, string | number | boolean][], extraBlanks = 0): Uint8Array {
  let s = cards.map(([k, v]) => card(k, v)).join('') + ''.padEnd(80 * extraBlanks) + 'END'.padEnd(80);
  s = s.padEnd(Math.ceil(s.length / BLOCK) * BLOCK);
  return new Uint8Array(Array.from(s, (ch) => ch.charCodeAt(0)));
}
function imageCards(f: any, nExtra = 0): [string, string | number | boolean][] {
  const out: [string, string | number | boolean][] = [
    ['XTENSION', 'IMAGE'],
    ['BITPIX', -32],
    ['NAXIS', 2],
    ['NAXIS1', 2040],
    ['NAXIS2', 2040],
    ['PCOUNT', 0],
    ['GCOUNT', 1],
    ['EXTNAME', 'IMAGE'],
  ];
  for (const [k, v] of Object.entries(f.wcs_keywords)) out.push([k, v as any]);
  for (const k of ['MJD-OBS', 'MJD-BEG', 'MJD-AVG', 'MJD-END', 'XPOSURE', 'DATE-OBS']) out.push([k, f.time[k]]);
  for (const [k, v] of Object.entries(f.misc)) out.push([k, v as any]);
  out.push(['SPS_EPA', 180.0]);
  for (let k = 0; k < nExtra; k++) out.push([`HE_AG_${k}`, k]);
  return out;
}
const primaryCards: [string, string | number | boolean][] = [
  ['SIMPLE', true],
  ['BITPIX', 8],
  ['NAXIS', 0],
  ['EXTEND', true],
  ['VERSION', '7.0.5'],
];
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const sha = (u8: Uint8Array) => createHash('sha256').update(u8).digest('hex');
function beI32(a: Int32Array): Uint8Array {
  const b = new Uint8Array(a.length * 4);
  const dv = new DataView(b.buffer);
  a.forEach((v, i) => dv.setInt32(4 * i, v, false));
  return b;
}

// ---------------------------------------------------------------- RICE

describe('riceDecodeRow', () => {
  for (const v of G.rice_test_vectors.vectors) {
    it(`decodes golden row ${v.row_y}`, () => {
      const comp = new Uint8Array(Buffer.from(v.compressed_base64, 'base64'));
      expect(comp.length).toBe(Number(v.compressed_length));
      const dec = riceDecodeRow(comp, 2040, 32);
      expect(sha(beI32(dec))).toBe(v.decoded_sha256_int32_big_endian);
      const first = typeof v.decoded_first_40 === 'string' ? JSON.parse(v.decoded_first_40) : v.decoded_first_40;
      expect(Array.from(dec.subarray(0, 40))).toEqual(first);
      expect(dec[381]).toBe(Number(v.decoded_x381));
      expect(dec.reduce((s, x) => s + x, 0)).toBe(Number(v.decoded_sum));
    });
  }
  it('throws on a truncated tile instead of returning garbage', () => {
    const v = G.rice_test_vectors.vectors[0];
    const comp = new Uint8Array(Buffer.from(v.compressed_base64, 'base64'));
    expect(() => riceDecodeRow(comp.subarray(0, 100), 2040)).toThrow(/truncated/);
  });
});

// ---------------------------------------------------------------- header parsing

describe('parseHeader', () => {
  it('parses strings, logicals, integers, floats, D exponents and HIERARCH cards', () => {
    const raw =
      card('SIMPLE', true) +
      card('NAXIS', 0) +
      "OBJECT  = 'O''Brien  '           / quoted quote".padEnd(80) +
      'DVAL    =   1.5D-03 / fortran exponent'.padEnd(80) +
      card('NEG', -42) +
      card('FLAG', false) +
      'HIERARCH L2 N_TRANSIENT = 22243 / number of pixels flagged transient'.padEnd(80) +
      "HIERARCH SPS_FLAGS = 'all_sky ' / Flags".padEnd(80) +
      'COMMENT   this is not a value card'.padEnd(80) +
      'END'.padEnd(80);
    const bytes = new Uint8Array(Array.from(raw.padEnd(BLOCK), (c) => c.charCodeAt(0)));
    const h = parseHeader(bytes)!;
    expect(h.length).toBe(BLOCK);
    expect(h.cards.SIMPLE).toBe(true);
    expect(h.cards.NAXIS).toBe(0);
    expect(h.cards.OBJECT).toBe("O'Brien");
    expect(h.cards.DVAL).toBeCloseTo(1.5e-3, 15);
    expect(h.cards.NEG).toBe(-42);
    expect(h.cards.FLAG).toBe(false);
    expect(h.cards['L2 N_TRANSIENT']).toBe(22243);
    expect(h.cards.SPS_FLAGS).toBe('all_sky');
    expect(h.cards.COMMENT).toBeUndefined();
  });
  it('returns null when END is not in the buffer and honours the offset', () => {
    const h = header(primaryCards);
    expect(parseHeader(h.subarray(0, 240))).toBeNull();
    const two = concat(h, header([['XTENSION', 'IMAGE'], ['EXTNAME', 'X']], 40));
    const p = parseHeader(two, BLOCK)!;
    expect(p.cards.EXTNAME).toBe('X');
    expect(p.length).toBe(2 * BLOCK);
  });
  it('reads MSKNnnnn flag names, using MSKMnnnn masks for the bit number', () => {
    const cards: Cards = { MSKN0000: 'TRANSIENT', MSKM0000: 1, MSKN0021: 'SOURCE', MSKM0021: 2097152, MSKN0005: 'ODD' };
    expect(flagNamesFromCards(cards)).toEqual({ 0: 'TRANSIENT', 21: 'SOURCE', 5: 'ODD' });
  });
});

describe('parseL2Start (PRIMARY + IMAGE headers from synthetic bytes)', () => {
  for (const [key, f] of Object.entries(files)) {
    it(`fills FrameHeader for ${key.split('/').pop()}`, () => {
      const im = header(imageCards(f, f.misc.DETECTOR <= 2 ? 30 : 0));
      const bytes = concat(header(primaryCards), im, new Uint8Array(100));
      const h = parseL2Start(bytes, 'https://example.invalid/x.fits')!;
      expect(h.layout.imageDataOffset).toBe(BLOCK + im.length);
      expect(h.layout.flagsHeaderOffset).toBe(BLOCK + im.length + PLANE_BYTES);
      expect(h.detector).toBe(f.misc.DETECTOR);
      expect(h.obsId).toBe(f.misc.OBSID);
      expect(h.mjdAvg).toBe(f.time['MJD-AVG']);
      expect(h.mjdBeg).toBe(f.time['MJD-BEG']);
      expect(h.mjdEnd).toBe(f.time['MJD-END']);
      expect(h.exptime).toBe(f.time.XPOSURE);
      expect(h.version).toBe('7.0.5');
      expect(h.epa).toBe(180);
      expect(h.scPosKm).toEqual([f.misc.X_SC, f.misc.Y_SC, f.misc.Z_SC]);
      expect(h.psfFwhmArcsec).toBe(f.misc.PSF_FWHM);
      expect(h.omegaMedianArcsec2).toBe(f.misc.OMEGA_MEDIAN);
      expect(h.cards['L2 N_TRANSIENT']).toBe(f.misc['L2 N_TRANSIENT']);
      expect(h.wcs.crval).toEqual([f.wcs_keywords.CRVAL1, f.wcs_keywords.CRVAL2]);
      expect(h.wcs.cd).toEqual(f.wcs_derived.cd);
      // A cut-off IMAGE header asks for more bytes.
      expect(parseL2Start(bytes.subarray(0, BLOCK + 2 * BLOCK), 'u')).toBeNull();
    });
  }
  it('rejects an IMAGE HDU that is not a 2040x2040 float32 plane', () => {
    const f = Object.values(files)[0];
    const bad = imageCards(f).map(([k, v]) => [k, k === 'BITPIX' ? 16 : v] as [string, string | number | boolean]);
    expect(() => parseL2Start(concat(header(primaryCards), header(bad)), 'u')).toThrow(/unexpected HDU/);
  });
});

// ---------------------------------------------------------------- layout arithmetic

function flagsCardsRice(pcount: number): Cards {
  return {
    XTENSION: 'BINTABLE',
    BITPIX: 8,
    NAXIS: 2,
    NAXIS1: 8,
    NAXIS2: 2040,
    PCOUNT: pcount,
    GCOUNT: 1,
    TFIELDS: 1,
    TTYPE1: 'COMPRESSED_DATA',
    TFORM1: '1PB(6631)',
    ZIMAGE: true,
    ZBITPIX: 32,
    ZNAXIS: 2,
    ZNAXIS1: 2040,
    ZNAXIS2: 2040,
    ZTILE1: 2040,
    ZTILE2: 1,
    ZCMPTYPE: 'RICE_1',
    ZNAME1: 'BLOCKSIZE',
    ZVAL1: 32,
    ZNAME2: 'BYTEPIX',
    ZVAL2: 4,
    EXTNAME: 'FLAGS',
  };
}

describe('layout arithmetic (forward layout rule)', () => {
  const all = { ...files, ...(G.other_pipeline_layouts as Record<string, any>) };
  for (const [key, f] of Object.entries(all)) {
    it(`VARIANCE / ZODI offsets for ${key.split('/').slice(0, 1)}/${key.split('/').pop()}`, () => {
      const hd = Object.fromEntries((f.hdus as any[]).map((h) => [h.extname, h]));
      const base = { url: key, imageDataOffset: hd.IMAGE.data_offset, flagsHeaderOffset: hd.IMAGE.data_offset + PLANE_BYTES };
      expect(base.flagsHeaderOffset).toBe(hd.FLAGS.header_offset);
      const cards: Cards =
        hd.FLAGS.xtension === 'IMAGE'
          ? { XTENSION: 'IMAGE', BITPIX: 32, NAXIS: 2, NAXIS1: 2040, NAXIS2: 2040, EXTNAME: 'FLAGS' }
          : flagsCardsRice(hd.FLAGS.pcount);
      const lay = layoutFromFlagsHeader(base, cards, hd.FLAGS.header_length);
      expect(lay.flagsFormat).toBe(hd.FLAGS.xtension === 'IMAGE' ? 'plain' : 'rice');
      expect(lay.varianceDataOffset).toBe(hd.VARIANCE.data_offset);
      expect(lay.zodiDataOffset).toBe(hd.ZODI.data_offset);
      if (lay.flagsFormat === 'rice') expect(lay.flagsHeapOffset).toBe(hd.FLAGS.header_offset + hd.FLAGS.header_length + 8 * 2040);
      else expect(lay.flagsDataOffset).toBe(hd.FLAGS.data_offset);
    });
  }
  it('fails loudly on an unexpected FLAGS format', () => {
    const base = { url: 'u', imageDataOffset: 25920, flagsHeaderOffset: 25920 + PLANE_BYTES };
    expect(() => layoutFromFlagsHeader(base, { ...flagsCardsRice(1), ZCMPTYPE: 'GZIP_1' }, 17280)).toThrow(/GZIP_1/);
    expect(() => layoutFromFlagsHeader(base, { ...flagsCardsRice(1), ZTILE2: 16 }, 17280)).toThrow(/ZTILE/);
    expect(() => layoutFromFlagsHeader(base, { ...flagsCardsRice(1), EXTNAME: 'VARIANCE' }, 17280)).toThrow(/FLAGS/);
    expect(() => layoutFromFlagsHeader(base, { XTENSION: 'IMAGE', BITPIX: -32, NAXIS1: 2040, NAXIS2: 2040, EXTNAME: 'FLAGS' }, 14400)).toThrow(
      /unsupported FLAGS/,
    );
  });
});

// ---------------------------------------------------------------- URLs and request queue

describe('s3Url', () => {
  const key = Object.keys(files)[0];
  it('spreads keys over the four hosts deterministically', () => {
    expect(s3Url(key)).toBe(s3Url(key));
    const hosts = new Set(Object.keys(files).concat(Object.keys(G.wcs_only_files)).map((k) => new URL(s3Url(k)).host));
    for (const h of hosts) expect(S3_HOSTS).toContain(h);
    expect(hosts.size).toBeGreaterThan(1);
    for (let s = 0; s < 4; s++) expect(s3Url(key, s)).toBe(`https://${S3_HOSTS[s]}/${key}`);
    expect(s3Url(key, 5)).toBe(s3Url(key, 1));
  });
});

describe('RequestQueue', () => {
  it('caps concurrency per host and lets aborted waiters leave', async () => {
    const q = new RequestQueue(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 1;
    };
    const ctrl = new AbortController();
    const ps = Array.from({ length: 8 }, () => q.run('a', task));
    const other = q.run('b', task);
    const aborted = q.run('a', task, ctrl.signal);
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect((await Promise.all(ps)).length).toBe(8);
    await other;
    expect(peak).toBeLessThanOrEqual(3); // 2 on host a + 1 on host b
    expect(q.stats('a')).toEqual({ active: 0, waiting: 0 });
  });
});

// ---------------------------------------------------------------- fetchRange and windows with a fake S3

/** A fake Level-2 file served by a mocked fetch: IMAGE pixel (x, y) = y * 2040 + x, ZODI = -1, FLAGS rows = golden RICE row. */
function fakeFile(f: any) {
  const im = header(imageCards(f));
  const start = concat(header(primaryCards), im);
  const imageData = start.length;
  const F = imageData + PLANE_BYTES;
  const vec = G.rice_test_vectors.vectors[0];
  const comp = new Uint8Array(Buffer.from(vec.compressed_base64, 'base64'));
  const pcount = comp.length * 2040;
  const fh = header(
    Object.entries({ ...flagsCardsRice(pcount), MSKN0021: 'SOURCE', MSKM0021: 2097152 }).map(([k, v]) => [k, v] as [string, string | number | boolean]),
  );
  const rowTable = new Uint8Array(8 * 2040);
  const dv = new DataView(rowTable.buffer);
  for (let r = 0; r < 2040; r++) {
    dv.setUint32(8 * r, comp.length, false);
    dv.setUint32(8 * r + 4, r * comp.length, false);
  }
  const heap = F + fh.length + rowTable.length;
  const V = F + fh.length + Math.ceil((rowTable.length + pcount) / BLOCK) * BLOCK;
  const zodiData = V + 11520 + PLANE_BYTES + 11520;
  const byteAt = (o: number): number => {
    if (o < start.length) return start[o];
    if (o >= imageData && o < imageData + PLANE_BYTES) {
      const k = Math.floor((o - imageData) / 4);
      const tmp = new DataView(new ArrayBuffer(4));
      tmp.setFloat32(0, k, false);
      return tmp.getUint8((o - imageData) % 4);
    }
    if (o >= F && o < F + fh.length) return fh[o - F];
    if (o >= F + fh.length && o < heap) return rowTable[o - F - fh.length];
    if (o >= heap && o < heap + pcount) return comp[(o - heap) % comp.length];
    if (o >= zodiData && o < zodiData + PLANE_BYTES) return [0xbf, 0x80, 0, 0][(o - zodiData) % 4];
    return 0;
  };
  const requests: { url: string; range: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range') ?? '';
    requests.push({ url, range });
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return new Response('no', { status: 200 });
    const a = Number(m[1]);
    const b = Number(m[2]);
    const body = new Uint8Array(b - a + 1);
    for (let o = a; o <= b; o++) body[o - a] = byteAt(o);
    return new Response(body, { status: 206 });
  });
  return { fetchMock, requests, comp, vec };
}

describe('fetchRange / openL2 / readWindow / readFlagsWindow against a fake bucket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearHeaderCache();
  });

  it('sends one single Range header, rejects non-206 and cancels the body', async () => {
    const cancel = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, body: { cancel }, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    await expect(fetchRange('https://h/x', 0, 9)).rejects.toThrow(/ignored the byte range/);
    expect(cancel).toHaveBeenCalled();
  });

  it('retries HTTP 503 and then succeeds', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++n === 1 ? new Response('busy', { status: 503 }) : new Response(new Uint8Array(10), { status: 206 }))),
    );
    const b = await fetchRange('https://h/x', 0, 9);
    expect(b.length).toBe(10);
    expect(n).toBe(2);
  });

  it('times out with a clear message', async () => {
    const saved = { ...fetchSettings };
    fetchSettings.timeoutMs = 30;
    fetchSettings.retries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
      ),
    );
    await expect(fetchRange('https://h/x', 0, 9)).rejects.toThrow(/timed out/);
    Object.assign(fetchSettings, saved);
  });

  it('honours an AbortSignal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
      ),
    );
    const ctrl = new AbortController();
    const p = fetchRange('https://h/x', 0, 9, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('opens the file, walks the layout and reads windows of every plane', async () => {
    const f = Object.values(files)[2];
    const { fetchMock, requests, vec } = fakeFile(f);
    vi.stubGlobal('fetch', fetchMock);
    const key = 'dr1/level2/fake/3/level2_fake.fits';
    const h = await openL2(key);
    const again = await openL2(key);
    expect(again).toBe(h); // cached
    expect(requests.length).toBe(1);
    expect(requests[0].range).toBe('bytes=0-34559');
    expect(requests[0].url).toBe(s3Url(key));
    const img = await readWindow(h, 'IMAGE', 100, 200, 5, 3);
    expect(Array.from(img)).toEqual([0, 1, 2].flatMap((j) => [0, 1, 2, 3, 4].map((i) => (200 + j) * NX + 100 + i)));
    const lay = await ensureLayout(h);
    expect(lay.flagsFormat).toBe('rice');
    expect(h.flagNames?.[21]).toBe('SOURCE');
    const z = await readWindow(h, 'ZODI', 0, 2039, 4, 1);
    expect(Array.from(z)).toEqual([-1, -1, -1, -1]);
    const first = typeof vec.decoded_first_40 === 'string' ? JSON.parse(vec.decoded_first_40) : vec.decoded_first_40;
    const fl = await readFlagsWindow(h, 0, 10, 40, 3);
    expect(Array.from(fl.subarray(0, 40))).toEqual(first);
    expect(Array.from(fl.subarray(80, 120))).toEqual(first);
    for (const r of requests) expect(r.range).toMatch(/^bytes=\d+-\d+$/);
    await expect(readWindow(h, 'IMAGE', 2038, 0, 5, 1)).rejects.toThrow(/not inside/);
  });
});
