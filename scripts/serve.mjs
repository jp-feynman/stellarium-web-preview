import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { handleRequest } from '../경보/trueblink/scripts/relay.mjs';
import { handleHips } from '../경보/trueblink/scripts/hips-rewrite.mjs';
import { createAsteroidApi } from './asteroid-api.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoot = resolve(projectRoot, 'dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.wasm': 'application/wasm', '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip', '.xml': 'application/xml', '.gz': 'application/gzip', '.yml': 'text/plain; charset=utf-8',
};

export function staticPath(webRoot, rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch { throw Object.assign(new Error('Malformed path.'), { status: 400 }); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) throw Object.assign(new Error('Invalid path.'), { status: 400 });
  if (decoded.split('/').some(part => part === '..')) throw Object.assign(new Error('Forbidden path.'), { status: 403 });
  const base = resolve(webRoot);
  const path = resolve(base, decoded.replace(/^\/+/, ''));
  if (path !== base && !path.startsWith(base + sep)) throw Object.assign(new Error('Forbidden path.'), { status: 403 });
  return path;
}

function respond(res, status, text, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(text);
}

export function createSiteServer({ webRoot = defaultRoot, relay = handleRequest, hips = handleHips,
  asteroids = createAsteroidApi({ projectRoot }) } = {}) {
  const root = resolve(webRoot);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      // Check the raw path before URL normalizes dot segments.
      const requestPath = (req.url || '/').split('?')[0];
      staticPath(root, requestPath);
      const url = new URL(req.url || '/', 'http://localhost');
      const canonicalPath = url.pathname.replace(/^\/analysis\/api(?=\/|$)/, '/api');
      url.pathname = canonicalPath;
      if (await asteroids.handle(req, res, url)) return;
      const isApi = canonicalPath === '/api' || canonicalPath.startsWith('/api/');
      const isHips = canonicalPath === '/hips' || canonicalPath.startsWith('/hips/');
      if (isApi || isHips) {
        url.pathname = canonicalPath;
        const request = new Request(url, { method: req.method });
        const response = await (isApi ? relay(request) : hips(request, { mode: process.env.HIPS_MODE === 'stream' ? 'stream' : 'redirect' }));
        const headers = Object.fromEntries(response.headers);
        const bytes = response.body ? Buffer.from(await response.arrayBuffer()) : null;
        if (bytes) headers['Content-Length'] = String(bytes.length);
        res.writeHead(response.status, headers);
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, 'Only GET and HEAD are supported.', { Allow: 'GET, HEAD' });
      let path = staticPath(root, url.pathname);
      let info = await stat(path);
      if (info.isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          res.writeHead(308, { Location: url.pathname + '/' + url.search, 'Cache-Control': 'no-store' });
          return res.end();
        }
        path = resolve(path, 'index.html');
        info = await stat(path);
      }
      if (!info.isFile()) return respond(res, 404, 'Not found.');
      const physicalRoot = await realpath(root);
      const physicalPath = await realpath(path);
      if (physicalPath !== physicalRoot && !physicalPath.startsWith(physicalRoot + sep)) return respond(res, 403, 'Forbidden.');
      res.writeHead(200, { 'Content-Type': mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 502);
      respond(res, status, status === 404 ? 'Not found.' : status === 400 || status === 403 ? error.message : 'The request could not be completed. Please retry.');
    }
  });
  server.on('close', () => { void asteroids.close().catch(error => console.error('Asteroid worker cleanup:', error.message)); });
  return server;
}

// Try binding directly, rather than probing first: another process can take a
// port between a probe and listen(). An occupied port never requires stopping it.
export async function listenOnAvailablePort(server, { port = 4173, host = '127.0.0.1', automatic = true, onOccupied = () => {} } = {}) {
  const candidates = [port];
  if (automatic) {
    for (let offset = 1; offset < 20 && port + offset <= 65535; offset++) candidates.push(port + offset);
    candidates.push(0); // Let the OS choose when the nearby range is also occupied.
  }
  for (const candidate of candidates) {
    try {
      await new Promise((resolveListen, rejectListen) => {
        const cleanup = () => { server.off('error', onError); server.off('listening', onListening); };
        const onError = error => { cleanup(); rejectListen(error); };
        const onListening = () => { cleanup(); resolveListen(); };
        server.once('error', onError);
        server.once('listening', onListening);
        try { server.listen(candidate, host); }
        catch (error) { onError(error); }
      });
      return server.address().port;
    } catch (error) {
      if (!automatic || error.code !== 'EADDRINUSE' || candidate === 0) throw error;
      onOccupied(candidate);
    }
  }
  throw new Error('No available local port was found.');
}

export async function startSiteServer(args = process.argv.slice(2)) {
  const portIndex = args.indexOf('--port');
  const port = Number(portIndex < 0 ? (process.env.PORT || 4173) : args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --port with a number from 1 to 65535.');
  await stat(resolve(defaultRoot, 'index.html')).catch(() => { throw new Error('Run npm run build before preview.'); });
  const host = process.env.HOST || '127.0.0.1';
  const server = createSiteServer();
  const automatic = portIndex < 0 && !process.env.PORT;
  let actualPort;
  try {
    actualPort = await listenOnAvailablePort(server, { port, host, automatic,
      onOccupied: busyPort => console.log(`Port ${busyPort} is in use. Looking for an available port...`),
    });
  } catch (error) {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Run npm run preview without --port (and without PORT) to choose an available port automatically.`
      : error.message);
    process.exitCode = 1;
    return server;
  }
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
    const url = `http://${displayHost}:${actualPort}/`;
    console.log(`SPHEREx Sky Lab v2.3.1\nLocal: ${url}\nPlanetarium: ${url}planetarium/\nAnalysis: ${url}analysis/\nPress Ctrl+C to stop.`);
    if (args.includes('--open')) {
      const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const commandArgs = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const browser = spawn(executable, commandArgs, { detached: true, stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.log(`Open ${url} in your browser.`));
      browser.unref();
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await startSiteServer();
