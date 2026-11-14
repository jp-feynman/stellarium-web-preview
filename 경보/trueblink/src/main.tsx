// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Entry point: choose the data pipeline (real archive by default, synthetic DEMO data with #mock=1),
// inject the WebGL blink renderer and the Research tabs, then mount the app shell.
import { Component, lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useApp } from './app/store';
import './app/styles/tokens.css';

const AsteroidTab = lazy(() => import('./app/asteroid').then((module) => ({ default: module.AsteroidTab })));

class TabLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function DeferredAsteroidTab() {
  const ko = useApp((s) => s.lang) === 'ko';
  return (
    <TabLoadBoundary fallback={<p role="alert">{ko ? '소행성 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.' : 'The asteroid tools could not load. Please reload the page.'}</p>}>
      <Suspense fallback={<p role="status">{ko ? '소행성 분석 도구를 준비하는 중…' : 'Preparing asteroid analysis tools…'}</p>}>
        <AsteroidTab />
      </Suspense>
    </TabLoadBoundary>
  );
}

function wantsMock(): boolean {
  return /(^|[#&])mock=(1|true)(&|$)/.test(window.location.hash);
}

async function boot() {
  // Fetch the pipeline alongside the UI instead of starting another import waterfall afterward.
  // It is still installed before mounting App, whose first effect opens the URL's target.
  const pipelineFactory = wantsMock()
    ? import('./app/mock').then(({ MockPipeline }) => () => new MockPipeline())
    : import('./app/pipeline').then(({ RealPipeline }) => () => new RealPipeline());
  const [{ App }, seams, { BlinkStage }, { registerAllResearchTabs }, makePipeline] = await Promise.all([
    import('./app/App'),
    import('./app/seams'),
    import('./gl/BlinkStage'),
    import('./app/researchTabs'),
    pipelineFactory,
  ]);
  seams.setPipeline(makePipeline());
  // The shell draws its own compass and frame badge, so the stage's caption and arrows stay off.
  seams.setStageFactory((el) => new BlinkStage(el, { pixelated: true, caption: false, compass: false }));
  try {
    registerAllResearchTabs();
  } catch (e) {
    console.warn('Research tabs failed to register:', e);
  }
  // Download the asteroid models and tab UI only when that tab is actually selected.
  seams.registerResearchTab('asteroid', 'research.tab.asteroid', DeferredAsteroidTab);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot().catch((error: unknown) => {
  console.error('Analysis startup failed:', error);
  const ko = new URLSearchParams(location.hash.slice(1)).get('lang') === 'ko';
  const root = document.getElementById('root');
  if (!root) return;
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.className = 'boot-status';
  message.textContent = ko ? '분석 화면을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.' : 'The analysis screen could not load. Check your connection and reload.';
  root.replaceChildren(message);
});
