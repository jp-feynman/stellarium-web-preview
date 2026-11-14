// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check of the BlinkStage demo: renders every mode, saves screenshots to e2e/out/, checks
// orientation, overlays, hover / pick payloads and screenshot(), and fails on console errors.
// Usage: start `npx vite --port 5181` then `node e2e/blink-stage.mjs [baseUrl]`.
import { launchBrowser, openPage } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const base = process.argv[2] || 'http://localhost:5181';
const url = `${base}/demo/blink-stage.html`;

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function shot(page, name) {
  await settle(page);
  const el = await page.$('#stage');
  const path = join(outDir, `blink-stage-${name}.png`);
  await el.screenshot({ path });
  return path;
}

/** Mean RGB of a small box of the WebGL+overlay composite, via the stage's own screenshot(). */
async function sample(page, boxes) {
  return page.evaluate(async (boxes) => {
    const blob = await window.__blink.stage.screenshot();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return {
      type: blob.type,
      size: blob.size,
      width: bmp.width,
      values: boxes.map(([x, y, r]) => {
        const d = ctx.getImageData(x - r, y - r, 2 * r + 1, 2 * r + 1).data;
        const m = [0, 0, 0];
        for (let k = 0; k < d.length; k += 4) for (let q = 0; q < 3; q++) m[q] += d[k + q];
        const npx = d.length / 4;
        return m.map((v) => v / npx);
      }),
    };
  }, boxes);
}

const browser = await launchBrowser();
try {
  const { page, errors } = await openPage(browser, url, { width: 1280, height: 720 });
  await page.waitForFunction(() => window.__blinkReady === true, null, { timeout: 30000 });

  // Geometry: the stage is 640 x 640 (plus a 1 px border), 61 grid pixels -> 640/61 px per pixel.
  const n = 61;
  const p = 640 / n;
  const gx = (i) => (i + 0.5) * p; // screen x of grid column centre
  const gy = (j) => (n - 0.5 - j) * p; // screen y of grid row centre (row 0 at the bottom)
  const sc = await page.evaluate(() => {
    const s = window.__blink.scene;
    return { ne: s.northEastStar, mover: s.mover, nan: s.nanPatch, fader: s.fader };
  });

  // 1. Single frames 0..3.
  for (let k = 0; k < 4; k++) {
    await page.evaluate((k) => window.__blink.stage.setFrameIndex(k), k);
    await shot(page, `single-${k}`);
  }

  // Orientation: the north-east star must be bright in the top-left corner.
  await page.evaluate(() => window.__blink.stage.setFrameIndex(0));
  await settle(page);
  const [ni, nj] = sc.ne;
  const s0 = await sample(page, [[gx(ni), gy(nj), 1], [gx(n - 1 - ni), gy(n - 1 - nj), 1]]);
  check(s0.type === 'image/png' && s0.size > 1000, `screenshot() returns a PNG blob (${s0.type}, ${s0.size} bytes)`);
  check(s0.values[0][0] > 200, `north-east star is bright at top-left (mean R ${s0.values[0][0].toFixed(0)})`);
  check(s0.values[1][0] < 120, `mirror position (bottom-right) is not the star (mean R ${s0.values[1][0].toFixed(0)})`);

  // NaN hatch on frame 2 (patch) must differ from dark sky and show two shades.
  await page.evaluate(() => window.__blink.stage.setFrameIndex(2));
  await settle(page);
  const [i0, j0, i1, j1] = sc.nan;
  const ci = (i0 + i1) / 2;
  const cj = (j0 + j1) / 2;
  const s2 = await sample(page, [[gx(ci), gy(cj), 12]]);
  const hatch = s2.values[0];
  check(hatch[0] > 35 && hatch[0] < 110 && Math.abs(hatch[0] - hatch[2]) < 30, `NaN patch shows the neutral hatch (mean ${hatch.map((v) => v.toFixed(0)).join(',')})`);

  // 2. Overlay alignment: the mover circle is centred on the mover in each frame.
  for (let k = 0; k < 4; k++) {
    await page.evaluate((k) => window.__blink.stage.setFrameIndex(k), k);
    await settle(page);
    const [mi, mj] = sc.mover[k];
    const box = await page.$eval('#stage', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + e.clientLeft, y: r.top + e.clientTop }; });
    await page.mouse.move(box.x + gx(mi), box.y + gy(mj));
    const h = await page.evaluate(() => window.__blink.last().hover);
    check(h && h.i === mi && h.j === mj && h.overlay && h.overlay.id === `mover-${k}` && h.frameIndex === k,
      `frame ${k}: hover on the mover gives i=${h?.i} j=${h?.j} overlay=${h?.overlay?.id} value=${h?.value?.toFixed?.(2)}`);
  }
  // Hover over the no-data patch reports NaN (not zero).
  await page.evaluate(() => window.__blink.stage.setFrameIndex(2));
  const box = await page.$eval('#stage', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + e.clientLeft, y: r.top + e.clientTop }; });
  await page.mouse.move(box.x + gx(ci), box.y + gy(cj));
  const hn = await page.evaluate(() => { const h = window.__blink.last().hover; return h && { v: String(h.value), ra: h.ra, dec: h.dec }; });
  check(hn && hn.v === 'NaN', `hover on no-data patch gives value ${hn?.v}`);
  // Pick (click without drag).
  await page.mouse.click(box.x + gx(sc.fader[0]), box.y + gy(sc.fader[1]));
  const pk = await page.evaluate(() => window.__blink.last().pick);
  check(pk && pk.overlay && pk.overlay.id === 'fader', `click on the fader picks overlay ${pk?.overlay?.id}`);
  await page.mouse.move(box.x + 700, box.y + 300);

  // 3. Difference (last minus first): a dipole at the mover: negative (blue) where it was, positive (red) where it is.
  await page.evaluate(() => { window.__blink.stage.setFrameIndex(3); window.__blink.setMode('difference'); });
  await shot(page, 'difference');
  const sd = await sample(page, [[gx(sc.mover[0][0]), gy(sc.mover[0][1]), 1], [gx(sc.mover[3][0]), gy(sc.mover[3][1]), 1], [gx(10), gy(20), 3]]);
  const [was, now, bg] = sd.values;
  check(was[2] > was[0] + 60, `difference: old mover position is blue (${was.map((v) => v.toFixed(0))})`);
  check(now[0] > now[2] + 60, `difference: new mover position is red (${now.map((v) => v.toFixed(0))})`);
  check(Math.max(...bg) < 90, `difference: static sky is dark (${bg.map((v) => v.toFixed(0))})`);

  // 4. Blend halfway, RGB, colour maps, zoom.
  await page.evaluate(() => { window.__blink.setMode('blend'); window.__blink.stage.setFrameIndex(0); window.__blink.stage.setBlend(0.5); });
  await shot(page, 'blend');
  await page.evaluate(() => window.__blink.setMode('rgb'));
  await shot(page, 'rgb');
  const sr = await sample(page, [[gx(sc.mover[0][0]), gy(sc.mover[0][1]), 1], [gx(sc.mover[3][0]), gy(sc.mover[3][1]), 1], [gx(ni), gy(nj), 1]]);
  // Default RGB = longest, middle, shortest wavelength = frames 2, 0|3, 1 for the synthetic set.
  check(Math.abs(sr.values[2][0] - sr.values[2][1]) < 40 && sr.values[2][0] > 150, `rgb: a fixed star is white (${sr.values[2].map((v) => v.toFixed(0))})`);
  const moverCols = sr.values.slice(0, 2).map((c) => c.map((v) => v.toFixed(0)).join(','));
  check(sr.values[0].some((v, q) => Math.abs(v - sr.values[0][(q + 1) % 3]) > 40), `rgb: the mover is coloured (${moverCols.join(' | ')})`);

  await page.evaluate(() => { window.__blink.setMode('single'); window.__blink.stage.setFrameIndex(1); window.__blink.setStretch({ colormap: 'heat' }); });
  await shot(page, 'heat');
  await page.evaluate(() => window.__blink.setStretch({ colormap: 'viridis', mode: 'sqrt' }));
  await shot(page, 'viridis-sqrt');
  await page.evaluate(() => window.__blink.setStretch({ colormap: 'gray', mode: 'asinh' }));

  // Wheel zoom about the mover, then check that the overlay still sits on it.
  await page.evaluate(() => window.__blink.stage.setFrameIndex(1));
  await page.mouse.move(box.x + gx(sc.mover[1][0]), box.y + gy(sc.mover[1][1]));
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -120);
  await settle(page);
  const zoom = await page.evaluate(() => new Promise((r) => { const off = window.__blink.stage.on('view', (v) => { off(); r(v); }); window.__blink.stage.setView({}); window.__blink.stage.setView({ zoom: undefined }); setTimeout(() => r(null), 100); }));
  await page.mouse.move(box.x + gx(sc.mover[1][0]), box.y + gy(sc.mover[1][1]));
  const hz = await page.evaluate(() => window.__blink.last().hover);
  check(hz && hz.i === sc.mover[1][0] && hz.j === sc.mover[1][1] && hz.overlay?.id === 'mover-1', `zoomed: point under the cursor stays on the mover (i=${hz?.i} j=${hz?.j}, overlay ${hz?.overlay?.id})`);
  await page.mouse.move(box.x + 700, box.y + 300);
  await shot(page, 'zoomed');
  void zoom;

  // Drag to pan, then double-click to reset.
  await page.mouse.move(box.x + 320, box.y + 320);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 250, { steps: 5 });
  await page.mouse.up();
  await shot(page, 'panned');
  await page.mouse.dblclick(box.x + 320, box.y + 320);
  await page.mouse.move(box.x + 700, box.y + 300);
  await shot(page, 'reset');

  // Play: frames advance and emit 'frame'.
  const played = await page.evaluate(() => new Promise((r) => {
    const seen = [];
    const off = window.__blink.stage.on('frame', (f) => seen.push(f.frameIndex));
    window.__blink.stage.play(120);
    setTimeout(() => { window.__blink.stage.pause(); off(); r(seen); }, 700);
  }));
  check(played.length >= 3, `play(120) emitted frames ${played.join(',')}`);

  // Smooth (bilinear) sampling with the no-data patch: edges of the patch must stay hatched, not smeared.
  await page.evaluate(() => { window.__blink.stage.setFrameIndex(2); window.__blink.stage.setPixelated(false); window.__blink.stage.setView({ zoom: 3, centerRa: undefined }); });
  await shot(page, 'linear');
  await page.evaluate(() => { window.__blink.stage.setPixelated(true); window.__blink.stage.resetView(); });

  // Resize keeps the image square and centred.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.evaluate(() => { const el = document.getElementById('stage'); el.style.width = '400px'; el.style.height = '600px'; window.__blink.stage.setFrameIndex(0); });
  await page.waitForTimeout(300);
  await shot(page, 'resized');

  check(errors.length === 0, `no console errors (${errors.length}) ${errors.join(' | ')}`);

  // 5. No-WebGL fallback page.
  const fb = await openPage(browser, `${url}?nowebgl=1`, { width: 1280, height: 720 });
  await fb.page.waitForFunction(() => window.__blinkReady === true, null, { timeout: 30000 });
  await settle(fb.page);
  await fb.page.$('#stage').then((e) => e.screenshot({ path: join(outDir, 'blink-stage-nowebgl.png') }));
  const msg = await fb.page.$eval('#stage [role=status]', (e) => e.textContent);
  check(/WebGL/.test(msg || ''), `no-WebGL message shown: "${msg}"`);
  const fbBlob = await fb.page.evaluate(async () => (await window.__blink.stage.screenshot()).size);
  check(fbBlob > 1000, `no-WebGL: API still callable, screenshot ${fbBlob} bytes`);
  check(fb.errors.length === 0, `no-WebGL page: no console errors (${fb.errors.join(' | ')})`);
  // dispose() removes everything.
  const left = await fb.page.evaluate(() => { window.__blink.stage.dispose(); return document.getElementById('stage').children.length; });
  check(left === 0, `dispose() removes the stage DOM (${left} children left)`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall blink-stage checks passed');
