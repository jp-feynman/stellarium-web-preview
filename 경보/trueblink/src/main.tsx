// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Entry point: choose the data pipeline (real archive by default, synthetic DEMO data with #mock=1),
// inject the WebGL blink renderer and the Research tabs, then mount the app shell.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/styles/tokens.css';

function wantsMock(): boolean {
  return /(^|[#&])mock=(1|true)(&|$)/.test(window.location.hash);
}

async function boot() {
  const [{ App }, seams, { BlinkStage }, { registerAllResearchTabs }, { AsteroidTab }] = await Promise.all([
    import('./app/App'),
    import('./app/seams'),
    import('./gl/BlinkStage'),
    import('./app/researchTabs'),
    import('./app/asteroid'),
  ]);
  if (wantsMock()) {
    const { MockPipeline } = await import('./app/mock');
    seams.setPipeline(new MockPipeline());
  } else {
    const { RealPipeline } = await import('./app/pipeline');
    seams.setPipeline(new RealPipeline());
  }
  // The shell draws its own compass and frame badge, so the stage's caption and arrows stay off.
  seams.setStageFactory((el) => new BlinkStage(el, { pixelated: true, caption: false, compass: false }));
  try {
    registerAllResearchTabs();
  } catch (e) {
    console.warn('Research tabs failed to register:', e);
  }
  seams.registerResearchTab('asteroid', 'research.tab.asteroid', AsteroidTab);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
