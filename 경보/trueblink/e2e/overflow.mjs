// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Which elements stick out past the viewport? Usage: node e2e/overflow.mjs <url-with-hash> <width> [tabId]
import { launchBrowser } from './browser.mjs';
const [url, w = '1280', tab] = process.argv.slice(2);
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: Number(w), height: 860 } })).newPage();
await page.goto(url, { waitUntil: 'load' });
for (let k = 0; k < 120; k++) {
  await page.waitForTimeout(500);
  if (await page.evaluate(() => window.__trueblinkMeasureMs !== undefined)) break;
}
if (tab) {
  await page.locator(`#rtab-${tab}`).click();
  await page.waitForTimeout(2500);
}
const res = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 40)} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
  }
  return { vw, scroll: document.documentElement.scrollWidth, out: out.slice(0, 15) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
