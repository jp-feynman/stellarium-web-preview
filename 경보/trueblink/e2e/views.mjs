// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Headless check for the sky map (SkyView) and the 3D stack (CubePanel) in demo/views.html.
// Screenshots go to e2e/out/views-*.png. Needs the dev server:
//   VITE_CACHE_DIR=node_modules/.vite-views npx vite --port 5192 --strictPort
// then: node e2e/views.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] || process.env.VIEWS_URL || 'http://localhost:5192/demo/views.html';

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

async function settleGlobe(page, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => window.__tbSkyGlobe?.getStatus());
    if (st && st.tilesPending === 0 && (st.tilesLoaded > 0 || st.tilesFailed > 0)) break;
    if (Date.now() - t0 > timeoutMs) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
  return page.evaluate(() => window.__tbSkyGlobe?.getStatus());
}

async function waitReady(page) {
  await page.waitForFunction(() => document.body.textContent.includes('Status: ready'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Screen position of a sky-map marker (the ring centre) from its label element. */
async function markerPoint(page, text) {
  const label = page.locator('.sky-globe div', { hasText: new RegExp(`^${text}`) }).last();
  const box = await label.boundingBox();
  if (!box) return null;
  return { x: box.x - 12, y: box.y + 8 };
}

const browser = await launchBrowser();
try {
  // ------------------------------------------------------------------ desktop
  {
    const { page, errors, context } = await openPage(browser, BASE, { width: 1280, height: 800 });
    await waitReady(page);
    const st = await settleGlobe(page);
    check(!!st && st.imageryAvailable && st.tilesLoaded > 0, `sky map imagery loaded (${st?.tilesLoaded} tiles, channel ${st?.channel})`);
    const wave = await page.locator('.tbv-slider .tbv-wave').textContent();
    check(/^1\.(1|2)\d µm$/.test(wave.trim()), `default wavelength about 1.2 um (${wave})`);
    const caption = await page.locator('.tbv-sky .tbv-caption').textContent();
    check(caption.includes('one of 102 colours') && caption.includes('pick a spot to blink it'), 'sky caption');
    const labels = await page.locator('.sky-globe').textContent();
    for (const name of ["Barnard's Star", 'WISE 0855', 'RW Aur', 'R Dra', 'Eps Indi B']) check(labels.includes(name), `marker label "${name}" exists`);
    check(labels.includes('Current field'), 'current field marked');
    const readout = await page.locator('.tbv-readout').innerText();
    check(/\d\dh\d\dm/.test(readout) && /°/.test(readout), `read-out shows sexagesimal and degrees (${readout.replace(/\n/g, ' | ')})`);
    check((await overflow(page)) <= 0, 'no horizontal overflow at 1280');
    await page.screenshot({ path: join(OUT, 'views-start-1280.png') });

    // Zoom to Orion.
    await page.evaluate(() => window.__tbSkyGlobe.lookAt({ ra: 83.82, dec: -3.5 }, 16));
    await page.waitForTimeout(900);
    await settleGlobe(page);
    const ro = await page.locator('.tbv-readout').innerText();
    check(ro.includes('05h3'), `read-out follows the view to Orion (${ro.replace(/\n/g, ' | ')})`);
    await page.screenshot({ path: join(OUT, 'views-orion-1280.png') });

    // Zoom buttons.
    const fov0 = await page.evaluate(() => window.__tbSkyGlobe.getView().fovDeg);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(900);
    const fov1 = await page.evaluate(() => window.__tbSkyGlobe.getView().fovDeg);
    check(Math.abs(fov1 - fov0 / 2) < 0.2, `zoom in halves the field (${fov0.toFixed(1)} -> ${fov1.toFixed(1)})`);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(900);
    await settleGlobe(page);

    // Click on empty sky: a pin and a dialog, no pick yet.
    const box = await page.locator('.tbv-sky .tbv-gl canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.35);
    await page.waitForTimeout(400);
    check(await page.locator('.tbv-pin').isVisible(), 'pin dialog opens on a click on empty sky');
    check((await page.getByTestId('last-pick').innerText()).includes('none'), 'empty-sky click does not open a field by itself');
    check((await page.locator('.sky-globe').innerText()).includes('Picked spot'), 'pin marker drawn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'views-pin-1280.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();
    check(!(await page.locator('.tbv-pin').isVisible()), 'Cancel closes the pin dialog');
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.35);
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Open here' }).click();
    await page.waitForTimeout(200);
    const lp = await page.getByTestId('last-pick').innerText();
    check(lp.includes('(coordinates) @ '), `Open here calls onPick with coordinates (${lp})`);
    await waitReady(page);

    // Clicking a marker opens it directly.
    await page.evaluate(() => window.__tbSkyGlobe.lookAt({ ra: 76.95, dec: 30.4 }, 20));
    await page.waitForTimeout(900);
    const pt = await markerPoint(page, 'RW Aur');
    if (pt) await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
    const lp2 = await page.getByTestId('last-pick').innerText();
    check(lp2.includes('RW Aur'), `marker click calls onPick with the name (${lp2})`);
    check(!(await page.locator('.tbv-pin').isVisible()), 'marker click opens no dialog');
    await waitReady(page);

    // Back to Barnard's Star for the cube shots (strong proper motion -> track).
    await page.evaluate(() => window.__tbSkyGlobe.lookAt({ ra: 269.45, dec: 4.77 }, 20));
    await page.waitForTimeout(900);
    const pb = await markerPoint(page, "Barnard's Star");
    if (pb) await page.mouse.click(pb.x, pb.y);
    await waitReady(page);
    await page.waitForTimeout(800);

    // Cube: time axis.
    const cube = page.getByTestId('cube');
    check(!(await page.locator('.tbv-empty').isVisible()), 'cube shows frames');
    const cubeCaption = await page.locator('.tbv-cube .tbv-caption').textContent();
    check(cubeCaption.includes('slanted thread'), 'cube caption');
    check((await page.locator('.tbv-cube').innerText()).includes('Predicted track of'), 'track note for a moving target');
    const cbox = await page.locator('.tbv-cube .tbv-gl canvas').boundingBox();
    await page.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.5);
    await page.waitForTimeout(400);
    const hov = await page.locator('.tbv-hover').innerText();
    check(/µm/.test(hov) && /\d{4}-\d\d-\d\d/.test(hov), `hover read-out shows date and wavelength (${hov.replace(/\n/g, ' ')})`);
    await page.mouse.move(cbox.x + 2, cbox.y + 2);
    await page.waitForTimeout(300);
    await cube.screenshot({ path: join(OUT, 'views-cube-time-1280.png') });

    await page.getByRole('button', { name: 'Side' }).click();
    await page.waitForTimeout(400);
    await cube.screenshot({ path: join(OUT, 'views-cube-time-side-1280.png') });

    await page.getByRole('button', { name: 'Wavelength', exact: true }).click();
    await page.waitForTimeout(500);
    await cube.screenshot({ path: join(OUT, 'views-cube-wave-1280.png') });

    await page.getByRole('button', { name: /Every exposure/ }).click();
    await page.getByRole('button', { name: 'Oblique' }).click();
    await page.waitForTimeout(500);
    await cube.screenshot({ path: join(OUT, 'views-cube-exposures-wave-1280.png') });
    await page.getByRole('button', { name: 'Time', exact: true }).click();
    await page.waitForTimeout(500);
    await cube.screenshot({ path: join(OUT, 'views-cube-exposures-time-1280.png') });
    check((await overflow(page)) <= 0, 'no horizontal overflow at 1280 after interaction');
    check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await context.close();
  }

  // ------------------------------------------------------------------ phone width
  {
    const { page, errors, context } = await openPage(browser, BASE, { width: 390, height: 844 });
    await waitReady(page);
    await settleGlobe(page);
    check((await overflow(page)) <= 0, `no horizontal overflow at 390 (${await overflow(page)} px)`);
    const sliderBox = await page.locator('.tbv-slider').boundingBox();
    check(sliderBox && sliderBox.x >= 0 && sliderBox.x + sliderBox.width <= 390, 'wavelength slider fits at 390');
    await page.screenshot({ path: join(OUT, 'views-390.png'), fullPage: true });
    const box = await page.locator('.tbv-sky .tbv-gl canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.waitForTimeout(400);
    const pin = await page.locator('.tbv-pin').boundingBox();
    check(pin && pin.x >= 0 && pin.x + pin.width <= 390, 'pin dialog fits at 390');
    await page.locator('[data-testid="sky"]').screenshot({ path: join(OUT, 'views-pin-390.png') });
    check(errors.length === 0, `390: no console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await context.close();
  }

  // ------------------------------------------------------------------ empty state
  {
    const { page, errors, context } = await openPage(browser, `${BASE}?empty=1`, { width: 1280, height: 800 });
    await page.waitForTimeout(1500);
    check(await page.locator('.tbv-empty').isVisible(), 'cube empty state shown with no field');
    check(!(await page.locator('.sky-globe').innerText()).includes('Current field'), 'no current-field marker with no field');
    await page.getByTestId('cube').screenshot({ path: join(OUT, 'views-cube-empty-1280.png') });
    check(errors.length === 0, `empty: no console errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
    await context.close();
  }

  // ------------------------------------------------------------------ reduced motion
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${BASE}?empty=1`);
    await page.waitForTimeout(1000);
    check(await page.getByRole('button', { name: /Play through wavelengths/ }).isDisabled(), 'wavelength autoplay off under reduced motion');
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nviews: all checks passed');
