// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Offline-from-relay check of the production build, served from a sub-path by a plain static server
// (so /api/sia answers 404, as on a host without the relay function).
// Usage:
//   npx vite build --outDir /some/dir/tb && python3 -m http.server 5196 --bind 127.0.0.1 --directory /some/dir
//   node e2e/app-offline.mjs http://127.0.0.1:5196/tb/
// The five challenge targets must open from their saved list and pixel bundle with a calm notice;
// typed coordinates must give a friendly error that offers the five targets. Screenshots: e2e/out/offline-*.png
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = (process.argv[2] || 'http://127.0.0.1:5196/tb/').replace(/\/?$/, '/');
const origin = new URL(base).origin;
const browser = await launchBrowser();
const cases = [
  ['barnard', "#name=Barnard's%20Star", 'ready'],
  ['wise0855', '#name=WISE%200855-0714', 'ready'],
  ['rwaur', '#name=RW%20Aurigae', 'ready'],
  ['epsindb', '#name=Epsilon%20Indi%20B', 'ready'],
  ['rdra', '#name=R%20Draconis', 'ready'],
  ['coords', '#ra=180&dec=2', 'error'],
  ['landing', '', null],
];
let failures = 0;
for (const [key, hash, want] of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  const hosts = new Set();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('request', (r) => {
    if (!r.url().startsWith(origin)) hosts.add(new URL(r.url()).host);
  });
  const t0 = Date.now();
  await page.goto(base + hash, { waitUntil: 'load' });
  let first = null;
  let st = null;
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(200);
    st = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="status"]');
      return {
        phase: s?.getAttribute('data-phase') ?? (s?.classList.contains('error') ? 'error' : null),
        text: s?.textContent ?? '',
        badge: document.querySelector('[data-testid="frame-badge"]')?.textContent ?? null,
        notices: [...document.querySelectorAll('[data-testid="notices"] li')].map((l) => l.textContent),
        presetButtons: s ? s.querySelectorAll('.preset-links button').length : 0,
        measured: window.__trueblinkMeasureMs,
        timing: window.__trueblink ?? null,
      };
    });
    if (first === null && st.badge) first = Date.now() - t0;
    if (!want && Date.now() - t0 > 4000) break;
    if (st.phase === 'error') break;
    if (st.phase === 'ready' && st.measured !== undefined) break;
  }
  const total = Date.now() - t0;
  await page.keyboard.press('1').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `offline-${key}.png`) });
  const ok = want === null ? errs.length === 0 : st.phase === want && (want !== 'error' || st.presetButtons === 5);
  if (!ok) failures++;
  console.log(
    JSON.stringify({
      key,
      ok,
      firstFrameMs: first,
      settledMs: total,
      phase: st.phase,
      status: st.text.slice(0, 300),
      notices: st.notices,
      listSource: st.timing?.source,
      loaded: st.timing?.loaded,
      planned: st.timing?.total,
      otherHosts: [...hosts],
      errors: [...new Set(errs)].slice(0, 6),
    }),
  );
  await ctx.close();
}
await browser.close();
console.log(failures ? `app-offline: ${failures} case(s) failed` : 'app-offline: all cases passed');
process.exit(failures ? 1 : 0);
