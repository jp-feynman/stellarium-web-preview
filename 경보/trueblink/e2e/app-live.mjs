// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Live end-to-end check of the real pipeline against the SPHEREx archive (the Vite dev proxy relays /api/sia).
// Usage: node e2e/app-live.mjs [baseUrl=http://localhost:5190/] [onlyKey]
// For each target: open the hash, wait until loading finishes (or 150 s), screenshot the viewer on the
// first and last frame and the whole page, collect console errors and timings. Writes e2e/out/app-live-*.png
// and e2e/out/app-live-report.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = (process.argv[2] || 'http://localhost:5190/').replace(/\/?$/, '/');
const only = process.argv[3];
const LIMIT_MS = Number(process.env.LIVE_LIMIT_MS || 150000);

const CASES = [
  { key: 'barnard', hash: "#name=Barnard's Star" },
  { key: 'wise0855', hash: '#name=WISE 0855-0714&band=cold' },
  { key: 'rwaur', hash: '#name=RW Aurigae' },
  { key: 'epsindb', hash: '#name=Epsilon Indi B' },
  { key: 'rdra', hash: '#name=R Draconis' },
  { key: 'coords', hash: '#ra=180.0&dec=2.0' },
  { key: 'wisebrief', hash: '#ra=133.79513&dec=-7.24515' },
];

async function state(page) {
  return page.evaluate(() => {
    const st = document.querySelector('[data-testid="status"]');
    const badge = document.querySelector('[data-testid="frame-badge"]');
    const notices = [...document.querySelectorAll('[data-testid="notices"] li')].map((li) => li.textContent);
    return {
      phase: st?.getAttribute('data-phase') ?? (st?.classList.contains('error') ? 'error' : null),
      status: st?.textContent ?? '',
      badge: badge?.textContent ?? '',
      notices,
      timing: window.__trueblink ?? null,
    };
  });
}

const browser = await launchBrowser();
const report = [];
let failures = 0;
for (const c of CASES) {
  if (only && c.key !== only) continue;
  const url = `${base}${c.hash.replace(/ /g, '%20')}`;
  const t0 = Date.now();
  const { page, errors, context } = await openPage(browser, url, { width: 1280, height: 900 });
  let s = await state(page);
  let firstFrameMs = null;
  while (Date.now() - t0 < LIMIT_MS) {
    await page.waitForTimeout(1000);
    s = await state(page);
    if (firstFrameMs === null && s.badge) firstFrameMs = Date.now() - t0;
    if (s.phase === 'ready' || s.phase === 'error' || (s.phase === 'idle' && s.timing?.done)) break;
  }
  const doneMs = Date.now() - t0;
  // Stop playback so screenshots are deterministic.
  await page.evaluate(() => document.querySelector('[data-testid="viewer-canvas"]')?.focus());
  await page.keyboard.press('1').catch(() => {});
  await page.waitForTimeout(600);
  const viewer = page.locator('.stage-wrap');
  const shots = [];
  if (await viewer.count()) {
    const p1 = join(out, `app-live-${c.key}-first.png`);
    await viewer.screenshot({ path: p1 });
    shots.push(p1);
    const badgeFirst = (await state(page)).badge;
    // Last frame: step back one from the first (wraps around).
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(600);
    const p2 = join(out, `app-live-${c.key}-last.png`);
    await viewer.screenshot({ path: p2 });
    shots.push(p2);
    s.badgeFirst = badgeFirst;
    s.badgeLast = (await state(page)).badge;
  }
  const p3 = join(out, `app-live-${c.key}-page.png`);
  await page.screenshot({ path: p3, fullPage: true });
  shots.push(p3);
  const row = {
    key: c.key,
    hash: c.hash,
    phase: s.phase,
    status: s.status,
    badgeFirst: s.badgeFirst,
    badgeLast: s.badgeLast,
    notices: s.notices,
    firstFrameMs,
    doneMs,
    timing: s.timing
      ? {
          source: s.timing.source,
          searchMs: s.timing.searched ? Math.round(s.timing.searched - s.timing.t0) : null,
          firstFrameMs: s.timing.firstFrame ? Math.round(s.timing.firstFrame - s.timing.t0) : null,
          doneMs: s.timing.done ? Math.round(s.timing.done - s.timing.t0) : null,
          loaded: s.timing.loaded,
          total: s.timing.total,
          failed: s.timing.failed,
        }
      : null,
    errors: errors.filter((e) => !/favicon/.test(e)).slice(0, 10),
    shots,
  };
  if (row.phase !== 'ready') failures++;
  report.push(row);
  console.log(JSON.stringify(row, null, 1));
  await context.close();
}
await browser.close();
writeFileSync(join(out, 'app-live-report.json'), JSON.stringify(report, null, 2));
console.log(failures ? `app-live: ${failures} target(s) did not reach ready` : 'app-live: all targets reached ready');
process.exit(0);
