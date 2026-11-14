import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createSiteServer, listenOnAvailablePort, staticPath } from './serve.mjs';

test('static paths reject encoded traversal, Windows escapes and malformed URLs', () => {
  const root = resolve('dist');
  assert.equal(staticPath(root, '/planetarium/engine/app.wasm'), join(root, 'planetarium', 'engine', 'app.wasm'));
  for (const [path, status] of [['/%2e%2e/secret', 403], ['/a/../secret', 403], ['/a%5c..%5csecret', 400], ['/C:/Windows', 400], ['/bad%00file', 400], ['/%ZZ', 400]]) {
    assert.throws(() => staticPath(root, path), { status });
  }
});

test('combined site serves all entry paths and routes the analysis API to the existing relay', async () => {
  const temporaryRoot = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'sky-lab-server-'));
  const seen = [];
  const server = createSiteServer({
    webRoot: root,
    relay: async request => {
      const url = new URL(request.url);
      seen.push(url.pathname + url.search);
      return new Response('exposure rows', { headers: { 'Content-Type': 'text/csv' } });
    },
  });
  try {
    for (const directory of ['planetarium', 'analysis']) await mkdir(join(root, directory));
    await writeFile(join(root, 'index.html'), 'entrance');
    await writeFile(join(root, 'planetarium', 'index.html'), 'planetarium');
    await writeFile(join(root, 'analysis', 'index.html'), 'analysis');
    await writeFile(join(root, 'planetarium', 'engine.wasm'), Buffer.from([0, 97, 115, 109]));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [path, expected] of [['/', 'entrance'], ['/planetarium/', 'planetarium'], ['/analysis/', 'analysis']]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), expected);
    }
    const redirect = await fetch(base + '/analysis?mode=research', { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/analysis/?mode=research');
    const wasm = await fetch(base + '/planetarium/engine.wasm', { method: 'HEAD' });
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(wasm.headers.get('content-length'), '4');
    assert.equal(await wasm.text(), '');
    assert.equal((await fetch(base + '/missing.js')).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(base + '/analysis/api/sia?MAXREC=10')).text(), 'exposure rows');
    assert.equal(await (await fetch(base + '/api/sia?MAXREC=20')).text(), 'exposure rows');
    assert.deepEqual(seen, ['/api/sia?MAXREC=10', '/api/sia?MAXREC=20']);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    // Remove only this test's newly created directory below the resolved temporary root.
    const target = resolve(root);
    assert.ok(target.startsWith(temporaryRoot + sep) && target.split(sep).at(-1).startsWith('sky-lab-server-'));
    await rm(target, { recursive: true });
  }
});

test('the live handlers reject invalid archive requests and serve HiPS properties without upstream access', async () => {
  const server = createSiteServer();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/sia?url=https://example.com')).status, 400);
    assert.equal((await fetch(base + '/api/other')).status, 404);
    const properties = await fetch(base + '/hips/spherex/1/properties');
    assert.equal(properties.status, 200);
    assert.match(await properties.text(), /hips_order\s*=\s*5/);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
});

test('automatic startup serves on a free port without interrupting the occupied server', { timeout: 10000 }, async () => {
  const occupied = createServer((_req, res) => res.end('existing application'));
  const site = createServer((_req, res) => res.end('sky lab'));
  try {
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    const occupiedPort = occupied.address().port;
    const actualPort = await listenOnAvailablePort(site, { port: occupiedPort });

    assert.notEqual(actualPort, occupiedPort);
    assert.equal(actualPort, site.address().port);
    assert.equal(await (await fetch(`http://127.0.0.1:${actualPort}/`)).text(), 'sky lab');
    assert.equal(await (await fetch(`http://127.0.0.1:${occupiedPort}/`)).text(), 'existing application');
    assert.equal(occupied.listening, true);
  } finally {
    await Promise.all([site, occupied].map(server => new Promise(resolveClose => server.close(resolveClose))));
  }
});

test('an explicitly required port reports the conflict and leaves the existing server running', { timeout: 10000 }, async () => {
  const occupied = createServer((_req, res) => res.end('existing application'));
  const site = createServer((_req, res) => res.end('sky lab'));
  try {
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    const occupiedPort = occupied.address().port;

    await assert.rejects(listenOnAvailablePort(site, { port: occupiedPort, automatic: false }), { code: 'EADDRINUSE' });
    assert.equal(site.listening, false);
    assert.equal(await (await fetch(`http://127.0.0.1:${occupiedPort}/`)).text(), 'existing application');
  } finally {
    await Promise.all([site, occupied].map(server => new Promise(resolveClose => server.close(resolveClose))));
  }
});
