// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check of the app shell on the MockPipeline: screenshots at desktop and phone widths,
// fails on console errors, page errors or horizontal overflow.
// Usage: start `npx vite --port 5184 --strictPort`, then `node e2e/ui-shell.mjs [baseUrl]`.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const base = process.argv[2] || 'http://localhost:5184/';
const failures = [];

// Headless Linux often has no Hangul font, which turns the Korean screenshots into boxes.
// On WSL, borrow Malgun Gothic from Windows through a private fontconfig file (nothing is installed).
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

/**
 * Like openPage, but records where each console error comes from. index.html has no <link rel="icon">,
 * so Chromium asks for /favicon.ico once per browser; that one 404 is reported as a note, not a failure.
 */
async function openTracked(url, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/\/favicon\.ico$/.test(m.location()?.url ?? '')) {
      console.log('note: /favicon.ico 404 (index.html declares no icon)');
      return;
    }
    errors.push(`${m.text()} @ ${m.location()?.url ?? '?'}`);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, context };
}

function watchHttp(page, label) {
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(`${label}: HTTP ${r.status()} for ${r.url()}`);
  });
}

async function waitReady(page, embed = false) {
  if (!embed) await page.waitForSelector('[data-testid="status"][data-phase="ready"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="frame-badge"]', { timeout: 10000 });
  // Pause so the screenshot shows a stable frame.
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="play"]');
    if (b && b.getAttribute('aria-pressed') === 'true') b.click();
  });
  await page.waitForTimeout(300);
}

async function checkOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) failures.push(`${label}: horizontal overflow (${o.sw} > ${o.cw})`);
}

async function checkCanvasHasPixels(page, label) {
  const lit = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="viewer-canvas"] canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d');
    if (!ctx) return -2; // a WebGL stage: skip the pixel probe
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 16) if (d[k + 3] > 0 && d[k] + d[k + 1] + d[k + 2] > 60) n++;
    return n;
  });
  if (lit === -1) failures.push(`${label}: no canvas in the viewer`);
  else if (lit >= 0 && lit < 50) failures.push(`${label}: viewer canvas looks blank (${lit} lit samples)`);
}

async function shot(page, name) {
  const p = join(out, `ui-shell-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log('saved', p);
}

const browser = await launchBrowser();
try {
  // 1. Explore at 1280 x 800, default target (Barnard's Star).
  {
    const { page, errors, context } = await openTracked(base, { width: 1280, height: 800 });
    watchHttp(page, 'desktop');
    await waitReady(page);
    await checkOverflow(page, 'explore-1280');
    await checkCanvasHasPixels(page, 'explore-1280');
    await shot(page, 'explore-1280');
    await page.screenshot({ path: join(out, 'ui-shell-explore-1280-full.png'), fullPage: true });

    // Guided step 3 (difference) and keyboard stepping.
    await page.click('[data-testid="step-3"]');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await shot(page, 'explore-step3-1280');

    // WISE 0855 cold-band mission.
    await page.click('[data-testid="preset-wise0855"]');
    await waitReady(page);
    await page.click('[data-testid="step-2"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="play"]');
      if (b && b.getAttribute('aria-pressed') === 'true') b.click();
    });
    await shot(page, 'wise0855-1280');

    // Research mode.
    await page.click('[data-testid="mode-research"]');
    await page.waitForTimeout(300);
    await shot(page, 'research-1280');
    const hash = await page.evaluate(() => location.hash);
    if (!/mode=research/.test(hash)) failures.push(`URL hash did not record research mode: ${hash}`);

    // About dialog.
    await page.click('[data-testid="mode-explore"]');
    await page.click('[data-testid="about-button"]');
    await page.waitForSelector('[data-testid="about-dialog"]');
    await shot(page, 'about-1280');
    await page.keyboard.press('Escape');

    // Error path: an unknown name gives a friendly message.
    await page.fill('[data-testid="search-input"]', 'Planet X');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.statusbar.error', { timeout: 10000 });
    await shot(page, 'error-1280');

    if (errors.length) failures.push(`console errors (desktop): ${errors.join(' | ')}`);
    await context.close();
  }

  // 2. Korean, via the URL.
  {
    const { page, errors, context } = await openPage(browser, `${base}#name=RW+Aurigae&lang=ko`, { width: 1280, height: 800 });
    await waitReady(page);
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'ko') failures.push(`expected <html lang="ko">, got ${lang}`);
    await checkOverflow(page, 'korean-1280');
    await shot(page, 'korean-1280');
    if (errors.length) failures.push(`console errors (korean): ${errors.join(' | ')}`);
    await context.close();
  }

  // 3. Phone, 390 x 844.
  {
    const { page, errors, context } = await openPage(browser, `${base}#name=Epsilon+Indi+B`, { width: 390, height: 844 });
    await waitReady(page);
    await checkOverflow(page, 'mobile-390');
    await checkCanvasHasPixels(page, 'mobile-390');
    await shot(page, 'mobile-390');
    await page.screenshot({ path: join(out, 'ui-shell-mobile-390-full.png'), fullPage: true });
    if (errors.length) failures.push(`console errors (mobile): ${errors.join(' | ')}`);
    await context.close();
  }

  // 4. Embed layout and 360 px minimum width.
  {
    const { page, errors, context } = await openPage(browser, `${base}#name=R+Draconis&embed=1`, { width: 360, height: 640 });
    await waitReady(page, true);
    await checkOverflow(page, 'embed-360');
    const chrome = await page.$('.topbar');
    if (chrome) failures.push('embed=1 still shows the top bar');
    await shot(page, 'embed-360');
    if (errors.length) failures.push(`console errors (embed): ${errors.join(' | ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('FAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('ui-shell: all checks passed');
