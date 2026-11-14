import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, apiBaseUrl, cancelJob, catalogUrl, getCapabilities, getCatalog, getJob, getResult,
  getStoredJobId, resolveAssetUrl, resolveResultUrl, startJob, storeJobId,
} from '../src/app/asteroid/jiho-client';

const schema = 'spherex-asteroid-web-1';
const storage = new Map<string, string>();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const result = {
  schema, id: '433', record: { origin: 'OBSERVED', diameter_km: null, mass_kg: 'Unknown' },
  coverage: { start: '2026-02-01', end: '2026-02-21' }, counts: { exposures: 218, points: 160 },
  validation: null, assets: { report: 'report.md', spectrum: 'spectrum.csv', plots: [{ kind: 'spectrum', file: 'spectrum.png' }] },
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('document', { baseURI: 'https://user.github.io/space-lab/analysis/index.html?ra=42' });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('saved asteroid data routing', () => {
  it('keeps catalogue, result and assets under the Pages project subpath', () => {
    expect(catalogUrl()).toBe('https://user.github.io/space-lab/analysis/data/asteroid-analysis/index.json');
    const url = resolveResultUrl('433/result.json', catalogUrl());
    expect(url).toBe('https://user.github.io/space-lab/analysis/data/asteroid-analysis/433/result.json');
    expect(resolveAssetUrl('spectrum.csv', url)).toBe('https://user.github.io/space-lab/analysis/data/asteroid-analysis/433/spectrum.csv');
    expect(apiBaseUrl()).toBe('https://user.github.io/space-lab/api/asteroid-analysis/');
  });

  it('uses a separate same-origin API on local previews', () => {
    vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:4174/analysis/' });
    expect(apiBaseUrl()).toBe('http://127.0.0.1:4174/api/asteroid-analysis/');
    expect(resolveAssetUrl('report.md', '/api/asteroid-analysis/jobs/test-1/result.json'))
      .toBe('http://127.0.0.1:4174/api/asteroid-analysis/jobs/test-1/report.md');
  });

  it.each(['../other.json', '/outside.json', 'https://outside.invalid/x', '//outside.invalid/x', '%2e%2e/out.json', '%252e%252e/out.json', '433\\result.json', '433/result.json?x=1'])
    ('rejects escaping catalogue path %s', path => expect(() => resolveResultUrl(path, catalogUrl())).toThrow());

  it.each(['../spectrum.png', 'sub/spectrum.png', 'javascript:alert(1)', 'chart.svg', 'chart.png#x'])
    ('rejects invalid asset filename %s', path => expect(() => resolveAssetUrl(path, resolveResultUrl('433/result.json', catalogUrl()))).toThrow());

  it('preserves null results and the original scientific record without unit conversion', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...result, record: { ...result.record, flux_uJy: 2500 } }));
    vi.stubGlobal('fetch', fetch);
    const loaded = await getResult(resolveResultUrl('433/result.json', catalogUrl()));
    expect(loaded.data.record).toMatchObject({ diameter_km: null, mass_kg: 'Unknown', flux_uJy: 2500 });
    expect(loaded.url).toContain('/space-lab/analysis/data/asteroid-analysis/433/result.json');
  });

  it('keeps measured coverage and unique exposure counts distinct from search results', async () => {
    const value = { ...result, measuredCoverage: { start: '2026-02-13', end: '2026-02-15' },
      counts: { exposures: 218, points: 160, uniqueExposureIds: 75 },
      assets: { ...result.assets, observations: 'observations.csv', plots: [{ kind: 'sky-track', file: 'sky_track.png' }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
    const loaded = await getResult(resolveResultUrl('433/result.json', catalogUrl()));
    expect(loaded.data.measuredCoverage).toEqual(value.measuredCoverage);
    expect(loaded.data.coverage).toEqual(result.coverage);
    expect(loaded.data.counts).toEqual(value.counts);
    expect(loaded.data.assets.observations).toBe('observations.csv');
    expect(loaded.data.assets.plots[0].kind).toBe('sky-track');
  });

  it('validates manifest paths before presenting a selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ schema, generatedAt: 'today', targets: [{ id: '433', name: 'Eros', detail: '../../wrong.json' }] })));
    await expect(getCatalog()).rejects.toThrow(/path/);
  });

  it('rejects HTML fallback responses and invalid result asset URLs', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(json({ ...result, assets: { plots: [{ kind: 'spectrum', file: 'https://outside.invalid/a.png' }] } }));
    vi.stubGlobal('fetch', fetch);
    await expect(getResult('data/asteroid-analysis/433/result.json')).rejects.toThrow(/did not return/);
    await expect(getResult('data/asteroid-analysis/433/result.json')).rejects.toThrow(/path/);
  });
});

describe('local asteroid jobs', () => {
  it('makes missing static-host API unavailable without failing saved results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));
    await expect(getCapabilities()).resolves.toEqual({ available: false, maxImages: 360 });
  });

  it('preserves capability reason codes for an actionable localized notice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ available: false, code: 'python_unavailable', reason: 'Install the Python environment.', maxImages: 360 })));
    await expect(getCapabilities()).resolves.toMatchObject({ available: false, code: 'python_unavailable', maxImages: 360 });
  });

  it('does not hide cancellation when probing capabilities', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(getCapabilities(controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  });

  it('submits JSON and remembers the returned job for remounts', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'job-433', status: 'queued' }, 202));
    vi.stubGlobal('fetch', fetch);
    const input = { target: '433', start: '2026-02-01', end: '2026-02-21', maxImages: 120 };
    await expect(startJob(input)).resolves.toEqual({ id: 'job-433', status: 'queued' });
    expect(fetch).toHaveBeenCalledWith('https://user.github.io/space-lab/api/asteroid-analysis/jobs', expect.objectContaining({
      method: 'POST', body: JSON.stringify(input), credentials: 'same-origin', redirect: 'error',
    }));
    expect(getStoredJobId()).toBe('job-433');
  });

  it('exposes an existing job id when the single worker is occupied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'An analysis is already running.', id: 'active-1' }, 409)));
    try {
      await startJob({ target: '433', start: '2026-02-01', end: '2026-02-21', maxImages: 120 });
      expect.fail('Expected a conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, id: 'active-1' });
    }
  });

  it('drops stale session state after a server restart', async () => {
    storeJobId('old-job');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Unknown job.' }, 404)));
    await expect(getJob('old-job')).rejects.toMatchObject({ status: 404 });
    expect(getStoredJobId()).toBeNull();
  });

  it('passes abort signals through polling and supports cancellation', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'job-1', status: 'running', logs: ['Downloading'], target: '433', start: '', end: '', maxImages: 5 }))
      .mockResolvedValueOnce(json({ id: 'job-1', status: 'cancelled' }));
    vi.stubGlobal('fetch', fetch);
    await expect(getJob('job-1', controller.signal)).resolves.toHaveProperty('status', 'running');
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal, cache: 'no-store' });
    await expect(cancelJob('job-1')).resolves.toHaveProperty('status', 'cancelled');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  it('rejects invalid job identifiers and external result links', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'job-1', status: 'completed', logs: [], resultUrl: 'https://outside.invalid/result.json' }));
    vi.stubGlobal('fetch', fetch);
    await expect(getJob('../other')).rejects.toThrow(/identifier/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(getJob('job-1')).rejects.toThrow(/this site/);
  });

  it('keeps working when browser storage is blocked', async () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    expect(getStoredJobId()).toBeNull();
    expect(() => storeJobId('job-1')).not.toThrow();
    expect(() => storeJobId(null)).not.toThrow();
  });
});
