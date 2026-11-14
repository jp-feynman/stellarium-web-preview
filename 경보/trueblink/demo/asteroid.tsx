// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The Asteroid tab on its own. The asteroid spectra are real measurements (public/data/asteroids).
// ?lang=ko shows the Korean strings. ?sso=1 fills the "Solar System objects in this field" list with a
// saved SkyBoT answer (tests/fixtures) for a field that is not open here; that part is labelled DEMO.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/styles/tokens.css';
import { AsteroidTab } from '../src/app/asteroid';
import { bumpSession, session } from '../src/app/session';
import { useApp } from '../src/app/store';
import { parseSkybotJson } from '../src/core/catalogs';
import skybotSample from '../tests/fixtures/catalogs/skybot_jd2460823.82017_r540.json';

const params = new URLSearchParams(location.search);
if (params.get('lang') === 'ko') useApp.getState().setLang('ko');
const demoSso = params.get('sso') === '1';
if (demoSso) {
  const mjd = 60823.32017;
  session.grid = { ra0: 184.954819867, dec0: -4.08981110258, n: 256, scaleArcsec: 3.075 };
  session.visits = [{ index: 0, mjdMin: mjd, mjdMax: mjd, mjdMid: mjd, exposureIds: [], label: '2025-06-01' }];
  session.solarSystem.set(0, parseSkybotJson(JSON.stringify(skybotSample), mjd));
  useApp.getState().setOverlayOn('solarSystem', true);
  bumpSession();
}

const style = document.createElement('style');
style.textContent = `
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; box-sizing: border-box; }
  .demo-banner { background: var(--warn); color: #111; font-weight: 700; padding: 6px 10px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85rem; }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      {demoSso && (
        <div className="demo-banner" data-testid="demo-label">
          DEMO: the Solar System list below is a saved SkyBoT answer for a sample field (2025-06-01, near 12h20m −04°), not an open SPHEREx field. The asteroid spectra are real measurements.
        </div>
      )}
      <AsteroidTab />
    </main>
  </StrictMode>,
);
