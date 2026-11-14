// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Launch a headless Chromium with software WebGL for screenshot checks.
// Uses the Playwright browser cache if present. On machines where Chromium's system libraries are
// missing and cannot be installed (no root), drop the .so files into .tools/chromium-libs.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const p = join(cache, d, 'chrome-linux64', 'chrome');
      if (existsSync(p)) return p;
      const p2 = join(cache, d, 'chrome-linux', 'chrome');
      if (existsSync(p2)) return p2;
    }
  }
  return undefined; // let Playwright decide
}

export async function launchBrowser() {
  const libs = join(here, '..', '.tools', 'chromium-libs');
  const env = { ...process.env };
  if (existsSync(libs)) env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  return chromium.launch({
    executablePath: findChrome(),
    headless: true,
    env,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  });
}

/** Open a page, collect console errors, and return { page, errors }. */
export async function openPage(browser, url, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, context };
}
