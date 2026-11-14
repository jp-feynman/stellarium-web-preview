import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAsteroidResult } from './asteroid-export.mjs';

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/api/asteroid-analysis';
const RESULT_MARKER = 'SPHEREX_WEB_RESULT=';
const MAX_IMAGES = 360;
const MAX_BODY = 8192;
const MAX_LOG_LINES = 100;
const MAX_LOG_WIDTH = 1200;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const ASSETS = new Set(['result.json', 'report.md', 'observations.csv', 'spectrum.csv', 'components.csv', 'temporal.json',
  'spectrum.png', 'separation.png', 'residuals.png', 'reference_comparison.png', 'sky_track.png']);
const MIME = { '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png' };

function json(res, status, value, extra = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...extra });
  res.end(JSON.stringify(value));
}

function loopback(address) {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

/** Host checking also prevents a remote page from reaching this service through DNS rebinding. */
export function isLocalAsteroidRequest(req, mutation = false) {
  if (!loopback(req.socket?.remoteAddress)) return false;
  let local;
  try { local = new URL(`http://${req.headers.host || ''}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || local.username || local.password || local.pathname !== '/') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).origin !== local.origin) return false; } catch { return false; }
  }
  // An Origin-less CLI request is allowed, but browser POSTs from another origin are not.
  if (mutation && req.headers['sec-fetch-mode'] === 'no-cors') return false;
  return true;
}

export function validateAsteroidJob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A JSON object is required.');
  const target = typeof value.target === 'string' ? value.target.trim() : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()+-]{0,79}$/u.test(target)) {
    throw new Error('Enter a known asteroid name or number (up to 80 characters).');
  }
  function date(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD.`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '2100-12-31') {
      throw new Error(`${name} must be a valid date between 1900 and 2100.`);
    }
    return value;
  }
  const start = date(value.start, 'Start date');
  const end = date(value.end, 'End date');
  if (end < start) throw new Error('End date must be on or after start date.');
  const maxImages = value.maxImages ?? 120;
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_IMAGES) throw new Error(`Maximum images must be an integer from 1 to ${MAX_IMAGES}.`);
  return { target, start, end, maxImages };
}

function bodyJson(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    req.resume();
    return Promise.reject(Object.assign(new Error('Use Content-Type: application/json.'), { status: 415 }));
  }
  if (Number(req.headers['content-length']) > MAX_BODY) {
    req.resume();
    return Promise.reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
  }
  return new Promise((resolveBody, rejectBody) => {
    let chunks = [], size = 0, done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort);
      if (error) { req.resume(); rejectBody(error); } else resolveBody(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_BODY) return finish(Object.assign(new Error('Request body is too large.'), { status: 413 }));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(Object.assign(new Error('Invalid JSON request.'), { status: 400 })); }
      chunks = [];
    };
    const onError = error => finish(error);
    const onAbort = () => finish(Object.assign(new Error('Request aborted.'), { status: 400 }));
    const timer = setTimeout(() => finish(Object.assign(new Error('Request body timed out.'), { status: 408 })), 10000);
    timer.unref?.();
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
  });
}

async function exists(path) { return access(path).then(() => true, () => false); }

/** Imports only: this does not run the pipeline or contact an archive. */
export async function probeAsteroidPython(projectRoot, { timeoutMs = 60000 } = {}) {
  const local = join(projectRoot, '.venv-asteroid', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const candidates = [];
  if (process.env.SPHEREX_PYTHON) candidates.push({ executable: process.env.SPHEREX_PYTHON, args: [] });
  else {
    if (await exists(local)) candidates.push({ executable: local, args: [] });
    candidates.push(...(process.platform === 'win32' ? [{ executable: 'py', args: ['-3'] }] : []), { executable: 'python', args: [] }, { executable: 'python3', args: [] });
  }
  const scienceRoot = join(projectRoot, '지호', 'spherex-asteroid-analysis');
  let reason = 'Python 3.11 or newer and the asteroid dependencies are required. Run npm run setup:asteroids.';
  for (const candidate of candidates) {
    const result = await new Promise(resolveProbe => {
      let stderr = '', settled = false, child;
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolveProbe(result); } };
      const timer = setTimeout(() => { child?.kill(); finish({ ok: false, error: 'Python dependency check timed out.' }); }, timeoutMs);
      timer.unref?.();
      try {
        child = spawn(candidate.executable, [...candidate.args, '-X', 'utf8', '-B', '-c',
          'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"; import numpy, scipy, pandas, astropy, astroquery, matplotlib, sklearn, sbpy, synphot, yaml, requests; from src.integration.pipeline import run_analysis; print("SPHEREX_READY")'],
        { cwd: scienceRoot, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', MPLBACKEND: 'Agg' }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-2000); });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-3000); });
        child.once('error', error => finish({ ok: false, error: error.code === 'ENOENT' ? 'Python executable was not found.' : error.message }));
        child.once('close', code => finish({ ok: code === 0 && stdout.includes('SPHEREX_READY'), error: stderr.trim().split('\n').at(-1) || 'Python dependency check failed.' }));
      } catch (error) { finish({ ok: false, error: error.message }); }
    });
    if (result.ok) return { available: true, ...candidate };
    reason = `${result.error} Run npm run setup:asteroids.`;
    // A configured interpreter or an existing dedicated environment is authoritative.
    if (process.env.SPHEREX_PYTHON || candidate.executable === local) break;
  }
  return { available: false, reason };
}

export function createAsteroidApi({ projectRoot = defaultProjectRoot, probePython, spawnProcess = spawn,
  exportResult = exportAsteroidResult, timeoutMs = 30 * 60 * 1000, maxJobs = 25 } = {}) {
  const root = resolve(projectRoot);
  const scienceRoot = join(root, '지호', 'spherex-asteroid-analysis');
  const jobsRoot = join(root, '.asteroid-jobs');
  const jobs = new Map();
  let activeJob = null, starting = false, closed = false, probe = null, probedAt = 0;
  async function capabilities() {
    if (!probe || Date.now() - probedAt > 30000) {
      probedAt = Date.now();
      probe = Promise.resolve().then(() => probePython ? probePython() : probeAsteroidPython(root))
        .catch(error => ({ available: false, reason: error.message }));
    }
    return probe;
  }
  function view(job) {
    return { id: job.id, status: job.status, target: job.target, start: job.start, end: job.end, maxImages: job.maxImages,
      createdAt: job.createdAt, finishedAt: job.finishedAt, logs: [...job.logs], ...(job.error ? { error: job.error } : {}),
      ...(job.status === 'completed' ? { resultUrl: `${PREFIX}/jobs/${job.id}/result.json` } : {}) };
  }
  function log(job, text) {
    const clean = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
    if (!clean) return;
    job.logs.push(clean.slice(0, MAX_LOG_WIDTH));
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
  function stop(job, status, reason) {
    if (!['queued', 'running'].includes(job.status)) return;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    if (reason) { job.error = reason; log(job, reason); }
    clearTimeout(job.timer);
    job.child?.kill('SIGTERM');
    // On Windows kill terminates the process; the second attempt bounds POSIX shutdown too.
    if (job.child) {
      job.killTimer = setTimeout(() => job.child?.kill('SIGKILL'), 2000);
      job.killTimer.unref?.();
    }
  }
  async function startJob(input, python) {
    while (jobs.size >= maxJobs) {
      const removable = [...jobs.values()].find(job => job.id !== activeJob && !['queued', 'running'].includes(job.status));
      if (!removable) break;
      jobs.delete(removable.id);
    }
    const id = randomUUID();
    const directory = join(jobsRoot, id);
    const output = join(directory, 'outputs');
    const bundle = join(directory, 'web');
    await mkdir(output, { recursive: true });
    if (closed) throw Object.assign(new Error('Analysis server is shutting down.'), { status: 503 });
    const job = { id, ...input, status: 'queued', createdAt: new Date().toISOString(), logs: [], directory, output, bundle, child: null };
    jobs.set(id, job);
    activeJob = id;
    const args = [...(python.args || []), '-X', 'utf8', '-u', '-B', join(scienceRoot, 'web_bridge.py'),
      '--target', input.target, '--start', input.start, '--end', input.end, '--max-images', String(input.maxImages),
      '--output-dir', output, '--db-path', join(directory, 'asteroids.sqlite')];
    let sourceDir = null, finished = false;
    const settle = async (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(job.timer); clearTimeout(job.killTimer);
      if (job.status === 'running' || job.status === 'queued') {
        if (!error && code === 0 && sourceDir) {
          try {
            const physicalOutput = await realpath(output);
            const physicalSource = await realpath(sourceDir);
            if (!physicalSource.startsWith(physicalOutput + sep)) throw new Error('Python returned an invalid result directory.');
            await exportResult({ sourceDir: physicalSource, destinationDir: bundle, id });
            if (job.status === 'running') { job.status = 'completed'; log(job, 'Analysis complete. Results are ready.'); }
          } catch (exportError) { if (job.status === 'running') { job.status = 'failed'; job.error = `Could not prepare results: ${exportError.message}`; log(job, job.error); } }
        } else {
          job.status = 'failed';
          job.error = error?.message || `Analysis process exited with code ${code ?? 'unknown'} without a complete result. See the progress log.`;
          log(job, job.error);
        }
      }
      job.finishedAt ||= new Date().toISOString();
      job.child = null;
      if (activeJob === id) activeJob = null;
    };
    try {
      job.child = spawnProcess(python.executable, args, { cwd: scienceRoot, shell: false, windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', MPLBACKEND: 'Agg' }, stdio: ['ignore', 'pipe', 'pipe'] });
      job.status = 'running';
      log(job, `Searching SPHEREx observations for ${input.target}: ${input.start} — ${input.end}.`);
      for (const stream of [job.child.stdout, job.child.stderr]) {
        let pending = '';
        const onLine = line => {
          if (stream === job.child?.stdout && line.startsWith(RESULT_MARKER)) {
            try {
              const candidate = JSON.parse(line.slice(RESULT_MARKER.length)).sourceDir;
              if (typeof candidate === 'string' && resolve(candidate).startsWith(resolve(output) + sep)) sourceDir = resolve(candidate);
            } catch { /* An invalid completion marker is treated as an incomplete job. */ }
          } else log(job, line);
        };
        stream?.setEncoding?.('utf8');
        stream?.on('data', chunk => {
          pending += chunk;
          const lines = pending.split(/\r?\n|\r/g);
          pending = lines.pop() || '';
          for (const line of lines) onLine(line);
          if (pending.length > 8192) { log(job, pending.slice(0, MAX_LOG_WIDTH)); pending = ''; }
        });
        stream?.on('end', () => { if (pending) onLine(pending); });
      }
      job.child.once('error', error => { void settle(null, error); });
      job.child.once('close', code => { void settle(code); });
      job.timer = setTimeout(() => stop(job, 'failed', 'Analysis exceeded the 30-minute limit. Try a shorter date range or fewer images.'), timeoutMs);
      job.timer.unref?.();
    } catch (error) { await settle(null, error); }
    return job;
  }
  async function handle(req, res, url) {
    const path = url.pathname.replace(/^\/analysis\/api(?=\/|$)/, '/api');
    if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return false;
    try {
      const route = path.slice(PREFIX.length);
      const mutation = !['GET', 'HEAD'].includes(req.method);
      const local = isLocalAsteroidRequest(req, mutation);
      if (route === '/capabilities' && req.method === 'GET') {
        if (!local || closed) json(res, 200, { available: false, code: closed ? 'server_stopped' : 'local_only', reason: 'New analyses are available only on this computer through the local web server.', maxImages: MAX_IMAGES });
        else {
          const state = await capabilities();
          json(res, 200, { available: !!state.available, code: state.available ? 'ready' : 'python_unavailable', ...(state.reason ? { reason: state.reason } : {}), maxImages: MAX_IMAGES,
            ...(activeJob ? { activeJobId: activeJob } : {}) });
        }
        return true;
      }
      if (!local) { json(res, 403, { error: 'This analysis API only accepts local, same-origin requests.' }); return true; }
      if (closed) { json(res, 503, { error: 'Analysis server is shutting down.' }); return true; }
      if (route === '/jobs' && req.method === 'POST') {
        const input = validateAsteroidJob(await bodyJson(req));
        if (activeJob || starting) { json(res, 409, { error: 'Another analysis is already running.', ...(activeJob ? { id: activeJob } : {}) }); return true; }
        starting = true;
        try {
          const python = await capabilities();
          if (!python.available) { json(res, 503, { error: python.reason || 'Python analysis is unavailable. Run npm run setup:asteroids.' }); return true; }
          if (closed) { json(res, 503, { error: 'Analysis server is shutting down.' }); return true; }
          const job = await startJob(input, python);
          json(res, 202, view(job));
        } finally { starting = false; }
        return true;
      }
      const match = /^\/jobs\/([a-f0-9-]{36})(?:\/([A-Za-z0-9_.-]+))?$/.exec(route);
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) { json(res, 404, { error: 'Analysis job not found. The local server may have restarted.' }); return true; }
        const asset = match[2];
        if (!asset && req.method === 'GET') { json(res, 200, view(job)); return true; }
        if (!asset && req.method === 'DELETE') { stop(job, 'cancelled', 'Analysis cancelled.'); json(res, 200, view(job)); return true; }
        if (asset && ['GET', 'HEAD'].includes(req.method)) {
          if (job.status !== 'completed' || !ASSETS.has(asset)) { json(res, 404, { error: 'Result asset not available.' }); return true; }
          const file = join(job.bundle, asset);
          const [physicalBundle, physicalFile, info] = await Promise.all([realpath(job.bundle), realpath(file), stat(file)]);
          if (!physicalFile.startsWith(physicalBundle + sep) || !info.isFile()) { json(res, 403, { error: 'Invalid result asset.' }); return true; }
          res.writeHead(200, { 'Content-Type': MIME[extname(asset)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
          if (req.method === 'HEAD') res.end();
          else createReadStream(file).on('error', () => res.destroy()).pipe(res);
          return true;
        }
        json(res, 405, { error: 'Method not allowed.' }); return true;
      }
      if (route === '/jobs' || route === '/capabilities') json(res, 405, { error: 'Method not allowed.' });
      else json(res, 404, { error: 'Unknown asteroid analysis endpoint.' });
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(res, error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : error.code ? 500 : 400), { error: error.message || 'Analysis request failed.' });
    }
    return true;
  }
  async function close() {
    closed = true;
    const waits = [];
    for (const job of jobs.values()) {
      if (job.child) waits.push(new Promise(resolveExit => {
        const timer = setTimeout(resolveExit, 3000); timer.unref?.();
        job.child.once('close', () => { clearTimeout(timer); resolveExit(); });
      }));
      stop(job, 'cancelled', 'Local server stopped.');
    }
    await Promise.all(waits);
  }
  return { handle, close };
}
