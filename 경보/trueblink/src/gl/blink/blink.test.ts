// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import type { Stretch } from '../../core/types';
import { gridPixToSky } from '../../core/wcs';
import {
  COLOR_MAPS,
  colormapLookup,
  colormapLut,
  differenceLevel,
  frameToImageData,
  frameToRGBA,
  HATCH_DARK,
  HATCH_LIGHT,
  luptonRgb,
  percentileStretch,
  stretchValue,
} from './stretch';
import { clampView, defaultView, gridToScreen, panBy, screenToGrid, zoomAbout, MAX_ZOOM, type Viewport } from './view';
import { overlayVisible, pickOverlay, projectOverlay } from './overlays';
import { syntheticScene } from './synthetic';

const S: Stretch = { lo: 0, hi: 10, mode: 'linear', q: 10, invert: false, colormap: 'gray' };

describe('stretch (CPU mirror of the shader)', () => {
  it('linear, sqrt, log, asinh map lo -> 0 and hi -> 1 and clip outside', () => {
    for (const mode of ['linear', 'sqrt', 'log', 'asinh'] as const) {
      const s = { ...S, mode };
      expect(stretchValue(0, s)).toBeCloseTo(0, 12);
      expect(stretchValue(10, s)).toBeCloseTo(1, 12);
      expect(stretchValue(-5, s)).toBe(0);
      expect(stretchValue(50, s)).toBe(1);
    }
    expect(stretchValue(2.5, { ...S, mode: 'linear' })).toBeCloseTo(0.25, 12);
    expect(stretchValue(2.5, { ...S, mode: 'sqrt' })).toBeCloseTo(0.5, 12);
    expect(stretchValue(2.5, { ...S, mode: 'asinh', q: 12 })).toBeCloseTo(Math.asinh(3) / Math.asinh(12), 12);
  });
  it('asinh with q = 0 is linear; invert flips', () => {
    expect(stretchValue(4, { ...S, mode: 'asinh', q: 0 })).toBeCloseTo(0.4, 12);
    expect(stretchValue(4, { ...S, invert: true })).toBeCloseTo(0.6, 12);
  });
  it('NaN and the GPU sentinel are "no data", never 0', () => {
    expect(stretchValue(NaN, S)).toBeNaN();
    expect(stretchValue(-1e30, S)).toBeNaN();
  });
  it('difference level is symmetric about 0.5 with range +-hi', () => {
    const s = { ...S, mode: 'asinh' as const };
    expect(differenceLevel(0, s)).toBe(0.5);
    expect(differenceLevel(10, s)).toBeCloseTo(1, 12);
    expect(differenceLevel(-10, s)).toBeCloseTo(0, 12);
    expect(differenceLevel(3, s) - 0.5).toBeCloseTo(0.5 - differenceLevel(-3, s), 12);
  });
  it('Lupton RGB keeps colour ratios and never exceeds 1', () => {
    const c = luptonRgb(1000, 500, 250, S)!;
    expect(Math.max(...c)).toBeLessThanOrEqual(1);
    expect(c[1] / c[0]).toBeCloseTo(0.5, 9);
    expect(c[2] / c[0]).toBeCloseTo(0.25, 9);
    expect(luptonRgb(1, NaN, 1, S)).toBeNull();
  });
});

describe('colour maps', () => {
  it('end points and LUT size', () => {
    expect(colormapLookup('gray', 0)).toEqual([0, 0, 0]);
    expect(colormapLookup('gray', 1)).toEqual([255, 255, 255]);
    expect(colormapLookup('viridis', 1)).toEqual(COLOR_MAPS.viridis[COLOR_MAPS.viridis.length - 1]);
    const lut = colormapLut('heat');
    expect(lut.length).toBe(1024);
    expect(lut[1023]).toBe(255);
  });
  it('diverging map is dark in the middle', () => {
    const mid = colormapLookup('diverging', 0.5);
    expect(Math.max(...mid)).toBeLessThan(40);
  });
});

describe('frameToImageData orientation and no-data hatch', () => {
  const sc = syntheticScene();
  const f = sc.frames[2];
  const n = f.grid.n;
  const s = percentileStretch(sc.frames, { loPct: 30, hiPct: 99.8 });
  const rgba = frameToRGBA(f, s);
  it('the north-east star (high row, low column) lands in the top-left quadrant', () => {
    // A linear stretch that does not saturate, so the brightest canvas pixel is the star's peak.
    const unsat = frameToRGBA(f, { ...s, mode: 'linear', hi: 20 });
    let best = -1;
    let bx = 0;
    let by = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = unsat[4 * (y * n + x)];
      if (v > best) [best, bx, by] = [v, x, y];
    }
    const [i, j] = sc.northEastStar;
    expect(bx).toBe(i);
    expect(by).toBe(n - 1 - j);
    expect(bx).toBeLessThan(n / 4);
    expect(by).toBeLessThan(n / 4);
  });
  it('NaN pixels use the hatch colours', () => {
    const [i0, j0] = sc.nanPatch;
    const o = 4 * ((n - 1 - j0) * n + i0);
    const c = [rgba[o], rgba[o + 1], rgba[o + 2]];
    expect([HATCH_DARK, HATCH_LIGHT].some((h) => h.every((x, k) => x === c[k]))).toBe(true);
  });
  it('returns an ImageData-shaped object outside the browser', () => {
    const im = frameToImageData(f, s);
    expect(im.width).toBe(n);
    expect(im.height).toBe(n);
    expect(im.data.length).toBe(n * n * 4);
  });
});

describe('view geometry', () => {
  const vp: Viewport = { width: 800, height: 600, n: 61 };
  it('fits the square, north up and east left', () => {
    const v = defaultView(61);
    const [xl, yt] = gridToScreen(vp, v, -0.5, 60.5);
    const [xr, yb] = gridToScreen(vp, v, 60.5, -0.5);
    expect(xl).toBeCloseTo(100, 9);
    expect(xr).toBeCloseTo(700, 9);
    expect(yt).toBeCloseTo(0, 9);
    expect(yb).toBeCloseTo(600, 9);
    // Column 0 is east: its sky RA is larger than that of the last column.
    const g = { ra0: 10, dec0: 20, n: 61, scaleArcsec: 6 };
    expect(gridPixToSky(g, 0, 30)[0]).toBeGreaterThan(gridPixToSky(g, 60, 30)[0]);
  });
  it('screenToGrid inverts gridToScreen', () => {
    const v = { zoom: 3.3, cx: 20, cy: 40 };
    const [x, y] = gridToScreen(vp, v, 12.3, 45.6);
    const [i, j] = screenToGrid(vp, v, x, y);
    expect(i).toBeCloseTo(12.3, 9);
    expect(j).toBeCloseTo(45.6, 9);
  });
  it('zoom keeps the point under the cursor fixed and clamps to 1..32', () => {
    const v0 = defaultView(61);
    const v1 = zoomAbout(vp, v0, 4, 300, 200);
    const a = screenToGrid(vp, v0, 300, 200);
    const b = screenToGrid(vp, v1, 300, 200);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
    expect(zoomAbout(vp, v1, 1000, 300, 200).zoom).toBe(MAX_ZOOM);
    expect(zoomAbout(vp, v1, 0.001, 300, 200)).toEqual(defaultView(61));
  });
  it('pan cannot leave the image', () => {
    const v = clampView(vp, { zoom: 4, cx: 30, cy: 30 });
    const far = panBy(vp, v, 1e6, -1e6);
    expect(far.cx).toBeCloseTo(-0.5 + 61 / 8, 9);
    expect(far.cy).toBeCloseTo(-0.5 + 61 / 8, 9);
  });
});

describe('overlays', () => {
  const sc = syntheticScene();
  const vp: Viewport = { width: 610, height: 610, n: 61 };
  const v = defaultView(61);
  it('project onto the mover pixel and respect frameIndex', () => {
    const circle = sc.overlays.find((o) => o.id === 'mover-1')!;
    const po = projectOverlay(circle, sc.grid, vp, v);
    const [x, y] = gridToScreen(vp, v, sc.mover[1][0], sc.mover[1][1]);
    expect(po.x).toBeCloseTo(x, 6);
    expect(po.y).toBeCloseTo(y, 6);
    expect(po.r).toBeCloseTo((14 / 6.15) * 10, 6);
    expect(overlayVisible(circle, 1)).toBe(true);
    expect(overlayVisible(circle, 0)).toBe(false);
  });
  it('picks the nearest overlay within 10 px', () => {
    const list = sc.overlays.filter((o) => overlayVisible(o, 0)).map((o) => projectOverlay(o, sc.grid, vp, v));
    const [x, y] = gridToScreen(vp, v, sc.mover[0][0], sc.mover[0][1]);
    expect(pickOverlay(list, x, y)?.id).toBe('mover-0');
    expect(pickOverlay(list, 2, 300)).toBeUndefined();
    const track = list.find((p) => p.overlay.id === 'track')!;
    const [tx, ty] = track.pts[1];
    expect(pickOverlay(list, tx + 1, ty + 5)?.id).toBe('track');
  });
});
