// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// List failed (4xx/5xx) responses while a view loads. Usage: node e2e/net404.mjs <url-with-hash> [waitMs]
import { launchBrowser } from './browser.mjs';
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 200)}`); });
await page.goto(process.argv[2], { waitUntil: 'load' });
await page.waitForTimeout(Number(process.argv[3] ?? 15000));
console.log(JSON.stringify(bad, null, 1));
await browser.close();
