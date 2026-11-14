// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check of the Asteroid tab demo (demo/asteroid.html).
// Start a dev server first, e.g.  npx vite --port 5194 --strictPort
// then run  node e2e/asteroid.mjs [baseUrl]. Screenshots go to e2e/out/asteroid-*.png.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = process.argv[2] || 'http://localhost:5194';
const url = `${base}/demo/asteroid.html`;

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
// Composition words that must only appear after "consistent with" style hedging.
const FORBIDDEN = [/\bis made of\b/i, /\bcomposed of\b/i, /\bwe (?:have )?(?:discovered|detected)\b/i, /planet x (?:found|detected)/i];

async function run(browser, width, height, suffix, query = '', pick = null) {
  const { page, errors, context } = await openPage(browser, url + query, { width, height });
  await page.waitForSelector('[data-testid="asteroid-tab"] .rs-svg', { timeout: 30000 });
  if (pick) {
    await page.selectOption('[data-testid="asteroid-select"]', pick);
    await page.waitForFunction((p) => document.querySelector('.rs-cardhead h3')?.textContent?.toLowerCase().includes(p), pick, { timeout: 30000 });
  }
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${suffix}: page scrolls horizontally by ${overflow}px`);
  const info = await page.evaluate(() => ({
    svgs: document.querySelectorAll('[data-testid="asteroid-tab"] .rs-svg').length,
    marks: document.querySelectorAll('[data-testid="asteroid-tab"] .rs-mark').length,
    prov: document.querySelector('[data-testid="asteroid-provenance"]')?.textContent ?? '',
    verdict: document.querySelector('[data-testid="asteroid-verdict"]')?.textContent ?? '',
    text: document.body.innerText,
    legend: [...document.querySelectorAll('.rs-legend, .rs-legend *')].map((e) => e.textContent).join(' '),
  }));
  check(info.svgs >= 2, `${suffix}: expected two charts, got ${info.svgs}`);
  check(info.marks > 40, `${suffix}: expected data marks, got ${info.marks}`);
  check(/2026-11-14/.test(info.prov), `${suffix}: provenance line missing`);
  check(info.verdict.length > 10, `${suffix}: no classification statement`);
  check(!/DEMO/.test(info.text) || query.includes('sso=1'), `${suffix}: unexpected DEMO label on real data`);
  for (const re of FORBIDDEN) check(!re.test(info.text), `${suffix}: text matches ${re}`);
  check(/Lebofsky/.test(info.text) && /DeMeo/.test(info.text), `${suffix}: explainer citations missing`);
  check(errors.length === 0, `${suffix}: console errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: join(out, `asteroid-${suffix}.png`), fullPage: true });
  await context.close();
  return info;
}

const browser = await launchBrowser();
try {
  await run(browser, 1280, 900, '1280');
  await run(browser, 390, 844, '390');
  await run(browser, 1280, 900, '1280-dembowska', '', 'dembowska');
  await run(browser, 1280, 900, '1280-kollaa', '', 'kollaa');
  await run(browser, 390, 844, '390-ko', '?lang=ko&sso=1', 'eros');
  const sso = await run(browser, 1280, 900, '1280-sso', '?sso=1');
  check(/DEMO/.test(sso.text), 'sso demo: DEMO label missing');
  check(/2002 ET71/.test(sso.text), 'sso demo: SkyBoT objects not listed');
} finally {
  await browser.close();
}
if (failures.length) {
  console.error('asteroid e2e FAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('asteroid e2e: all checks passed');
