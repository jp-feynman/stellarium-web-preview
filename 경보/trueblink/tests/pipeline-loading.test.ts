// Scheduler regression tests: real pipeline, store and image processing; no archive/network access.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exposure, NativeCutout, SkyPos, TanSipWcs } from '../src/core/types';

const transport = vi.hoisted(() => ({
  search: vi.fn(),
  cutout: vi.fn(),
  preloadBundle: vi.fn(),
  bundleInfo: vi.fn(),
  bundledIds: vi.fn(),
  measure: vi.fn(),
  clearMeasurements: vi.fn(),
}));

vi.mock('../src/core/archive', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/archive')>(),
  searchExposuresDetailed: transport.search,
}));
vi.mock('../src/core/cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/cache')>(),
  getCutout: transport.cutout,
  preloadBundle: transport.preloadBundle,
  bundleInfo: transport.bundleInfo,
  bundledExposureIds: transport.bundledIds,
  cutoutSource: () => 'archive',
}));
vi.mock('../src/core/catalogs', () => ({
  gaiaCone: vi.fn().mockResolvedValue([]),
  externalFrame: vi.fn(),
  overlaysFromCatalog: () => [],
}));
vi.mock('../src/app/measure', () => ({
  runMeasurements: transport.measure,
  clearMeasurements: transport.clearMeasurements,
}));
vi.mock('../src/app/asteroid/overlays', () => ({ solarSystemOverlays: vi.fn().mockResolvedValue([]) }));

import { RealPipeline, initialLoadBudget } from '../src/app/pipeline';
import { PRESETS } from '../src/app/presets';
import { resetSession, session } from '../src/app/session';
import { useApp } from '../src/app/store';
import { planWindow } from '../src/core/frames';
import { channelAt, cubeChannelAt, waveAt, waveTables } from '../src/core/wave';
import { skyToPix } from '../src/core/wcs';

const CENTER: SkyPos = { ra: 10, dec: 0 };

function exposures(n: number, center: SkyPos = CENTER): Exposure[] {
  const h = (1020 * 6.15) / 3600;
  return Array.from({ length: n }, (_, k) => {
    // Three visits with all six detector bands. Input is deliberately grouped by date.
    const mjd = 60000 + Math.floor(k / 120) * 100 + (k % 120) * 0.01;
    return {
      id: `exposure-${k}`, obsId: `obs-${k}`, detector: (k % 6 + 1) as Exposure['detector'],
      collection: 'spherex_dr1', release: 'dr1', mjdStart: mjd, mjdEnd: mjd + 0.001, mjd,
      url: '', s3Key: `test/${k}.fits`, sRa: center.ra, sDec: center.dec,
      sRegion: [center.ra + h, center.dec - h, center.ra - h, center.dec - h,
        center.ra - h, center.dec + h, center.ra + h, center.dec + h],
      emMin: 0, emMax: 0, pipelineTag: 'test',
    };
  });
}

function cutout(e: Exposure, pos: SkyPos, fov: number, opts: { planes?: string[] }): NativeCutout {
  const scale = 6.15 / 3600;
  const wcs: TanSipWcs = { crval: [pos.ra, pos.dec], crpix: [1020.5, 1020.5],
    cd: [[-scale, 0], [0, scale]], naxis: [2040, 2040] };
  const win = planWindow(wcs, pos, fov)!;
  const [x, y] = skyToPix(wcs, pos.ra, pos.dec);
  const wave = waveAt(waveTables()[e.detector], x, y);
  const n = win.nx * win.ny;
  return {
    exposure: e,
    header: { wcs, detector: e.detector, obsId: e.obsId, mjdAvg: e.mjd,
      mjdBeg: e.mjdStart, mjdEnd: e.mjdEnd, exptime: 113.58, cards: {},
      layout: { url: e.url, imageDataOffset: 0, flagsHeaderOffset: 0 } },
    ...win,
    image: Float32Array.from({ length: n }, (_, k) => 10 + (k % 11) / 10),
    ...(opts.planes?.includes('FLAGS') ? { flags: new Int32Array(n) } : {}),
    ...(opts.planes?.includes('VARIANCE') ? { variance: new Float32Array(n).fill(0.01) } : {}),
    ...(opts.planes?.includes('ZODI') ? { zodi: new Float32Array(n).fill(0.2) } : {}),
    targetPix: [x, y], wavelength: wave.wavelength, bandwidth: wave.bandwidth,
    channel: channelAt(x, y), cubeChannel: cubeChannelAt(e.detector, x, y), omegaArcsec2: 6.15 ** 2,
  };
}

describe('initial load budget', () => {
  it('caps only the automatic download, including short and empty fields', () => {
    expect([0, 17, 48, 360, 1000].map((n) => initialLoadBudget(n))).toEqual([0, 17, 48, 48, 48]);
  });

  it('keeps available bundled pixels up to the existing safety cap', () => {
    expect(initialLoadBudget(360, 2)).toBe(48);
    expect(initialLoadBudget(360, 72)).toBe(72);
    expect(initialLoadBudget(1000, 600)).toBe(360);
    expect(initialLoadBudget(42, 72)).toBe(42);
  });
});

describe('RealPipeline progressive loading', () => {
  // One subscription for this suite; each open creates an independent, abortable run.
  const pipeline = new RealPipeline();
  let measuredSizes: number[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Use the scheduler's timer fallback so fake timers also control its paint yields.
    vi.stubGlobal('MessageChannel', undefined);
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request in scheduler test'); }));
    resetSession();
    useApp.getState().reset();
    useApp.setState({ uiMode: 'research', sequence: 'epochs', bandGroupId: 'all', balanced: true,
      fovArcsec: 60, overlaysOn: { gaia: false, flags: false, track: false, solarSystem: false } });
    vi.clearAllMocks();
    measuredSizes = [];
    transport.search.mockResolvedValue({ exposures: exposures(360), warnings: [] });
    transport.cutout.mockImplementation(async (e, p, f, o) => cutout(e, p, f, o));
    transport.preloadBundle.mockResolvedValue(0);
    transport.bundleInfo.mockReturnValue(undefined);
    transport.bundledIds.mockReturnValue([]);
    transport.measure.mockImplementation(async () => { measuredSizes.push(session.cutouts.size); });
  });

  afterEach(() => {
    pipeline.cancel();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function open(input = { ...CENTER }) {
    const opened = pipeline.open(input);
    await vi.runAllTimersAsync();
    await opened;
  }

  it('opens 48 of 360, preserves research planes and spreads the preview across visits and bands', async () => {
    await open();
    expect(useApp.getState().status).toMatchObject({ phase: 'ready', loaded: 48, total: 48, remaining: 312 });
    expect(transport.cutout).toHaveBeenCalledTimes(48);
    expect(session.cutouts.size).toBe(48);
    expect(useApp.getState().frames.length).toBeGreaterThan(0);
    for (const call of transport.cutout.mock.calls) expect(call[3].planes).toEqual(['FLAGS', 'VARIANCE', 'ZODI']);
    for (const visit of [0, 1, 2]) {
      const cuts = [...session.cutouts.values()].filter((c) => session.visitOf.get(c.exposure.id) === visit);
      expect(cuts).toHaveLength(16);
      expect(new Set(cuts.map((c) => c.exposure.detector))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    }
    expect(measuredSizes).toEqual([48]);
    await vi.runAllTimersAsync();
    expect(transport.cutout).toHaveBeenCalledTimes(48); // No hidden background download after ready.
  });

  it('loads every remaining exposure once and refreshes measurements after the additional batch', async () => {
    await open();
    pipeline.loadMore();
    pipeline.loadMore(); // Repeated clicks while busy must not duplicate work.
    await vi.runAllTimersAsync();
    expect(useApp.getState().status).toMatchObject({ phase: 'ready', loaded: 360, total: 360, remaining: 0 });
    const ids = transport.cutout.mock.calls.map((call) => call[0].id);
    expect(ids).toHaveLength(360);
    expect(new Set(ids).size).toBe(360);
    expect(session.cutouts.size).toBe(360);
    expect(measuredSizes).toEqual([48, 360]);
    pipeline.loadMore();
    await vi.runAllTimersAsync();
    expect(transport.cutout).toHaveBeenCalledTimes(360);
  });

  it('keeps a 72-exposure baked preview available without starting uncached exposures', async () => {
    const preset = PRESETS[0];
    const list = exposures(120, preset.target);
    const bundled = list.slice(-72).map((e) => e.id);
    transport.search.mockResolvedValue({ exposures: list, warnings: [] });
    transport.preloadBundle.mockResolvedValue(bundled.length);
    transport.bundleInfo.mockReturnValue({ generated: '2026-11-14T00:00:00Z' });
    transport.bundledIds.mockReturnValue(bundled);
    const opened = pipeline.open({ name: preset.id, live: true });
    await vi.runAllTimersAsync();
    await opened;
    expect(useApp.getState().status).toMatchObject({ phase: 'ready', loaded: 72, total: 72, remaining: 48 });
    expect(new Set(transport.cutout.mock.calls.map((call) => call[0].id))).toEqual(new Set(bundled));
    for (const call of transport.cutout.mock.calls) expect(call[3].planes).toEqual(['FLAGS']);
    expect(measuredSizes).toEqual([72]);
  });

  it('adds at most 360 exposures per explicit batch even when load-more is clicked twice while busy', async () => {
    transport.search.mockResolvedValue({ exposures: exposures(800), warnings: [] });
    await open();
    pipeline.loadMore();
    pipeline.loadMore();
    await vi.runAllTimersAsync();
    expect(useApp.getState().status).toMatchObject({ phase: 'ready', loaded: 408, total: 408, remaining: 392 });
    expect(transport.cutout).toHaveBeenCalledTimes(408);
    expect(new Set(transport.cutout.mock.calls.map((call) => call[0].id)).size).toBe(408);
    expect(measuredSizes).toEqual([48, 408]);
  });

  it('ignores late transport results after cancellation and starts no further downloads', async () => {
    const waiting: { resolve: (c: NativeCutout) => void; value: NativeCutout; signal: AbortSignal }[] = [];
    transport.cutout.mockImplementation((e, p, f, o) => new Promise<NativeCutout>((resolve) => {
      waiting.push({ resolve, value: cutout(e, p, f, o), signal: o.signal });
    }));
    const opened = pipeline.open(CENTER);
    await vi.waitFor(() => expect(waiting).toHaveLength(12));
    pipeline.cancel();
    expect(waiting.every((w) => w.signal.aborted)).toBe(true);
    const cancelledStatus = { ...useApp.getState().status };
    for (const w of waiting) w.resolve(w.value); // Simulate a transport that ignores AbortSignal.
    await vi.runAllTimersAsync();
    await opened;
    expect(session.cutouts.size).toBe(0);
    expect(session.exposureFrames.size).toBe(0);
    expect(useApp.getState().status).toEqual(cancelledStatus);
    expect(useApp.getState().status.phase).toBe('idle');
    expect(useApp.getState().status.remaining).toBe(360); // Includes the 12 cancelled in-flight requests.
    expect(transport.cutout).toHaveBeenCalledTimes(12);
    expect(transport.measure).not.toHaveBeenCalled();
    pipeline.loadMore();
    expect(transport.cutout).toHaveBeenCalledTimes(12);
  });
});
