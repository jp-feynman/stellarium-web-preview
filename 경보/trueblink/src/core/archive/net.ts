// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Small fetch helper shared by core/archive and core/resolve: at most 4 parallel requests per host,
// a timeout, AbortSignal support, retry on "server busy" answers and clear error messages.
// No custom headers are added, so requests carry nothing that identifies the user or the project.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_PER_HOST = 4;
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

function hostOf(url: string): string {
  try {
    return new URL(url, 'http://local.invalid/').host;
  } catch {
    return url;
  }
}

async function acquire(host: string, signal?: AbortSignal): Promise<void> {
  if ((active.get(host) ?? 0) < MAX_PER_HOST) {
    active.set(host, (active.get(host) ?? 0) + 1);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const queue = waiting.get(host) ?? [];
    const go = (): void => {
      signal?.removeEventListener('abort', onAbort);
      active.set(host, (active.get(host) ?? 0) + 1);
      resolve();
    };
    const onAbort = (): void => {
      const q = waiting.get(host);
      if (q) {
        const k = q.indexOf(go);
        if (k >= 0) q.splice(k, 1);
      }
      reject(abortError(signal));
    };
    queue.push(go);
    waiting.set(host, queue);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function release(host: string): void {
  active.set(host, Math.max(0, (active.get(host) ?? 1) - 1));
  const next = waiting.get(host)?.shift();
  if (next) next();
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  const e = new Error('Request was cancelled.');
  e.name = 'AbortError';
  return e;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetchTextOptions {
  signal?: AbortSignal;
  /** Milliseconds before one attempt is abandoned (default 30 s). */
  timeoutMs?: number;
  /** Extra attempts after HTTP 502/503/504 or a network failure (default 2). */
  retries?: number;
  /** What the request is for, used at the start of error messages, e.g. "SPHEREx archive search". */
  what?: string;
  /** Replacement for the global fetch (tests). */
  fetch?: FetchLike;
  /** Accept these non-2xx statuses and return their body instead of throwing. */
  acceptStatus?: number[];
}

/** GET a URL as text. Rejects with a readable Error; rejects with the abort reason when cancelled. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<{ status: number; text: string }> {
  const { signal, timeoutMs = 30000, retries = 2, what = 'Request', acceptStatus = [] } = opts;
  const doFetch: FetchLike = opts.fetch ?? ((u, init) => fetch(u, init));
  const host = hostOf(url);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    if (attempt > 0) await sleep(800 * 2 ** (attempt - 1), signal);
    await acquire(host, signal);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = (): void => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      // The caller may have aborted while this request waited for a free slot.
      if (signal?.aborted) throw abortError(signal);
      const res = await doFetch(url, { signal: ctrl.signal, method: 'GET' });
      const text = await res.text();
      if (res.ok || acceptStatus.includes(res.status)) return { status: res.status, text };
      const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      lastError = new Error(`${what} failed: HTTP ${res.status}${snippet ? ` (${snippet})` : ''} from ${host}.`);
      if (![502, 503, 504].includes(res.status)) throw lastError;
    } catch (err) {
      if (signal?.aborted) throw abortError(signal);
      if (err === lastError) throw err;
      lastError = timedOut
        ? new Error(`${what} timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${host}.`)
        : new Error(`${what} could not reach ${host}: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      release(host);
    }
  }
  throw lastError ?? new Error(`${what} failed.`);
}
