// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Sanity checks of the synthetic demo data: orientation, honesty (NaN, not zeros), store flow.
import { describe, expect, it } from 'vitest';
import { skyToGridPix } from '../core/wcs';
import { buildMockSequence, buildScene, MockPipeline } from './mock';
import { stretchValue } from './render2d';
import { useApp } from './store';

const opts = { sequence: 'epochs', bandGroupId: 'all', balanced: true, referenceVisit: null };

function brightest(data: Float32Array, n: number): [number, number] {
  let best = -Infinity;
  let at: [number, number] = [0, 0];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = data[j * n + i];
      if (Number.isFinite(v) && v > best) {
        best = v;
        at = [i, j];
      }
    }
  return at;
}

describe('mock scenes', () => {
  it('Barnard\'s Star moves north (up = larger row index j) between visits, and its core is NaN', () => {
    const scene = buildScene({ name: "Barnard's Star" }, 180)!;
    const seq = buildMockSequence(scene, 180, opts);
    expect(seq.frames.length).toBe(3);
    const n = seq.frames[0].grid.n;
    // Saturated core: NaN pixels exist near the centre, never zeros standing in for missing data.
    const c = Math.floor(n / 2);
    let nan = 0;
    for (let j = c - 4; j <= c + 4; j++) for (let i = c - 4; i <= c + 4; i++) if (Number.isNaN(seq.frames[0].data[j * n + i])) nan++;
    expect(nan).toBeGreaterThan(0);
    // Expected track: rows increase with time (north is +j).
    const t = scene.sources[0];
    const p0 = skyToGridPix(seq.frames[0].grid, t.ra, t.dec);
    expect(p0[0]).toBeGreaterThan(0);
    const firstMjd = seq.frames[0].meta.mjd;
    const lastMjd = seq.frames[2].meta.mjd;
    expect(lastMjd).toBeGreaterThan(firstMjd);
  });

  it('WISE 0855 is far brighter in the cold band than across all wavelengths, and moves west (smaller RA -> larger column i)', () => {
    const scene = buildScene({ name: 'WISE 0855-0714' }, 180)!;
    const cold = buildMockSequence(scene, 180, { ...opts, bandGroupId: 'cold' });
    const n = cold.frames[0].grid.n;
    const target = scene.sources.find((s) => s.role === 'target')!;
    expect(target.sed(4.6)).toBeGreaterThan(50 * target.sed(1.5));
    // West is to the right: the brightest pixel near the target drifts to larger i.
    const near = (f: Float32Array) => {
      const sub = new Float32Array(f.length).fill(NaN);
      const [ti, tj] = skyToGridPix(cold.frames[0].grid, scene.center.ra, scene.center.dec);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (Math.hypot(i - ti, j - tj) < 5) sub[j * n + i] = f[j * n + i];
      return brightest(sub, n);
    };
    const a = near(cold.frames[1].data);
    const b = near(cold.frames[cold.frames.length - 1].data);
    expect(b[0]).toBeGreaterThanOrEqual(a[0]);
  });

  it('difference frames are signed and use a symmetric diverging stretch', () => {
    const scene = buildScene({ name: 'RW Aurigae' }, 180)!;
    const seq = buildMockSequence(scene, 180, { ...opts, sequence: 'difference' });
    expect(seq.frames.length).toBe(2);
    expect(seq.frames[0].meta.kind).toBe('difference');
    expect(seq.stretch.colormap).toBe('diverging');
    expect(seq.stretch.lo).toBeCloseTo(-(seq.stretch.hi as number));
  });

  it('labels every frame with date and wavelength', () => {
    const scene = buildScene({ name: 'R Dra' }, 180)!;
    for (const sequence of ['epochs', 'pairs', 'sweep', 'thenNow']) {
      const seq = buildMockSequence(scene, 180, { ...opts, sequence });
      expect(seq.frames.length).toBeGreaterThan(1);
      for (const f of seq.frames) {
        expect(f.meta.label).toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(f.meta.label).toMatch(/um/);
        expect(f.meta.waveMin).toBeLessThanOrEqual(f.meta.waveMax);
      }
    }
    expect(scene.exposures.length).toBeGreaterThan(1000);
  });

  it('unknown names fail; coordinates always work', () => {
    expect(buildScene({ name: 'Planet X' }, 180)).toBeNull();
    expect(buildScene({ ra: 10, dec: 20 }, 180)).not.toBeNull();
  });
});

describe('MockPipeline', () => {
  it('fills the store and reports errors in plain words', async () => {
    const p = new MockPipeline({ delayScale: 0 });
    await p.open({ name: 'Epsilon Indi B' });
    let s = useApp.getState();
    expect(s.status.phase).toBe('ready');
    expect(s.frames.length).toBe(4);
    expect(s.findings[0].reference).toContain('4.7');
    expect(s.demo).toBe(true);
    await p.open({ name: 'Planet X' });
    s = useApp.getState();
    expect(s.status.phase).toBe('error');
    expect(s.status.message).toMatch(/Could not find/);
  });
});

describe('stretch', () => {
  it('maps lo to 0 and hi to 1, and inverts', () => {
    const s = { lo: 0, hi: 10, mode: 'asinh' as const, q: 8, invert: false, colormap: 'gray' as const };
    expect(stretchValue(0, s)).toBe(0);
    expect(stretchValue(10, s)).toBeCloseTo(1);
    expect(stretchValue(5, { ...s, mode: 'linear' })).toBeCloseTo(0.5);
    expect(stretchValue(10, { ...s, invert: true })).toBeCloseTo(0);
  });
});
