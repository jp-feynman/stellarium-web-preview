// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Solar System markers in the ecliptic field: toggle "Known asteroids" in Research > Overlays and count
// the markers per sequence (window.__trueblinkOverlays). Usage: node e2e/sso-check.mjs [baseUrl]
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
const base = (process.argv[2] || 'http://localhost:5195/').replace(/\/?$/, '/');
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
await page.goto(base + '#ra=249.8816&dec=-22.3683&mode=research', { waitUntil: 'load' });
for (let k = 0; k < 240; k++) {
  await page.waitForTimeout(500);
  if (await page.evaluate(() => document.querySelector('[data-testid="status"]')?.getAttribute('data-phase') === 'ready')) break;
}
await page.locator('#rtab-overlays').click();
await page.locator('[data-testid="ov-solarSystem"]').check();
const res = [];
for (const seq of process.argv[3] ? process.argv[3].split(',') : ['epochs', 'pairs', 'sweep']) {
  await page.evaluate((s) => { const p = new URLSearchParams(location.hash.slice(1)); p.set('seq', s); location.hash = p.toString(); }, seq);
  await page.waitForTimeout(15000);
  const counts = await page.evaluate(() => window.__trueblinkOverlays);
  const warn = await page.evaluate(() => [...document.querySelectorAll('[data-testid="notices"] li')].map((l) => l.textContent));
  res.push({ seq, counts, warn });
  await page.screenshot({ path: join(out, `sso-${seq}.png`) });
  if (seq === 'epochs') {
    // Step through the three dates (blur the checkbox first so the keys reach the viewer).
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
    for (const k of ['1', '2', '3']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(700);
      await page.locator('.viewer-panel').first().screenshot({ path: join(out, `sso-epochs-frame${k}.png`) });
    }
  }
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
