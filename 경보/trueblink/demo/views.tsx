// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Demo of the sky map (SkyView) and the 3D stack (CubePanel) as the app mounts them. The store is
// filled by the MockPipeline (synthetic DEMO images, not SPHEREx data); the sky map tiles are the
// real SPHEREx all-sky HiPS from IRSA. session.exposureFrames gets synthetic single-exposure frames
// so the "Every exposure" source can be tried.
// URL parameters: ?target=<preset id> (default barnard), ?lang=ko, ?empty=1 (no field opened).

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/styles/tokens.css';
import '../src/app/styles/app.css';
import { SkyView } from '../src/app/views/SkyView';
import { CubePanel } from '../src/app/views/CubePanel';
import { useApp } from '../src/app/store';
import { MockPipeline, buildMockSequence, buildScene } from '../src/app/mock';
import { setPipeline, getPipeline } from '../src/app/seams';
import { bumpSession, resetSession, session } from '../src/app/session';
import { BAND_GROUPS, type SkyPos } from '../src/core/types';

const params = new URLSearchParams(location.search);
const lang = params.get('lang');
if (lang === 'ko' || lang === 'en') useApp.getState().setLang(lang);

setPipeline(new MockPipeline({ delayScale: 0.05 }));

/** Synthetic single-exposure frames for the session (DEMO): one per visit and band group, plus a wavelength sweep. */
function fillExposureFrames(input: { name?: string; ra?: number; dec?: number }): void {
  resetSession();
  const fov = useApp.getState().fovArcsec;
  const scene = buildScene(input, fov);
  if (!scene) return;
  session.center = scene.center;
  let k = 0;
  const add = (seq: string, group: string) => {
    for (const f of buildMockSequence(scene, fov, { sequence: seq, bandGroupId: group, balanced: true, referenceVisit: null }).frames) {
      session.exposureFrames.set(`demo-${k++}`, f);
    }
  };
  for (const g of BAND_GROUPS) add('pairs', g.id);
  add('sweep', 'all');
  bumpSession();
}

async function openField(input: { name?: string; ra?: number; dec?: number }): Promise<void> {
  await getPipeline()?.open(input);
  if (useApp.getState().status.phase === 'ready') fillExposureFrames(input);
}

function Demo() {
  const center = useApp((s) => s.center);
  const status = useApp((s) => s.status);
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const [lastPick, setLastPick] = useState('none');

  const onPick = (pos: SkyPos, name?: string) => {
    setLastPick(`${name ?? '(coordinates)'} @ ${pos.ra.toFixed(4)} ${pos.dec.toFixed(4)}`);
    // The mock knows the five challenge targets by name; anything else opens by coordinates.
    void openField(name ? { name, ra: pos.ra, dec: pos.dec } : { ra: pos.ra, dec: pos.dec });
  };

  return (
    <div className="demo-views">
      <header className="demo-head">
        <strong>Sky map and 3D stack demo</strong>
        <span className="chip chip-demo">DEMO</span>
        <span className="muted small">
          Stack images are synthetic (MockPipeline). Sky map tiles are the real SPHEREx all-sky map. Status: {status.phase}
        </span>
        <button type="button" className="btn small" onClick={() => setLang(lang === 'en' ? 'ko' : 'en')}>
          {lang === 'en' ? '한국어' : 'English'}
        </button>
        <span className="muted small" data-testid="last-pick">
          last pick: {lastPick}
        </span>
      </header>
      <main className="demo-grid">
        <div className="demo-cell" data-testid="sky">
          <SkyView onPick={onPick} center={center} />
        </div>
        <div className="demo-cell" data-testid="cube">
          <CubePanel />
        </div>
      </main>
      <style>{`
        .demo-views { padding: 12px 16px 24px; }
        .demo-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 12px; }
        .demo-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
        .demo-cell { min-width: 0; height: 640px; }
        @media (max-width: 900px) { .demo-grid { grid-template-columns: minmax(0, 1fr); } .demo-cell { height: auto; min-height: 560px; } .demo-cell .tbv-stage { min-height: 340px; } }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

if (params.get('empty') !== '1') void openField({ name: params.get('target') ?? 'barnard' });
