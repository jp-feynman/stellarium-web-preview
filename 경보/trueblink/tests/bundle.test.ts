// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_FORMAT, decodeBundle, encodeBundle, gunzipBytes, isGzip, keepCard, type BundleManifest } from '../src/core/bundle';
import { clearCache, configureCache, cutoutSource, getCutout, registerBundleCutouts } from '../src/core/cache';
import { makeGrid, reprojectCutout } from '../src/core/frames';
import type { DetectorId, Exposure, FrameHeader, NativeCutout, TanSipWcs } from '../src/core/types';

const PRESET_DIR = join(__dirname, '..', 'public', 'presets');

function fakeWcs(rotDeg: number): TanSipWcs {
  const s = 6.15 / 3600;
  const r = (rotDeg * Math.PI) / 180;
  return {
    crval: [150.1, 2.2],
    crpix: [1020.5, 1020.5],
    cd: [
      [-s * Math.cos(r), s * Math.sin(r)],
      [s * Math.sin(r), s * Math.cos(r)],
    ],
    a: [
      [0, 0, 1.5e-6, 3.2e-11],
      [0, 4.1e-6, 6e-10, 0],
      [1.6e-6, 1.4e-10, 0, 0],
      [5.7e-10, 0, 0, 0],
    ],
    b: [
      [0, 0, -2e-6, 1e-11],
      [0, 2e-6, -3e-10, 0],
      [-1e-6, 2e-10, 0, 0],
      [-4e-10, 0, 0, 0],
    ],
    aOrder: 3,
    bOrder: 3,
    naxis: [2040, 2040],
  };
}

function fakeExposure(k: number, det: DetectorId): Exposure {
  const obsId = `2025W45_1B_${String(k).padStart(4, '0')}_1`;
  return {
    id: `${obsId}D${det}`,
    obsId,
    detector: det,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: 60990 + k,
    mjdEnd: 60990 + k + 0.0013,
    mjd: 60990 + k + 0.00065,
    url: `https://irsa.example/${obsId}D${det}.fits`,
    s3Key: `dr1/level2/2025W45_1B/l2b-v27-2026-197/${det}/level2_${obsId}D${det}_spx_l2b-v27-2026-197.fits`,
    sRa: 150.1,
    sDec: 2.2,
    sRegion: [151, 1.3, 149.2, 1.3, 149.2, 3.1, 151, 3.1],
    emMin: 0.75,
    emMax: 1.1,
    pipelineTag: 'l2b-v27-2026-197',
  };
}

function fakeCutout(k: number, nx: number, ny: number, withFlags: boolean, names?: Record<number, string>): NativeCutout {
  const det = ((k % 6) + 1) as DetectorId;
  const exposure = fakeExposure(k, det);
  const header: FrameHeader = {
    wcs: fakeWcs(17 * k),
    detector: det,
    obsId: exposure.obsId,
    mjdAvg: exposure.mjd,
    mjdBeg: exposure.mjdStart,
    mjdEnd: exposure.mjdEnd,
    exptime: k === 1 ? NaN : 113.58,
    version: '7.0.5',
    epa: k % 2 ? 180 : 0,
    scPosKm: [1234.5, -6789.25, 42],
    psfFwhmArcsec: 6.4 + k / 10,
    omegaMedianArcsec2: 37.8,
    ...(names ? { flagNames: names } : {}),
    cards: { EXTNAME: 'IMAGE', BITPIX: -32, DETECTOR: det, XPOSURE: 113.58, CRVAL1: 150.1, A_0_2: 1.5e-6, OBSID: exposure.obsId },
    layout: { url: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/${exposure.s3Key}`, imageDataOffset: 34560, flagsHeaderOffset: 34560 + 2040 * 2040 * 4 },
  };
  const n = nx * ny;
  const image = new Float32Array(n);
  const bits = new Uint32Array(image.buffer);
  for (let i = 0; i < n; i++) image[i] = Math.sin(i * 0.37 + k) * 1e3 + i * 1e-3;
  bits[0] = 0x7fc00001; // NaN with a payload
  bits[n - 1] = 0xffc12345; // negative NaN with another payload
  image[1] = Infinity;
  image[2] = -0;
  image[3] = 1.4e-45; // denormal
  let flags: Int32Array | undefined;
  if (withFlags) {
    flags = new Int32Array(n);
    for (let i = 0; i < n; i++) flags[i] = (i * 2654435761) | 0;
    flags[0] = -1;
    flags[1] = 1 << 21; // SOURCE
  }
  return {
    exposure,
    header,
    x0: 100 + k,
    y0: 1900 - k,
    nx,
    ny,
    image,
    ...(flags ? { flags } : {}),
    targetPix: [100 + k + nx / 2 + 0.123456789, 1900 - k + ny / 2 - 0.987654321],
    wavelength: k === 2 ? NaN : 0.8 + k * 0.01,
    bandwidth: 0.02,
    channel: (k % 17) + 1,
    cubeChannel: 17 * (det - 1) + (k % 17) + 1,
    omegaArcsec2: 37.81234567891,
  };
}

const bytesOf = (a: Float32Array | Int32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

describe('pixel bundle format', () => {
  it('round-trips bit-exactly through JSON + gzip (NaN payloads, Inf, -0, denormals, flags)', async () => {
    const names = { 0: 'TRANSIENT', 21: 'SOURCE', 19: 'OUTLIER' };
    const cutouts = [
      fakeCutout(0, 37, 41, true, names),
      fakeCutout(1, 45, 45, true, names),
      fakeCutout(2, 9, 13, false, { 0: 'TRANSIENT', 21: 'SOURCE_OTHER' }),
      fakeCutout(3, 30, 31, true),
    ];
    const { manifest, binary } = encodeBundle(cutouts, { presetId: 'test', center: { ra: 150.1, dec: 2.2 }, fovArcsec: 180, windowFovArcsec: 240 });
    expect(manifest.format).toBe(BUNDLE_FORMAT);
    expect(manifest.byteOrder).toBe('little-endian');
    expect(manifest.flagNames).toEqual({ 0: 'TRANSIENT', 21: 'SOURCE', 19: 'OUTLIER' });
    expect(manifest.cutouts[0].header.flagNames).toBeUndefined(); // stored once
    expect(manifest.cutouts[2].header.flagNames).toEqual({ 0: 'TRANSIENT', 21: 'SOURCE_OTHER' });
    expect(manifest.binaryBytes).toBe(binary.length);
    expect(manifest.releases).toEqual(['dr1']);

    const json = JSON.parse(JSON.stringify(manifest)) as BundleManifest;
    const gz = gzipSync(binary);
    expect(isGzip(gz)).toBe(true);
    const back = decodeBundle(json, await gunzipBytes(gz, async (b) => gunzipSync(b)));
    // Also through DecompressionStream when this Node has it.
    const back2 = decodeBundle(json, await gunzipBytes(gz));
    expect(back.length).toBe(cutouts.length);
    for (const [k, c] of cutouts.entries()) {
      for (const d of [back[k], back2[k]]) {
        expect(Buffer.from(bytesOf(d.image)).equals(Buffer.from(bytesOf(c.image)))).toBe(true);
        if (c.flags) expect(Buffer.from(bytesOf(d.flags!)).equals(Buffer.from(bytesOf(c.flags)))).toBe(true);
        else expect(d.flags).toBeUndefined();
        expect(d.exposure).toEqual(c.exposure);
        expect([d.x0, d.y0, d.nx, d.ny]).toEqual([c.x0, c.y0, c.nx, c.ny]);
        expect(d.targetPix).toEqual(c.targetPix);
        expect(Object.is(d.wavelength, c.wavelength)).toBe(true);
        expect([d.bandwidth, d.channel, d.cubeChannel, d.omegaArcsec2]).toEqual([c.bandwidth, c.channel, c.cubeChannel, c.omegaArcsec2]);
        const { cards: dc, ...dh } = d.header;
        const { cards: cc, ...ch } = c.header;
        expect(dh).toEqual(ch); // wcs (all SIP terms), times, NaN exptime, flagNames, layout
        expect(Object.is(d.header.exptime, c.header.exptime)).toBe(true);
        expect(dc).toEqual(Object.fromEntries(Object.entries(cc).filter(([key]) => keepCard(key))));
      }
    }
    // Raw (already decompressed) bytes pass through gunzipBytes unchanged.
    expect(await gunzipBytes(binary)).toBe(binary);
    expect(() => decodeBundle(json, gz)).toThrow(/gzip/);
  });

  it('rejects foreign or truncated input', () => {
    const { manifest, binary } = encodeBundle([fakeCutout(0, 5, 5, true)], { presetId: 't', center: { ra: 0, dec: 0 }, fovArcsec: 60 });
    expect(() => decodeBundle({ ...manifest, format: 'x' } as unknown as BundleManifest, binary)).toThrow(/not a TrueBlink/);
    expect(() => decodeBundle({ ...manifest, version: 99 }, binary)).toThrow(/version/);
    expect(() => decodeBundle(manifest, binary.subarray(0, 50))).toThrow(/bytes/);
  });
});

// ---------------------------------------------------------------------------------------------
// End-to-end on the baked files (skipped when the bake has not been run)

function loadBaked(id: string): { manifest: BundleManifest; cutouts: NativeCutout[]; gzBytes: number } | null {
  const mp = join(PRESET_DIR, `${id}.bundle.json`);
  const bp = join(PRESET_DIR, `${id}.bundle.bin`);
  if (!existsSync(mp) || !existsSync(bp)) return null;
  const manifest = JSON.parse(readFileSync(mp, 'utf8')) as BundleManifest;
  const gz = readFileSync(bp);
  const cutouts = decodeBundle(manifest, gunzipSync(gz));
  return { manifest, cutouts, gzBytes: gz.length };
}

function peakOffset(c: NativeCutout, manifest: BundleManifest): { dx: number; dy: number; peak: number } | null {
  const grid = makeGrid(manifest.center, manifest.fovArcsec);
  // badMask 0: the star saturates, and the default mosaic mask blanks its core.
  const f = reprojectCutout(c, grid, { background: 'median', badMask: 0 });
  const n = grid.n;
  const mid = (n - 1) / 2;
  // Brightest pixel within 30 arcsec of the centre (the target is the dominant source for the presets used).
  const r = Math.ceil(30 / grid.scaleArcsec);
  let best = -Infinity;
  let bi = -1;
  let bj = -1;
  for (let j = mid - r; j <= mid + r; j++) {
    for (let i = mid - r; i <= mid + r; i++) {
      const v = f.data[j * n + i];
      if (Number.isFinite(v) && v > best) ((best = v), (bi = i), (bj = j));
    }
  }
  return bi < 0 ? null : { dx: bi - mid, dy: bj - mid, peak: best };
}

describe('baked bundles', () => {
  afterEach(async () => {
    await clearCache({ bundles: true });
  });

  it.skipIf(!existsSync(join(PRESET_DIR, 'barnard.bundle.bin')))("Barnard's Star bundle: target at the grid centre, served by the cache with no network", async () => {
    const b = loadBaked('barnard')!;
    expect(b.gzBytes).toBeLessThan(8 * 1024 * 1024);
    expect(b.cutouts.length).toBeGreaterThan(100);
    const offs: number[] = [];
    const lines: string[] = [];
    for (const c of b.cutouts) {
      if (c.exposure.detector > 4) continue; // detectors 1-4: the star is far brighter than anything nearby
      const p = peakOffset(c, b.manifest);
      if (!p) continue;
      const d = Math.hypot(p.dx, p.dy);
      offs.push(d);
      if (lines.length < 6) lines.push(`${c.exposure.id} ${c.wavelength.toFixed(3)} um: peak at (${p.dx}, ${p.dy}) grid px from centre, ${p.peak.toFixed(1)} MJy/sr`);
    }
    offs.sort((a, b2) => a - b2);
    const med = offs[Math.floor(offs.length / 2)];
    const p90 = offs[Math.floor(offs.length * 0.9)];
    console.log(`barnard: ${b.cutouts.length} cutouts, ${(b.gzBytes / 1048576).toFixed(2)} MB gzip; peak offset over ${offs.length} D1-D4 frames: median ${med.toFixed(2)}, 90% ${p90.toFixed(2)} grid px (3.075"/px)\n  ` + lines.join('\n  '));
        // Proper motion moves the star by up to ~1.7 grid px between the first/last visit and the centre epoch.
    expect(med).toBeLessThanOrEqual(3);
    expect(p90).toBeLessThanOrEqual(5);

    // Served from the bundle: the loader is never called.
    let loaderCalls = 0;
    configureCache({ store: null, loader: async () => (loaderCalls++, null) });
    registerBundleCutouts('barnard', b.cutouts, b.manifest);
    const near = { ra: b.manifest.center.ra + 5 / 3600, dec: b.manifest.center.dec - 5 / 3600 };
    let hits = 0;
    for (const c of b.cutouts.slice(0, 40)) {
      const got = await getCutout(c.exposure, near, 180, { planes: ['FLAGS'] });
      expect(cutoutSource(c.exposure.id)).toBe('bundle');
      if (got) hits++;
    }
    expect(loaderCalls).toBe(0);
    expect(hits).toBe(40);
    // VARIANCE is not in a bundle: that request goes on to the next layer.
    await getCutout(b.cutouts[0].exposure, near, 180, { planes: ['VARIANCE'] });
    expect(loaderCalls).toBe(1);
  });

  it.skipIf(!existsSync(join(PRESET_DIR, 'wise0855.bundle.bin')))('WISE 0855 bundle decodes and reprojects (report only)', () => {
    const b = loadBaked('wise0855')!;
    const red = b.cutouts.filter((c) => c.exposure.detector >= 5);
    const offs = red.map((c) => peakOffset(c, b.manifest)).filter((p): p is NonNullable<typeof p> => !!p);
    const near = offs.filter((p) => Math.hypot(p.dx, p.dy) <= 3).length;
    console.log(`wise0855: ${b.cutouts.length} cutouts, ${(b.gzBytes / 1048576).toFixed(2)} MB gzip; D5/D6 frames with the brightest pixel within 3 grid px of centre: ${near}/${offs.length}`);
    expect(b.cutouts.length).toBeGreaterThan(0);
  });
});
