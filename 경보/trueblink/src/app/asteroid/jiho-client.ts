/** Data and local job transport for the Python asteroid pipeline.
 * Scientific values remain in the pipeline's units and are never fed into the legacy mJy model.
 */
export const ASTEROID_WEB_SCHEMA = 'spherex-asteroid-web-1';

export interface Target {
  id: string;
  name: string;
  analysisTimestamp: string | null;
  nSpectralPoints: number | null;
  confidence: string | null;
  quality: string | null;
  detail: string;
}

export interface Catalog {
  schema: typeof ASTEROID_WEB_SCHEMA;
  generatedAt: string;
  targets: Target[];
}

export interface Result {
  schema: typeof ASTEROID_WEB_SCHEMA;
  id: string;
  record: Record<string, unknown>;
  coverage: { start: string | null; end: string | null };
  measuredCoverage?: { start: string | null; end: string | null };
  counts: { exposures: number | null; points: number | null; uniqueExposureIds?: number | null };
  validation: Record<string, unknown> | null;
  assets: {
    report?: string;
    observations?: string;
    spectrum?: string;
    components?: string;
    temporal?: string;
    plots: { kind: string; file: string }[];
  };
}

export interface Loaded<T> { data: T; url: string }
export interface Capabilities { available: boolean; reason?: string; code?: string; maxImages: number }
export interface JobInput { target: string; start: string; end: string; maxImages: number }
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface Job extends JobInput {
  id: string;
  status: JobStatus;
  logs: string[];
  error?: string;
  resultUrl?: string;
}
export interface StartedJob { id: string; status: JobStatus }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly id?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;
const JOB_STATUSES = new Set<JobStatus>(['queued', 'running', 'completed', 'failed', 'cancelled']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const documentUrl = () => new URL(document.baseURI);
export const catalogUrl = () => new URL('data/asteroid-analysis/index.json', documentUrl()).href;
export const apiBaseUrl = () => new URL('../api/asteroid-analysis/', documentUrl()).href;

function sameOrigin(url: URL): URL {
  const base = documentUrl();
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) {
    throw new Error('Asteroid data must use this site.');
  }
  return url;
}

function safeRelative(value: string, allowDirectories: boolean): void {
  let decoded: string;
  try { decoded = decodeURIComponent(value); }
  catch { throw new Error('Invalid asteroid data path.'); }
  if (!value || /[\\:?#\u0000-\u001f]/.test(decoded) || decoded.startsWith('/') || /%[0-9a-f]{2}/i.test(decoded)
    || decoded.split('/').some(part => !part || part === '.' || part === '..')
    || (!allowDirectories && decoded.includes('/'))) {
    throw new Error('Invalid asteroid data path.');
  }
}

/** Resolve a manifest entry inside its catalogue directory, including GitHub Pages subpaths. */
export function resolveResultUrl(detail: string, indexUrl: string): string {
  safeRelative(detail, true);
  const base = sameOrigin(new URL(indexUrl, documentUrl()));
  const url = sameOrigin(new URL(detail, base));
  const directory = new URL('./', base).pathname;
  if (!url.pathname.startsWith(directory)) throw new Error('Invalid asteroid result path.');
  return url.href;
}

/** Exported assets are filenames in the same directory as result.json. */
export function resolveAssetUrl(file: string, resultUrl: string): string {
  safeRelative(file, false);
  if (!/\.(png|csv|json|md)$/i.test(file)) throw new Error('Unsupported asteroid asset.');
  return sameOrigin(new URL(file, sameOrigin(new URL(resultUrl, documentUrl())))).href;
}

async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const target = sameOrigin(new URL(url, documentUrl())).href;
  const response = await fetch(target, { credentials: 'same-origin', redirect: 'error', ...init,
    headers: { Accept: 'application/json', ...init.headers } });
  const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '');
  const value: unknown = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = object(value) && typeof value.error === 'string' ? value.error
      : object(value) && typeof value.message === 'string' ? value.message : `Request failed (${response.status}).`;
    const id = object(value) && typeof value.id === 'string' && JOB_ID.test(value.id) ? value.id : undefined;
    throw new ApiError(error.slice(0, 1000), response.status, id);
  }
  if (!isJson || value === null) throw new ApiError('The server did not return asteroid data.', response.status);
  return value;
}

export async function getCatalog(signal?: AbortSignal): Promise<Loaded<Catalog>> {
  const url = catalogUrl();
  const value = await requestJson(url, { signal });
  if (!object(value) || value.schema !== ASTEROID_WEB_SCHEMA || !Array.isArray(value.targets)
    || value.targets.some(t => !object(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.detail !== 'string')) {
    throw new Error('The saved asteroid catalogue is not valid.');
  }
  for (const entry of value.targets as Target[]) resolveResultUrl(entry.detail, url);
  return { data: value as unknown as Catalog, url };
}

export async function getResult(address: string, signal?: AbortSignal): Promise<Loaded<Result>> {
  const url = sameOrigin(new URL(address, documentUrl())).href;
  const value = await requestJson(url, { signal });
  if (!object(value) || value.schema !== ASTEROID_WEB_SCHEMA || typeof value.id !== 'string' || !object(value.record)
    || !object(value.assets) || !Array.isArray(value.assets.plots) || !object(value.coverage) || !object(value.counts)) {
    throw new Error('The asteroid result is not valid.');
  }
  for (const name of ['report', 'observations', 'spectrum', 'components', 'temporal'] as const) {
    const asset = value.assets[name];
    if (asset !== undefined && (typeof asset !== 'string' || !resolveAssetUrl(asset, url))) throw new Error('Invalid asteroid asset.');
  }
  for (const plot of value.assets.plots) {
    if (!object(plot) || typeof plot.kind !== 'string' || typeof plot.file !== 'string') throw new Error('Invalid asteroid plot.');
    resolveAssetUrl(plot.file, url);
  }
  return { data: value as unknown as Result, url };
}

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  try {
    const value = await requestJson(new URL('capabilities', apiBaseUrl()).href, { signal });
    if (!object(value) || typeof value.available !== 'boolean') return { available: false, maxImages: 360 };
    return { available: value.available, reason: typeof value.reason === 'string' ? value.reason : undefined,
      code: typeof value.code === 'string' ? value.code : undefined,
      maxImages: typeof value.maxImages === 'number' && Number.isInteger(value.maxImages) && value.maxImages > 0
        ? Math.min(value.maxImages, 360) : 360 };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return { available: false, maxImages: 360 };
  }
}

function jobUrl(id: string): string {
  if (!JOB_ID.test(id)) throw new Error('Invalid analysis job identifier.');
  return new URL(`jobs/${encodeURIComponent(id)}`, apiBaseUrl()).href;
}

export async function startJob(input: JobInput, signal?: AbortSignal): Promise<StartedJob> {
  const value = await requestJson(new URL('jobs', apiBaseUrl()).href, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  });
  if (!object(value) || typeof value.id !== 'string' || !JOB_ID.test(value.id) || !JOB_STATUSES.has(value.status as JobStatus)) {
    throw new Error('The server returned an invalid analysis job.');
  }
  storeJobId(value.id);
  return value as unknown as StartedJob;
}

export async function getJob(id: string, signal?: AbortSignal): Promise<Job> {
  try {
    const value = await requestJson(jobUrl(id), { signal, cache: 'no-store' });
    if (!object(value) || value.id !== id || !JOB_STATUSES.has(value.status as JobStatus) || !Array.isArray(value.logs)
      || value.logs.some(line => typeof line !== 'string')) throw new Error('The server returned an invalid analysis status.');
    if (typeof value.resultUrl === 'string') sameOrigin(new URL(value.resultUrl, documentUrl()));
    return value as unknown as Job;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && getStoredJobId() === id) storeJobId(null);
    throw error;
  }
}

export async function cancelJob(id: string, signal?: AbortSignal): Promise<StartedJob> {
  const value = await requestJson(jobUrl(id), { method: 'DELETE', signal });
  if (!object(value) || value.id !== id || !JOB_STATUSES.has(value.status as JobStatus)) {
    throw new Error('The server returned an invalid cancellation status.');
  }
  return value as unknown as StartedJob;
}

function storageKey(): string { return `trueblink.asteroid.job.v1:${new URL(apiBaseUrl()).pathname}`; }
export function getStoredJobId(): string | null {
  try {
    const value = sessionStorage.getItem(storageKey());
    if (value && JOB_ID.test(value)) return value;
    if (value) sessionStorage.removeItem(storageKey());
  } catch { /* Storage may be unavailable in private or embedded browser contexts. */ }
  return null;
}
export function storeJobId(id: string | null): void {
  try {
    if (id && JOB_ID.test(id)) sessionStorage.setItem(storageKey(), id);
    else sessionStorage.removeItem(storageKey());
  } catch { /* A blocked storage API must not prevent local analysis. */ }
}
