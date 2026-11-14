// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check of the Research-mode components demo (demo/research.html).
// Start a dev server first, e.g.  npx vite --port 5185 --strictPort
// then run  node e2e/ui-research.mjs [baseUrl]. Screenshots go to e2e/out/research-*.png.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = process.argv[2] || 'http://localhost:5185';
const url = `${base}/demo/research.html`;

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

async function run(browser, width, height, suffix, query = '') {
  const { page, errors, context } = await openPage(browser, url + query, { width, height });
  await page.waitForSelector('.rs-svg', { timeout: 30000 });
  await page.waitForTimeout(600);

  // No horizontal page scroll at this width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${suffix}: page scrolls horizontally by ${overflow}px`);

  // Every chart drew an SVG with marks.
  const counts = await page.evaluate(() => ({
    svgs: document.querySelectorAll('.rs-svg').length,
    marks: document.querySelectorAll('.rs-mark').length,
    rows: document.querySelectorAll('.rs-tbody .rs-tr').length,
    flags: document.querySelectorAll('.rs-flag').length,
  }));
  check(counts.svgs >= 8, `${suffix}: expected at least 8 charts, got ${counts.svgs}`);
  check(counts.marks > 400, `${suffix}: expected many data marks, got ${counts.marks}`);
  check(counts.rows > 0 && counts.rows < 60, `${suffix}: table should render a window of rows, got ${counts.rows}`);
  check(counts.flags === 23, `${suffix}: expected 23 flag buttons, got ${counts.flags}`);

  await page.screenshot({ path: join(out, `research-full-${suffix}.png`), fullPage: true });
  for (const id of ['spectrum', 'coverage', 'lightcurve', 'ratio', 'table', 'motion', 'flags', 'provenance', 'asteroid']) {
    const el = await page.$(`#${id}`);
    if (el) await el.screenshot({ path: join(out, `research-${id}-${suffix}.png`) });
    else failures.push(`${suffix}: section #${id} missing`);
  }

  if (suffix === '1280') {
    // Tooltip on keyboard focus.
    await page.focus('#spectrum .rs-mark');
    const tip = await page.textContent('#spectrum .rs-tip').catch(() => null);
    check(!!tip && tip.includes('µm'), `tooltip on focus missing (${tip})`);
    await page.screenshot({ path: join(out, `research-tooltip-${suffix}.png`), clip: { x: 0, y: 0, width: 1280, height: 700 } });
    // Sorting the table by wavelength.
    await page.click('#table [role=columnheader]:nth-child(4) button');
    await page.waitForTimeout(200);
    const first = await page.textContent('#table .rs-tbody .rs-tr >> nth=0');
    check(!!first, 'table empty after sort');
    // Scroll the table to the end: windowing must still render the last rows.
    await page.$eval('#table .rs-tbody', (el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(200);
    const lastIdx = await page.$$eval('#table .rs-tbody .rs-tr', (rs) => Math.max(...rs.map((r) => Number(r.getAttribute('aria-rowindex')))));
    check(lastIdx === 3001, `last row index after scrolling is ${lastIdx}, expected 3001`);
    // Toggle log -> linear and flagged points.
    await page.click('text=Y scale: log');
    await page.click('text=Flagged points: shown');
    await page.waitForTimeout(200);
    await page.locator('#spectrum').screenshot({ path: join(out, `research-spectrum-linear-${suffix}.png`) });
  }

  check(errors.length === 0, `${suffix}: console errors: ${errors.join(' | ')}`);
  await context.close();
}

const browser = await launchBrowser();
try {
  await run(browser, 1280, 900, '1280');
  await run(browser, 390, 844, '390');
  await run(browser, 1280, 900, 'ko', '?lang=ko');
} finally {
  await browser.close();
}
if (failures.length) {
  console.error('FAIL\n' + failures.join('\n'));
  process.exit(1);
}
console.log('ui-research: all checks passed; screenshots in e2e/out/research-*.png');
