// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Live checks against the real S3 bucket. Run: cd /mnt/c/S_N/trueblink && LIVE=1 npx vitest run tests/live/pixels.test.ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import golden from '../fixtures/golden_l2.json';
import {
  clearHeaderCache,
  ensureLayout,
  openL2,
  readFlagsWindow,
  readWindow,
  verifyLayout,
  windowByteRange,
} from '../../src/core/fits';
import { loadCutout, makeGrid, reprojectCutout } from '../../src/core/frames';
import { skyToGridPix } from '../../src/core/wcs';
import type { DetectorId, Exposure } from '../../src/core/types';

const G = golden as any;
const files = G.files as Record<string, any>;
const keys = Object.keys(files).slice(0, 4);

function sha(u8: Uint8Array): string {
  return createHash('sha256').update(u8).digest('hex');
}
function beF32(a: Float32Array): Uint8Array {
  const b = new Uint8Array(a.length * 4);
  const dv = new DataView(b.buffer);
  a.forEach((v, i) => dv.setFloat32(4 * i, v, false));
  return b;
}
function beI32(a: Int32Array): Uint8Array {
  const b = new Uint8Array(a.length * 4);
  const dv = new DataView(b.buffer);
  a.forEach((v, i) => dv.setInt32(4 * i, v, false));
  return b;
}
function exposureFor(key: string, f: any): Exposure {
  const det = f.misc.DETECTOR as DetectorId;
  return {
    id: `${f.misc.OBSID}D${det}`,
    obsId: f.misc.OBSID,
    detector: det,
    collection: 'spherex_dr1',
    release: 'dr1',
    mjdStart: f.time['MJD-BEG'],
    mjdEnd: f.time['MJD-END'],
    mjd: f.time['MJD-AVG'],
    url: f.url,
    s3Key: key,
    sRa: f.wcs_keywords.CRVAL1,
    sDec: f.wcs_keywords.CRVAL2,
    sRegion: [],
    emMin: 0,
    emMax: 0,
    pipelineTag: key.split('/')[3],
  };
}

describe('live Level-2 reads from S3', () => {
  for (const key of keys) {
    const f = files[key];
    const c = f.cutout_60px;
    const hd = Object.fromEntries((f.hdus as any[]).map((h) => [h.extname, h]));
    it(`layout, window and pixels: ${key.split('/').pop()}`, async () => {
      clearHeaderCache();
      const h = await openL2(key);
      expect(h.layout.imageDataOffset).toBe(hd.IMAGE.data_offset);
      expect(h.layout.flagsHeaderOffset).toBe(hd.FLAGS.header_offset);
      expect(h.detector).toBe(f.misc.DETECTOR);
      expect(h.obsId).toBe(f.misc.OBSID);
      expect(h.mjdAvg).toBe(f.time['MJD-AVG']);
      expect(h.mjdBeg).toBe(f.time['MJD-BEG']);
      expect(h.mjdEnd).toBe(f.time['MJD-END']);
      expect(h.exptime).toBe(f.time.XPOSURE);
      expect(h.version).toBe('7.0.5');
      expect(h.cards['L2 N_TRANSIENT']).toBe(f.misc['L2 N_TRANSIENT']);
      expect(h.psfFwhmArcsec).toBe(f.misc.PSF_FWHM);
      expect(h.omegaMedianArcsec2).toBe(f.misc.OMEGA_MEDIAN);
      expect(h.scPosKm).toEqual([f.misc.X_SC, f.misc.Y_SC, f.misc.Z_SC]);
      const lay = await ensureLayout(h);
      expect(lay.flagsFormat).toBe('rice');
      expect(lay.varianceDataOffset).toBe(hd.VARIANCE.data_offset);
      expect(lay.zodiDataOffset).toBe(hd.ZODI.data_offset);
      expect(lay.flagsHeapOffset).toBe(c.flags_row_table.heap_offset);
      expect(lay.flagsRowTable![0]).toBe(c.flags_row_table.row0_len);
      expect(lay.flagsRowTable![2 * 2039 + 1]).toBe(c.flags_row_table.row2039_off);
      expect(h.flagNames?.[21]).toBe('SOURCE');
      expect(h.flagNames?.[0]).toBe('TRANSIENT');
      await verifyLayout(h);

      const [x0, x1, y0, y1] = c.window_x0_x1_y0_y1;
      const nx = x1 - x0 + 1;
      const ny = y1 - y0 + 1;
      expect(windowByteRange(lay.imageDataOffset, x0, y0, nx, ny)).toEqual(c.requests.r2_image);
      expect(windowByteRange(lay.varianceDataOffset!, x0, y0, nx, ny)).toEqual(c.requests.r5_variance);
      expect(windowByteRange(lay.zodiDataOffset!, x0, y0, nx, ny)).toEqual(c.requests.r6_zodi);
      const planes = {
        IMAGE: await readWindow(h, 'IMAGE', x0, y0, nx, ny),
        VARIANCE: await readWindow(h, 'VARIANCE', x0, y0, nx, ny),
        ZODI: await readWindow(h, 'ZODI', x0, y0, nx, ny),
      };
      for (const ext of ['IMAGE', 'VARIANCE', 'ZODI'] as const) {
        expect(sha(beF32(planes[ext]))).toBe(c.planes[ext].sha256_big_endian_bytes);
        for (const s of c.planes[ext].samples) {
          const v = planes[ext][s.dy * nx + s.dx];
          if (s.value === null) expect(Number.isNaN(v)).toBe(true);
          else expect(v).toBe(Math.fround(s.value));
        }
      }
      const flags = await readFlagsWindow(h, x0, y0, nx, ny);
      expect(sha(beI32(flags))).toBe(c.planes.FLAGS.sha256_big_endian_bytes);
      for (const s of c.planes.FLAGS.samples) expect(flags[s.dy * nx + s.dx]).toBe(s.value);
    });
  }

  it('layout walk on other pipeline versions (QR3 RICE, QR2 plain int32 FLAGS)', async () => {
    for (const [key, g] of Object.entries(G.other_pipeline_layouts as Record<string, any>)) {
      const hd = Object.fromEntries((g.hdus as any[]).map((h) => [h.extname, h]));
      const h = await openL2(key);
      const lay = await ensureLayout(h);
      expect(h.layout.imageDataOffset).toBe(hd.IMAGE.data_offset);
      expect(lay.varianceDataOffset).toBe(hd.VARIANCE.data_offset);
      expect(lay.zodiDataOffset).toBe(hd.ZODI.data_offset);
      expect(lay.flagsFormat).toBe(hd.FLAGS.xtension === 'IMAGE' ? 'plain' : 'rice');
      const fl = await readFlagsWindow(h, 1000, 1000, 8, 8);
      expect(fl.length).toBe(64);
    }
  });

  it('loadCutout at RA 133.7951 Dec -7.2451 returns the golden target pixel and wavelength', async () => {
    clearHeaderCache();
    const pos = { ra: 133.7951, dec: -7.2451 };
    for (const key of keys) {
      const f = files[key];
      const s = (f.sky2pix as any[]).find((p) => p.name === 'WISE0855_query');
      const t0 = performance.now();
      const cut = await loadCutout(exposureFor(key, f), pos, 120, { planes: ['FLAGS', 'ZODI', 'VARIANCE'] });
      const t1 = performance.now();
      expect(cut).not.toBeNull();
      expect(Math.abs(cut!.targetPix[0] - f.cutout_60px.target_xy[0])).toBeLessThan(1e-6);
      expect(Math.abs(cut!.targetPix[1] - f.cutout_60px.target_xy[1])).toBeLessThan(1e-6);
      expect(Math.abs(cut!.wavelength - s.wavelength_um)).toBeLessThan(1e-5); // bundled table is rounded to ~7 digits
      expect(Math.abs(cut!.bandwidth - s.bandwidth_um)).toBeLessThan(1e-5);
      expect(cut!.flags).toBeDefined();
      const grid = makeGrid(pos, 120);
      const fr = reprojectCutout(cut!, grid);
      const t2 = performance.now();
      const [ic, jc] = skyToGridPix(grid, pos.ra, pos.dec);
      expect(ic).toBeCloseTo((grid.n - 1) / 2, 6);
      expect(jc).toBeCloseTo((grid.n - 1) / 2, 6);
      let finite = 0;
      for (const v of fr.data) if (Number.isFinite(v)) finite++;
      expect(finite / fr.data.length).toBeGreaterThan(0.9);
      console.log(
        `${key.split('/').pop()}: loadCutout ${(t1 - t0).toFixed(0)} ms (window ${cut!.nx}x${cut!.ny}, 4 planes, cold), ` +
          `reproject ${(t2 - t1).toFixed(1)} ms (grid ${grid.n}), ${fr.meta.label}`,
      );
    }
  });
});
