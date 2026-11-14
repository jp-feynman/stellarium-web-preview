// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Extended end-to-end walk through the real app (dev server; Vite proxies /api/sia to IRSA).
// Usage: VITE_CACHE_DIR=node_modules/.vite-app npx vite --port 5195 --strictPort &
//        node e2e/app-full.mjs [baseUrl=http://localhost:5195/] [group...]
// Groups: targets, sequences, research, views, controls, edge, i18n, cold, overlays, visitor. Screenshots: e2e/out/full-*.png,
// report: e2e/out/app-full-report.json. Look at every screenshot; this script only checks basics.
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = (process.argv[2] || 'http://localhost:5195/').replace(/\/?$/, '/');
const groups = new Set(process.argv.slice(3));
const want = (g) => !groups.size || groups.has(g);

// Hangul font for the Korean screenshots (same trick as ui-shell.mjs; nothing is installed).
const malgun = '/mnt/c/Windows/Fonts/malgun.ttf';
if (!process.env.FONTCONFIG_FILE && existsSync(malgun) && existsSync('/etc/fonts/fonts.conf')) {
  const fontDir = join(out, 'fonts');
  mkdirSync(fontDir, { recursive: true });
  const link = join(fontDir, 'malgun.ttf');
  if (!existsSync(link)) symlinkSync(malgun, link);
  const conf = join(out, 'fonts.conf');
  writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${fontDir}</dir><cachedir>${join(out, 'fontcache')}</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = conf;
}

const browser = await launchBrowser();
const report = [];
const problems = [];

async function open(hash, viewport = { width: 1400, height: 950 }, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const t0 = Date.now();
  await page.goto(base + hash, { waitUntil: 'load' });
  return { page, context, errors, t0 };
}

async function state(page) {
  // A dev-server reload (HMR) destroys the context for a moment: retry instead of crashing the walk.
  for (let k = 0; ; k++) {
    try {
      return await stateOnce(page);
    } catch (e) {
      if (k >= 3) throw e;
      await page.waitForTimeout(1000);
    }
  }
}

async function stateOnce(page) {
  return page.evaluate(() => {
    const s = document.querySelector('[data-testid="status"]');
    return {
      phase: s?.getAttribute('data-phase') ?? (s?.classList.contains('error') ? 'error' : null),
      status: s?.textContent ?? '',
      badge: document.querySelector('[data-testid="frame-badge"]')?.textContent ?? null,
      notices: [...document.querySelectorAll('[data-testid="notices"] li')].map((l) => l.textContent),
      findings: [...document.querySelectorAll('[data-testid="findings"] li.finding')].map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').slice(0, 500)),
      result: document.querySelector('[data-testid="mission-result"]')?.textContent ?? null,
      chips: [...document.querySelectorAll('[data-testid="frame-badge"] .chip, .frame-notes .chip, .badge-notes .chip')].map((c) => c.textContent),
      measured: window.__trueblinkMeasureMs,
      timing: window.__trueblink ?? null,
      hash: location.hash,
    };
  });
}

async function waitReady(page, t0, limit = 120000, needMeasure = true) {
  let first = null;
  let s = await state(page);
  while (Date.now() - t0 < limit) {
    await page.waitForTimeout(250);
    s = await state(page);
    if (first === null && s.badge) first = Date.now() - t0;
    if (s.phase === 'error') break;
    if (s.phase === 'ready' && (!needMeasure || s.measured !== undefined)) break;
  }
  return { ...s, firstMs: first, settledMs: Date.now() - t0 };
}

async function shot(page, name, sel) {
  const p = join(out, `full-${name}.png`);
  if (sel && (await page.locator(sel).count())) await page.locator(sel).first().screenshot({ path: p });
  else await page.screenshot({ path: p });
  return p;
}

async function pause(page) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
}

async function setHash(page, extra) {
  await page.evaluate((x) => {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, v] of Object.entries(x)) p.set(k, v);
    location.hash = p.toString();
  }, extra);
  await page.waitForTimeout(900);
}

function log(row) {
  report.push(row);
  console.log(JSON.stringify(row));
  if (row.errors?.length) problems.push(`${row.case}: console errors ${row.errors.join(' | ')}`);
}

const TARGETS = [
  ['barnard', "name=Barnard's Star"],
  ['wise0855', 'name=WISE 0855-0714'],
  ['rwaur', 'name=RW Aurigae'],
  ['epsindb', 'name=Epsilon Indi B'],
  ['rdra', 'name=R Draconis'],
];
const enc = (h) => '#' + h.replace(/ /g, '%20');

// ---------------------------------------------------------------- default view of each target
if (want('targets')) {
  for (const [key, h] of TARGETS) {
    const { page, context, errors, t0 } = await open(enc(h));
    const s = await waitReady(page, t0);
    await pause(page);
    const a = await shot(page, `${key}-default`);
    // Last frame (one step back from the first wraps round).
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const last = await state(page);
    await shot(page, `${key}-default-last`, '.stage-wrap');
    log({ case: `default:${key}`, phase: s.phase, firstMs: s.firstMs, settledMs: s.settledMs, badgeFirst: s.badge, badgeLast: last.badge, status: s.status, notices: s.notices, findings: s.findings, measureMs: s.measured, hash: s.hash, timing: s.timing && { source: s.timing.source, loaded: s.timing.loaded, total: s.timing.total }, errors, shots: [a] });
    await context.close();
  }
}

// ---------------------------------------------------------------- sequences and band groups
if (want('sequences')) {
  for (const [key, h] of [TARGETS[0], TARGETS[2]]) {
    const { page, context, errors, t0 } = await open(enc(h));
    await waitReady(page, t0, 120000, false);
    for (const seq of ['epochs', 'pairs', 'sweep', 'difference', 'thenNow', 'coldFilter']) {
      await setHash(page, { seq });
      if (seq === 'thenNow') await page.waitForTimeout(6000); // older-survey frame
      await pause(page);
      const s = await state(page);
      const n = await page.locator('.transport .thumb, [data-testid="transport"] button.thumb, .thumbs > *').count();
      await shot(page, `${key}-seq-${seq}`, '.viewer-panel');
      log({ case: `seq:${key}:${seq}`, badge: s.badge, thumbs: n, notices: s.notices, errors: [] });
    }
    await setHash(page, { seq: 'epochs' });
    for (const band of ['cold', 'd3', 'swir']) {
      await setHash(page, { band });
      await pause(page);
      const s = await state(page);
      await shot(page, `${key}-band-${band}`, '.viewer-panel');
      log({ case: `band:${key}:${band}`, badge: s.badge, notices: s.notices, errors: [] });
    }
    // Stepping, play/pause, zoom, pan, hover.
    await setHash(page, { band: 'all' });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const b2 = (await state(page)).badge;
    await page.keyboard.press(' ');
    await page.waitForTimeout(1500);
    const playing = await page.locator('[data-testid="play"]').getAttribute('aria-pressed').catch(() => null);
    await page.keyboard.press(' ');
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    const box = await page.locator('[data-testid="viewer-canvas"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
      await page.mouse.up();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
      await page.waitForTimeout(400);
    }
    const hover = await page.locator('[data-testid="hover-readout"]').textContent().catch(() => null);
    await shot(page, `${key}-zoom-pan-hover`, '.viewer-panel');
    log({ case: `controls:${key}`, afterStep: b2, playingAttr: playing, hover, errors });
    await context.close();
  }
}

// ---------------------------------------------------------------- research tabs
if (want('research')) {
  for (const [key, h] of [TARGETS[0], TARGETS[2], ['wise0855', 'name=WISE 0855-0714&band=cold']]) {
    const { page, context, errors, t0 } = await open(enc(h + '&mode=research'));
    const s = await waitReady(page, t0);
    await pause(page);
    for (const tab of ['frames', 'measure', 'overlays', 'asteroid', 'provenance']) {
      const b = page.locator(`#rtab-${tab}`);
      if (!(await b.count())) {
        problems.push(`${key}: research tab ${tab} missing`);
        continue;
      }
      await b.click();
      await page.waitForTimeout(tab === 'asteroid' ? 2500 : 900);
      if (tab === 'overlays') {
        for (const k of ['gaia', 'track', 'solarSystem']) {
          const cb = page.locator(`[data-testid="ov-${k}"]`);
          if ((await cb.count()) && !(await cb.isChecked())) await cb.check();
        }
        await page.waitForTimeout(12000); // Gaia + SkyBoT
        await pause(page);
        await shot(page, `${key}-research-overlays-viewer`, '.viewer-panel');
      }
      await shot(page, `${key}-research-${tab}`, '[data-testid="research-panel"]');
    }
    const s2 = await state(page);
    await shot(page, `${key}-research-page`);
    log({ case: `research:${key}`, phase: s.phase, findings: s2.findings, notices: s2.notices, errors });
    await context.close();
  }
}

// ---------------------------------------------------------------- views
if (want('views')) {
  const { page, context, errors, t0 } = await open(enc(TARGETS[0][1]));
  await waitReady(page, t0, 120000, false);
  await page.locator('[data-testid="view-cube"]').click();
  await page.waitForTimeout(3000);
  await shot(page, 'barnard-cube-time', '.viewer-panel');
  await setHash(page, { seq: 'difference' });
  await page.waitForTimeout(2000);
  await shot(page, 'barnard-cube-difference', '.viewer-panel');
  await setHash(page, { seq: 'epochs' });
  await page.locator('[data-testid="view-sky"]').click();
  await page.waitForTimeout(6000);
  await shot(page, 'barnard-sky', '.viewer-panel');
  // Drop a pin on empty sky (a quarter of the way in from the top-left of the map), then "Open here".
  const map = page.locator('.viewer-panel canvas').first();
  const mb = await map.boundingBox();
  if (mb) {
    await page.mouse.click(mb.x + mb.width * 0.25, mb.y + mb.height * 0.3);
    await page.waitForTimeout(1200);
  }
  await shot(page, 'barnard-sky-pin', '.viewer-panel');
  const openHere = page.getByRole('button', { name: /open here/i });
  const hasOpenHere = await openHere.count();
  let opened = null;
  if (hasOpenHere) {
    const t1 = Date.now();
    await openHere.first().click();
    const w = await waitReady(page, t1, 120000, false);
    await pause(page);
    await shot(page, 'barnard-sky-opened', '.viewer-panel');
    opened = { phase: w.phase, status: w.status.slice(0, 160), hash: w.hash, badge: w.badge?.slice(0, 100) };
  }
  log({ case: 'views', hasOpenHere, opened, errors });
  await context.close();
}

// ---------------------------------------------------------------- field of view, load more, cancel, switching
if (want('controls')) {
  {
    const { page, context, errors, t0 } = await open(enc(TARGETS[0][1]));
    await waitReady(page, t0, 120000, false);
    const res = [];
    for (const fov of ['120', '300', '600']) {
      const t1 = Date.now();
      await page.locator('[data-testid="fov-select"]').selectOption(fov);
      const s = await waitReady(page, t1, 150000, false);
      await pause(page);
      await shot(page, `barnard-fov-${fov}`, '.viewer-panel');
      res.push({ fov, phase: s.phase, ms: s.settledMs, status: s.status.slice(0, 120), badge: s.badge });
    }
    log({ case: 'fov', res, errors });
    await context.close();
  }
  {
    // Cancel in the middle of a live load (coordinates, no bundle), then switch target while loading.
    const { page, context, errors, t0 } = await open('#ra=180.0&dec=2.0');
    while (Date.now() - t0 < 60000) {
      await page.waitForTimeout(200);
      const s = await state(page);
      if (s.phase === 'loading' && s.timing?.loaded > 20) break;
    }
    await page.locator('[data-testid="cancel"]').click().catch(() => problems.push('cancel button not found'));
    await page.waitForTimeout(800);
    const c = await state(page);
    await shot(page, 'cancel', '.app');
    const t1 = Date.now();
    await page.evaluate(() => (location.hash = '#name=R%20Draconis'));
    await page.waitForTimeout(300);
    await page.evaluate(() => (location.hash = '#name=WISE%200855-0714'));
    const w = await waitReady(page, t1, 120000, false);
    await pause(page);
    await shot(page, 'switch-while-loading', '.viewer-panel');
    log({ case: 'cancel+switch', afterCancel: { phase: c.phase, status: c.status.slice(0, 120), badge: c.badge }, after: { phase: w.phase, badge: w.badge, query: w.timing?.name }, errors });
    await context.close();
  }
  {
    // Share link round trip, embed, reduced motion.
    const { page, context, t0 } = await open(enc("name=Barnard's Star&seq=difference&band=mwir&fov=180"));
    await waitReady(page, t0, 120000, false);
    await page.keyboard.press('2');
    await page.waitForTimeout(800);
    const h = await page.evaluate(() => location.hash);
    const a = await state(page);
    await context.close();
    const r = await open(h);
    const b = await waitReady(r.page, r.t0, 120000, false);
    await r.page.waitForTimeout(800);
    const b2 = await state(r.page);
    await shot(r.page, 'hash-roundtrip', '.viewer-panel');
    log({ case: 'hash-roundtrip', hash: h, before: a.badge, after: b2.badge, same: a.badge === b2.badge, errors: r.errors });
    await r.context.close();
    const e = await open(enc("name=RW Aurigae&embed=1"), { width: 640, height: 480 });
    await e.page.waitForTimeout(6000);
    await shot(e.page, 'embed');
    log({ case: 'embed', badge: (await state(e.page)).badge, errors: e.errors });
    await e.context.close();
    const m = await open(enc("name=Barnard's Star"), { width: 1280, height: 860 }, { reducedMotion: 'reduce' });
    await waitReady(m.page, m.t0, 120000, false);
    await m.page.waitForTimeout(1500);
    const f1 = (await state(m.page)).badge;
    await m.page.waitForTimeout(1500);
    const f2 = (await state(m.page)).badge;
    log({ case: 'reduced-motion', autoplayed: f1 !== f2, errors: m.errors });
    await m.context.close();
  }
}

// ---------------------------------------------------------------- edge cases
if (want('edge')) {
  for (const [key, h] of [
    ['nocov', 'ra=0.5&dec=89.99'],
    ['nonsense', 'name=asdkjh qwe 12 zz'],
    ['sesame-unknown', 'name=Zorgon Prime 4b'],
    ['wise-brief', 'ra=133.79513&dec=-7.24515'],
    ['landing', ''],
  ]) {
    const { page, context, errors, t0 } = await open(h ? enc(h) : '');
    const s = key === 'landing' ? (await page.waitForTimeout(5000), await state(page)) : await waitReady(page, t0, 90000, false);
    await shot(page, `edge-${key}`);
    log({ case: `edge:${key}`, phase: s.phase, status: s.status.slice(0, 400), notices: s.notices, errors });
    await context.close();
  }
}

// ---------------------------------------------------------------- cold-object filter, every frame
if (want('cold')) {
  for (const [key, h] of [TARGETS[1], TARGETS[3], TARGETS[2]]) {
    const { page, context, errors, t0 } = await open(enc(h + '&seq=coldFilter&band=cold'));
    const s = await waitReady(page, t0, 120000, false);
    await pause(page);
    const n = await page.locator('.strip [role="option"]').count();
    const frames = [];
    for (let k = 1; k <= Math.max(1, Math.min(n, 9)); k++) {
      await page.keyboard.press(String(k));
      await page.waitForTimeout(500);
      const st = await state(page);
      await shot(page, `${key}-cold-${k}`, '.viewer-panel');
      frames.push({ badge: st.badge, chips: st.chips });
    }
    log({ case: `cold:${key}`, phase: s.phase, thumbs: n, frames, notices: s.notices, errors });
    await context.close();
  }
}

// ---------------------------------------------------------------- overlay toggles from the Research tab
if (want('overlays')) {
  {
    const { page, context, errors, t0 } = await open(enc("name=Barnard's Star&mode=research"));
    await waitReady(page, t0, 120000, false);
    await page.locator('#rtab-overlays').click();
    await page.waitForTimeout(500);
    for (const k of ['gaia', 'track']) {
      const cb = page.locator(`[data-testid="ov-${k}"]`);
      if ((await cb.count()) && !(await cb.isChecked())) await cb.check();
    }
    await page.waitForTimeout(8000); // Gaia from VizieR
    const tabAfter = await page.locator('[role="tab"][aria-selected="true"]').first().textContent().catch(() => null);
    const checked = { gaia: await page.locator('[data-testid="ov-gaia"]').isChecked().catch(() => null), track: await page.locator('[data-testid="ov-track"]').isChecked().catch(() => null) };
    const gaiaList = await page.locator('[data-testid="rtab-overlays-body"] h4').first().textContent().catch(() => null);
    // Step frames with the buttons (keys would go to the focused checkbox).
    const badges = [];
    for (let k = 0; k < 3; k++) {
      await shot(page, `barnard-overlays-frame${k + 1}`, '.viewer-panel');
      badges.push((await state(page)).badge);
      await page.locator('button[aria-label="Next frame"]').first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
    log({ case: 'overlays:barnard', tabAfter, checked, gaiaList, badges, errors });
    await context.close();
  }
  {
    // Solar System markers in the ecliptic field (preset coordinates from public/presets/ecliptic.json).
    const { page, context, errors, t0 } = await open('#ra=249.8816&dec=-22.3683&mode=research');
    await waitReady(page, t0, 150000, false);
    await page.locator('#rtab-overlays').click().catch(() => {});
    const cb = page.locator('[data-testid="ov-solarSystem"]');
    if ((await cb.count()) && !(await cb.isChecked())) await cb.check();
    await page.waitForTimeout(15000); // SkyBoT
    const s = await state(page);
    await shot(page, 'ecliptic-sso', '.viewer-panel');
    // Stacked visit frames smear asteroids out; single exposures (colour sweep) show them where the markers are.
    const seen = [];
    for (const seq of ['sweep', 'pairs']) {
      await setHash(page, { seq });
      await page.waitForTimeout(12000);
      await pause(page);
      seen.push({ seq, badge: (await state(page)).badge?.slice(0, 120) });
      await shot(page, `ecliptic-sso-${seq}`, '.viewer-panel');
    }
    log({ case: 'overlays:ecliptic-sso', phase: s.phase, status: s.status.slice(0, 160), notices: s.notices, seen, errors });
    await context.close();
  }
}

// ---------------------------------------------------------------- first-time visitor at 1280 and 390 px
if (want('visitor')) {
  for (const [w, h] of [
    [1280, 860],
    [390, 844],
  ]) {
    const vp = { width: w, height: h };
    const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const full = async (page, name) => page.screenshot({ path: join(out, `full-visitor-${w}-${name}.png`), fullPage: true });
    {
      const { page, context, errors } = await open('', vp);
      await page.waitForTimeout(4000);
      await full(page, 'landing');
      log({ case: `visitor:${w}:landing`, overflowPx: await overflow(page), errors });
      await context.close();
    }
    for (const [key, hh] of [TARGETS[0], TARGETS[2]]) {
      const { page, context, errors, t0 } = await open(enc(hh), vp);
      const s = await waitReady(page, t0);
      await pause(page);
      await full(page, key);
      log({ case: `visitor:${w}:${key}`, overflowPx: await overflow(page), result: s.result, findings: s.findings, errors });
      await context.close();
    }
    {
      const { page, context, errors, t0 } = await open(enc(TARGETS[1][1]), vp);
      await waitReady(page, t0);
      await page.locator('[data-testid="step-3"]').click().catch(() => problems.push('WISE step 3 not found'));
      await page.waitForTimeout(2500);
      await pause(page);
      const s = await state(page);
      await full(page, 'wise0855-cold');
      log({ case: `visitor:${w}:wise0855-step3`, overflowPx: await overflow(page), hash: s.hash, badge: s.badge?.slice(0, 160), result: s.result, findings: s.findings, errors });
      await context.close();
    }
    {
      const { page, context, errors, t0 } = await open(enc('name=RW Aurigae&mode=research'), vp);
      await waitReady(page, t0);
      await page.locator('#rtab-measure').click().catch(() => {});
      await page.waitForTimeout(1500);
      await full(page, 'rwaur-measure');
      const table = await page.locator('[data-testid="band-ratios"]').textContent().catch(() => null);
      await page.locator('#rtab-asteroid').click().catch(() => {});
      await page.waitForTimeout(3000);
      await full(page, 'rwaur-asteroid');
      await page.locator('#rtab-provenance').click().catch(() => {});
      await page.waitForTimeout(800);
      const prov = await page.locator('[data-testid="research-panel"]').textContent().catch(() => null);
      log({ case: `visitor:${w}:research`, overflowPx: await overflow(page), table, ring: /wing ring [^)]*\)/.exec(prov ?? '')?.[0] ?? null, errors });
      await context.close();
    }
  }
}

// ---------------------------------------------------------------- Korean, phone width
if (want('i18n')) {
  for (const [key, h, vp] of [
    ['ko', "name=Barnard's Star&lang=ko", { width: 1400, height: 950 }],
    ['phone', 'name=RW Aurigae', { width: 390, height: 844 }],
    ['phone-ko-research', 'name=WISE 0855-0714&lang=ko&mode=research', { width: 390, height: 844 }],
  ]) {
    const { page, context, errors, t0 } = await open(enc(h), vp);
    const s = await waitReady(page, t0, 120000, false);
    await pause(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const p = join(out, `full-${key}.png`);
    await page.screenshot({ path: p, fullPage: true });
    log({ case: `i18n:${key}`, phase: s.phase, overflowPx: overflow, errors });
    if (overflow > 0) problems.push(`${key}: horizontal overflow ${overflow}px`);
    await context.close();
  }
}

await browser.close();
writeFileSync(join(out, 'app-full-report.json'), JSON.stringify({ report, problems }, null, 2));
console.log(problems.length ? `app-full: ${problems.length} problem(s)\n- ${problems.join('\n- ')}` : 'app-full: no automatic problems (now look at the screenshots)');
