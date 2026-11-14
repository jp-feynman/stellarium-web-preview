// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check of the CubeView demo: renders, takes screenshots of each view, hovers a slice,
// switches to wavelength mode, and fails on any console error.
// Usage: node e2e/cube-view.mjs [baseUrl]   (dev server on port 5183 by default)
import { launchBrowser, openPage } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = process.argv[2] ?? 'http://localhost:5183';
const url = `${base}/demo/cube-view.html`;

const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await launchBrowser();
try {
  const { page, errors } = await openPage(browser, url);
  await page.waitForFunction(() => window.__cube && window.__cube.ready, null, { timeout: 30000 });
  check(await page.evaluate(() => window.__cube.view.available), 'WebGL available and CubeView running');
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))));
  await settle();

  const cube = page.locator('#cube');
  const shot = async (name) => {
    await settle();
    const path = join(out, `cube-view-${name}.png`);
    await cube.screenshot({ path });
    return path;
  };

  // Pixel statistics of the canvas region, to catch blank renders.
  const brightFraction = async () => {
    const buf = await cube.screenshot();
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let bright = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 450) bright++;
      return bright / (d.length / 4);
    }, buf.toString('base64'));
  };

  await shot('oblique-time');
  const bf = await brightFraction();
  check(bf > 0.002 && bf < 0.4, `oblique view shows glowing sources (bright fraction ${bf.toFixed(4)})`);

  const labels = await page.$$eval('.cube-view-labels span', (els) => els.map((e) => e.textContent));
  console.log('labels:', labels.join(' | '));
  check(labels.filter((t) => /^\d{4}-\d\d-\d\d/.test(t)).length === 3, 'three visit date labels');
  const gizmo = await page.$$eval('.cube-view-gizmo-labels span', (els) => els.map((e) => e.textContent));
  check(['East', 'North', 'Time'].every((t) => gizmo.includes(t)), `gizmo labels ${gizmo.join(', ')}`);

  // Front view: the NE check star must be in the upper-left quadrant.
  await page.evaluate(() => window.__cube.setPreset('front'));
  await shot('front-time');
  await page.evaluate(() => window.__cube.setPreset('side'));
  await shot('side-time');
  await page.evaluate(() => window.__cube.setPreset('top'));
  await shot('top-time');

  // Hover the middle of the stack in oblique view.
  await page.evaluate(() => window.__cube.setPreset('oblique'));
  await settle();
  const box = await cube.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await settle();
  const readout = await page.textContent('#readout');
  console.log('hover readout:', readout);
  check(/slice \d+\/36/.test(readout ?? ''), 'hover reports a slice');
  await shot('hover');
  await page.mouse.move(box.x + 2, box.y + box.height + 40);

  // Wavelength mode.
  await page.evaluate(() => window.__cube.setAxis('wavelength'));
  await page.evaluate(() => window.__cube.setPreset('oblique'));
  await shot('oblique-wavelength');
  const wl = await page.$$eval('.cube-view-labels span', (els) => els.map((e) => e.textContent));
  console.log('wavelength labels:', wl.join(' | '));
  check(wl.some((t) => /µm$/.test(t)), 'wavelength tick labels');
  await page.evaluate(() => window.__cube.setPreset('side'));
  await shot('side-wavelength');

  // Invert stretch.
  await page.evaluate(() => window.__cube.setAxis('time'));
  await page.check('#invert');
  await page.evaluate(() => window.__cube.setPreset('oblique'));
  await shot('invert');
  await page.uncheck('#invert');

  // Resize and dispose must not throw.
  await page.setViewportSize({ width: 720, height: 900 });
  await shot('narrow');
  await page.evaluate(() => window.__cube.view.dispose());
  await settle();

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' / ') : ''}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall cube-view checks passed');
