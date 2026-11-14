// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check for SkyGlobe: renders the demo at several fields of view, saves screenshots to
// e2e/out/sky-globe-*.png, tests picking, the channel switch and the offline fallback, and fails on
// console errors. Needs the dev server: npx vite --port 5182 --strictPort
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.SKY_GLOBE_URL || 'http://localhost:5182/demo/sky-globe.html';

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

async function settle(page, timeoutMs = 90000) {
  const t0 = Date.now();
  let st;
  for (;;) {
    st = await page.evaluate(() => window.__globe?.getStatus());
    if (st && st.tilesPending === 0 && (st.tilesLoaded > 0 || st.tilesFailed > 0)) break;
    if (Date.now() - t0 > timeoutMs) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__globe.getStatus());
}

const browser = await launchBrowser();
try {
  const views = [
    { name: 'allsky', q: 'ra=266.4&dec=-29&fov=100&ch=21', note: 'all-sky view (FOV 100) on the Galactic centre' },
    { name: 'fov30-orion', q: 'ra=83.8&dec=-1.2&fov=30&ch=21', note: 'FOV 30 on Orion' },
    { name: 'fov5-barnard', q: 'ra=269.45&dec=4.74&fov=5&ch=21', note: "FOV 5 on Barnard's Star" },
    { name: 'npole', q: 'ra=0&dec=80&fov=70&ch=21', note: 'north celestial pole (RA lines must converge)' },
    { name: 'fov30-cygnus-ch80', q: 'ra=305&dec=40&fov=30&ch=80', note: 'FOV 30 on Cygnus, channel 80' },
  ];
  for (const v of views) {
    const { page, errors, context } = await openPage(browser, `${BASE}?${v.q}`);
    const st = await settle(page);
    const file = join(OUT, `sky-globe-${v.name}.png`);
    await page.screenshot({ path: file });
    console.log(`     ${v.note}: order ${st.order}, ${st.visibleTiles} visible, ${st.tilesLoaded} loaded, ${st.tilesFailed} failed -> ${file}`);
    check(st.tilesLoaded > 0 && st.imageryAvailable, `${v.name}: imagery loaded`);
    check(errors.length === 0, `${v.name}: no console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await context.close();
  }

  // Picking a marker, the 'view' event, lookAt and the channel switch.
  {
    const { page, errors, context } = await openPage(browser, `${BASE}?ra=133.78&dec=-7.24&fov=20&ch=21`);
    await settle(page);
    const box = await page.locator('#globe canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2 + 3, box.y + box.height / 2 - 2);
    await page.waitForTimeout(300);
    const pickText = await page.textContent('#pick');
    check(/WISE 0855-0714/.test(pickText) && /RA 133\.[67]/.test(pickText), `click on a marker picks it: "${pickText}"`);
    // Drag: the sky point under the cursor must stay under the cursor (grab the sky).
    const readPick = async () => (await page.textContent('#pick')).match(/RA ([\d.]+)\S*\s+Dec ([+\u2212])([\d.]+)/);
    await page.mouse.click(box.x + 300, box.y + 300);
    await page.waitForTimeout(150);
    const p0 = await readPick();
    const before = await page.evaluate(() => window.__globe.getView());
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 380, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__globe.getView());
    check(after.ra > before.ra, `dragging the sky to the right brings eastern sky (higher RA) to the centre: ${before.ra.toFixed(2)} -> ${after.ra.toFixed(2)}`);
    await page.mouse.click(box.x + 500, box.y + 380);
    await page.waitForTimeout(150);
    const p1 = await readPick();
    const same = p0 && p1 && Math.abs(Number(p0[1]) - Number(p1[1])) < 0.02 && p0[2] === p1[2] && Math.abs(Number(p0[3]) - Number(p1[3])) < 0.02;
    check(same, `the grabbed sky point stays under the cursor (${p0?.[0]} vs ${p1?.[0]})`);
    const viewText = await page.textContent('#view');
    check(/FOV 20\.0/.test(viewText), `'view' event reaches the readout: "${viewText}"`);
    await page.evaluate(() => window.__globe.lookAt({ ra: 76.96, dec: 30.4 }, 8));
    await page.waitForTimeout(1200);
    const v2 = await page.evaluate(() => window.__globe.getView());
    check(Math.abs(v2.ra - 76.96) < 1e-6 && Math.abs(v2.fovDeg - 8) < 1e-6, `lookAt arrives at RW Aur, FOV 8 (got ${v2.ra.toFixed(3)}, ${v2.fovDeg.toFixed(2)})`);
    await page.evaluate(() => {
      const s = document.getElementById('channel');
      s.value = '90';
      s.dispatchEvent(new Event('input'));
    });
    const st = await settle(page);
    check(st.frame === 89 && st.tilesLoaded > 0, `channel 90 loads cube frame 89 (frame ${st.frame})`);
    await page.screenshot({ path: join(OUT, 'sky-globe-rwaur-ch90.png') });
    await page.evaluate(() => window.__globe.setChannel(51));
    await page.waitForTimeout(400);
    const st51 = await page.evaluate(() => window.__globe.getStatus());
    check(/no all-sky image/.test(st51.note), `blank channel 51 is explained: "${st51.note}"`);
    check(errors.length === 0, `interaction page: no console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await context.close();
  }

  // Offline: an unreachable tile server must leave the graticule, markers and a clear note.
  {
    const { page, context } = await openPage(browser, `${BASE}?ra=83.8&dec=-1.2&fov=60&ch=21&base=${encodeURIComponent('http://127.0.0.1:9/hips')}`);
    const st = await settle(page, 30000);
    await page.screenshot({ path: join(OUT, 'sky-globe-offline.png') });
    check(!st.imageryAvailable && /Sky imagery unavailable/.test(st.note), `offline note shown: "${st.note}"`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall sky-globe checks passed');
