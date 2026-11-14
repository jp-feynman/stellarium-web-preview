// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden_l2.json';
import { angularSepArcsec, gridPixToSky, pixelAreaArcsec2, pixToSky, positionAngleDeg, skyToGridPix, skyToPix, wcsFromCards } from '../src/core/wcs';
import { approxPixFromRegion, channelAt, CHANNELS, waveAt, waveTables } from '../src/core/wave';

const files = (golden as any).files as Record<string, any>;

describe('TAN-SIP WCS against astropy golden values', () => {
  for (const [key, f] of Object.entries(files)) {
    const wcs = wcsFromCards({ ...f.wcs_keywords, NAXIS1: 2040, NAXIS2: 2040 });
    it(`pixToSky / skyToPix ${key.slice(-52)}`, () => {
      for (const p of f.pix2sky_grid) {
        const [ra, dec] = pixToSky(wcs, p.x, p.y);
        expect(angularSepArcsec(ra, dec, p.ra, p.dec)).toBeLessThan(1e-4);
        const [x, y] = skyToPix(wcs, p.ra, p.dec);
        expect(Math.abs(x - p.x)).toBeLessThan(1e-5);
        expect(Math.abs(y - p.y)).toBeLessThan(1e-5);
      }
      for (const s of f.sky2pix) {
        const [x, y] = skyToPix(wcs, s.ra, s.dec);
        expect(Math.abs(x - s.x)).toBeLessThan(1e-5);
        expect(Math.abs(y - s.y)).toBeLessThan(1e-5);
      }
    });
    it(`pixel area and position angle ${key.slice(-52)}`, () => {
      for (const a of f.solid_angle_arcsec2) {
        expect(Math.abs(pixelAreaArcsec2(wcs, a.x, a.y) / a.wcs_jacobian_value - 1)).toBeLessThan(2e-4);
      }
      const pa = positionAngleDeg(wcs, 1019.5, 1019.5);
      const want = f.wcs_derived.pa_yaxis_deg_east_of_north;
      const d = ((pa - want + 540) % 360) - 180;
      expect(Math.abs(d)).toBeLessThan(0.5);
    });
    it(`wavelength lookup ${key.slice(-52)}`, () => {
      const det = f.misc.DETECTOR as number;
      const tab = waveTables()[det];
      for (const p of f.pix2sky_grid) {
        if (p.wavelength_um == null) continue;
        const w = waveAt(tab, p.x, p.y);
        expect(Math.abs(w.wavelength - p.wavelength_um)).toBeLessThan(2e-6);
        expect(Math.abs(w.bandwidth - p.bandwidth_um)).toBeLessThan(2e-6);
      }
    });
  }
});

describe('helpers', () => {
  it('sky grid is north-up, east-left and round-trips', () => {
    const grid = { ra0: 133.8, dec0: -7.24, n: 61, scaleArcsec: 3.075 };
    const [raE, decE] = gridPixToSky(grid, 0, 30);
    const [raW] = gridPixToSky(grid, 60, 30);
    const [, decN] = gridPixToSky(grid, 30, 60);
    expect(raE).toBeGreaterThan(raW); // column 0 is east (larger RA)
    expect(decN).toBeGreaterThan(decE); // row n-1 is north
    const [i, j] = skyToGridPix(grid, raE, decE);
    expect(i).toBeCloseTo(0, 6);
    expect(j).toBeCloseTo(30, 6);
  });
  it('channel map and table are consistent', () => {
    expect(CHANNELS.length).toBe(102);
    expect(channelAt(1019.5, 5)).toBe(17); // long-wavelength end at the bottom
    expect(channelAt(1019.5, 1900)).toBe(1);
    expect(channelAt(1019.5, 2035)).toBe(0); // off-nominal strip at the very top
  });
  it('footprint homography lands within a few pixels', () => {
    const f = Object.values(files)[2];
    const wcs = wcsFromCards({ ...f.wcs_keywords, NAXIS1: 2040, NAXIS2: 2040 });
    const corners = [[-0.5, -0.5], [2039.5, -0.5], [2039.5, 2039.5], [-0.5, 2039.5]];
    const region = corners.flatMap(([x, y]) => pixToSky(wcs, x, y));
    const s = f.sky2pix[0];
    const p = approxPixFromRegion(region, s.ra, s.dec)!;
    expect(Math.hypot(p[0] - s.x, p[1] - s.y)).toBeLessThan(12);
    expect(approxPixFromRegion(region, s.ra + 20, s.dec)).toBeNull();
  });
});
