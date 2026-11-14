// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Network plumbing for reading SPHEREx files from the public S3 bucket: single-range GETs with a
// timeout, AbortSignal support, a few retries for transient S3 errors, and a per-host request queue.
// The bucket serves the same object under several host names, so spreading files over four of them
// lets a browser keep more connections open (browsers allow about six per host over HTTP/1.1).

/** Virtual-hosted S3 names that serve the same objects with CORS "*" (checked with curl, Nov 2026). */
export const S3_HOSTS: readonly string[] = [
  'nasa-irsa-spherex.s3.amazonaws.com',
  'nasa-irsa-spherex.s3.us-east-1.amazonaws.com',
  'nasa-irsa-spherex.s3.dualstack.us-east-1.amazonaws.com',
  'nasa-irsa-spherex.s3-external-1.amazonaws.com',
];

/** FNV-1a hash of a string, used to pick a host deterministically from the S3 key. */
function hashKey(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** HTTPS URL of an object in the nasa-irsa-spherex bucket. Without `shard` the host is chosen from the key. */
export function s3Url(s3Key: string, shard?: number): string {
  const key = s3Key.replace(/^\/+/, '');
  const n = S3_HOSTS.length;
  const idx = shard === undefined ? hashKey(key) % n : ((Math.floor(shard) % n) + n) % n;
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `https://${S3_HOSTS[idx]}/${path}`;
}

function abortError(signal?: AbortSignal): unknown {
  if (signal && signal.reason !== undefined) return signal.reason;
  return new DOMException('The request was aborted', 'AbortError');
}

/** True for errors caused by an AbortSignal (ours or the caller's). */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

/**
 * Concurrency limiter keyed by host name. Tasks beyond the limit wait in FIFO order; a waiting task
 * whose signal aborts leaves the queue at once without ever starting.
 */
export class RequestQueue {
  private active = new Map<string, number>();
  private waiting = new Map<string, { start: () => void; cancel: () => void }[]>();

  constructor(public perHost: number = 4) {}

  run<T>(host: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const start = () => {
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        this.active.set(host, (this.active.get(host) ?? 0) + 1);
        let p: Promise<T>;
        try {
          p = task();
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then(resolve, reject).finally(() => {
          this.active.set(host, (this.active.get(host) ?? 1) - 1);
          this.next(host);
        });
      };
      if ((this.active.get(host) ?? 0) < this.perHost) {
        start();
        return;
      }
      const entry = { start, cancel: () => reject(abortError(signal)) };
      const list = this.waiting.get(host) ?? [];
      list.push(entry);
      this.waiting.set(host, list);
      if (signal) {
        onAbort = () => {
          const l = this.waiting.get(host);
          const k = l ? l.indexOf(entry) : -1;
          if (l && k >= 0) {
            l.splice(k, 1);
            entry.cancel();
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private next(host: string): void {
    const l = this.waiting.get(host);
    if (!l || l.length === 0) return;
    if ((this.active.get(host) ?? 0) >= this.perHost) return;
    const e = l.shift();
    e?.start();
  }

  /** Requests running and waiting for one host (for progress displays and tests). */
  stats(host: string): { active: number; waiting: number } {
    return { active: this.active.get(host) ?? 0, waiting: this.waiting.get(host)?.length ?? 0 };
  }
}

export interface FetchSettings {
  /** Per-request timeout including the body download, ms. */
  timeoutMs: number;
  /** Extra attempts after a network error or HTTP 500/502/503/504. */
  retries: number;
}

/** Shared queue used by every S3 read in core/fits. Change `defaultQueue.perHost` to tune (max 6 in browsers). */
export const defaultQueue = new RequestQueue(4);
export const fetchSettings: FetchSettings = { timeoutMs: 30000, retries: 2 };

/** Run any async task under the shared per-host limit. */
export function withLimit<T>(host: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return defaultQueue.run(host, task, signal);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function oneAttempt(url: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort(abortError(signal));
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new DOMException('timeout', 'TimeoutError'));
  }, fetchSettings.timeoutMs);
  try {
    // Only the Range header: it is CORS-safelisted for a single range, so no preflight is needed,
    // and no identifying headers are sent.
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: ctrl.signal });
    if (r.status !== 206) {
      // 200 would mean the server ignored the range and is streaming the whole ~66 MB file.
      try {
        await r.body?.cancel();
      } catch {
        /* nothing to clean up */
      }
      const why =
        r.status === 200
          ? 'the server ignored the byte range (would send the whole file)'
          : r.status === 416
            ? 'the byte range lies beyond the end of the file'
            : r.status === 403 || r.status === 404
              ? 'the file was not found in the bucket (it may have been reprocessed under a new name)'
              : `HTTP ${r.status}`;
      const err = new Error(`SPHEREx S3 read failed: ${why} (bytes ${start}-${end} of ${url})`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length !== end - start + 1) {
      throw new Error(`SPHEREx S3 read returned ${buf.length} bytes, expected ${end - start + 1} (bytes ${start}-${end} of ${url})`);
    }
    return buf;
  } catch (e) {
    if (timedOut) throw new Error(`SPHEREx S3 read timed out after ${fetchSettings.timeoutMs / 1000} s (bytes ${start}-${end} of ${url})`);
    if (signal?.aborted) throw abortError(signal);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function retryable(e: unknown): boolean {
  if (isAbortError(e)) return false;
  const status = (e as { status?: number }).status;
  if (status !== undefined) return status === 500 || status === 502 || status === 503 || status === 504;
  // fetch() rejects with TypeError on network failures; timeouts are worth one more try too.
  return e instanceof TypeError || (e instanceof Error && e.message.includes('timed out'));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * GET bytes [start, end] (inclusive) of `url` with ONE Range header and require HTTP 206.
 * Never sends multi-range or suffix ranges. Goes through the shared per-host queue.
 */
export async function fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error(`invalid byte range ${start}-${end} for ${url}`);
  }
  const host = hostOf(url);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= fetchSettings.retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1), signal);
    try {
      return await defaultQueue.run(host, () => oneAttempt(url, start, end, signal), signal);
    } catch (e) {
      lastErr = e;
      if (!retryable(e)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`SPHEREx S3 read failed for ${url}`);
}
