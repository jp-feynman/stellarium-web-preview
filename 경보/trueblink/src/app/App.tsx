// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The application shell: layout, start-up from the URL, keyboard map, and wiring store <-> pipeline.
import { useEffect } from 'react';
import './styles/app.css';
import { AboutDialog } from './components/AboutDialog';
import { ExplorePanel } from './components/ExplorePanel';
import { ResearchPanel } from './components/ResearchPanel';
import { StatusBar } from './components/StatusBar';
import { NoticeBar } from './components/ViewExtras';
import { TopBar } from './components/TopBar';
import { ViewerPanel } from './components/ViewerPanel';
import { PlanetariumHeader, closePlanetariumAnalysis } from './components/PlanetariumHeader';
import { prefersReducedMotion } from './hooks';
import { useT } from './i18n';
import { MockPipeline } from './mock';
import { PRESETS } from './presets';
import { getPipeline, setPipeline } from './seams';
import { useApp } from './store';
import { applyUrlState, decodeHash, encodeHash, startUrlSync, urlStateFromApp, type UrlState } from './urlState';

// Research tabs register themselves when src/app/research/index.ts(x) exists (another owner's module).
// import.meta.glob resolves to nothing while that file is absent, so the shell builds either way.
const researchModules = import.meta.glob('./research/index.{ts,tsx}', { eager: true });
void researchModules;

let booted = false;

function openFromUrl(u: UrlState): void {
  const p = getPipeline();
  if (!p) return;
  // No target in the link: the landing state (sky map + challenge targets). Embeds and the DEMO
  // pipeline still open the first challenge target so they never show an empty frame.
  const fallback = useApp.getState().embed || useApp.getState().demo || u.mock ? { name: PRESETS[0].target.name } : null;
  const keepView = u.seq !== undefined || u.band !== undefined;
  const input = u.name || u.ra !== undefined
    ? { name: u.label && u.ra !== undefined ? undefined : u.name, ra: u.ra, dec: u.dec, label: u.label, keepView }
    : fallback;
  if (!input) return;
  void p.open(input).then(() => {
    // A shared link to one frame opens on that frame, paused (autoplay started when the field became ready).
    if (u.frame !== undefined) {
      useApp.getState().setPlaying(false);
      useApp.getState().selectFrame(u.frame);
    }
  });
}

function boot(): () => void {
  setFavicon();
  if (!getPipeline()) setPipeline(new MockPipeline());
  const u = decodeHash(window.location.hash);
  applyUrlState(u);
  openFromUrl(u);
  const stopSync = startUrlSync();

  // Rebuild the sequence whenever what-to-compare changes; autoplay once data is ready (unless reduced motion).
  const unsub = useApp.subscribe((s, prev) => {
    const ready = s.status.phase === 'ready' || s.status.phase === 'loading';
    if (ready && (s.sequence !== prev.sequence || s.bandGroupId !== prev.bandGroupId || s.balanced !== prev.balanced || s.referenceVisit !== prev.referenceVisit)) {
      getPipeline()?.rebuildSequence();
    }
    if (s.status.phase === 'ready' && prev.status.phase !== 'ready' && s.frames.length > 1 && !prefersReducedMotion()) s.setPlaying(true);
  });

  // A hand-edited hash (or back/forward between shared links) reopens the view.
  const onHash = () => {
    const u2 = decodeHash(window.location.hash);
    const now = encodeHash(urlStateFromApp(useApp.getState()));
    if (encodeHash(u2) === now) return;
    applyUrlState(u2);
    const s = useApp.getState();
    if ((u2.name && u2.name !== s.target?.name) || (u2.ra !== undefined && !u2.name && (u2.ra !== s.center?.ra || u2.dec !== s.center?.dec))) openFromUrl(u2);
  };
  window.addEventListener('hashchange', onHash);
  return () => {
    stopSync();
    unsub();
    window.removeEventListener('hashchange', onHash);
  };
}

/** Tab icon (amber = time, cyan = wavelength) as a data URI, so no favicon request can 404. */
function setFavicon(): void {
  if (document.querySelector('link[rel="icon"]')) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#080c16"/><circle cx="12" cy="16" r="7" fill="#ffb454"/><circle cx="20" cy="16" r="7" fill="#5ad1e6" fill-opacity="0.8"/></svg>`;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.head.appendChild(link);
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function onKeyDown(e: KeyboardEvent): void {
  const s = useApp.getState();
  if (e.key === 'Escape' && !e.defaultPrevented && s.embed === 'panel' && !s.aboutOpen) {
    e.preventDefault();
    closePlanetariumAnalysis();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (s.aboutOpen) return;
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') {
    if (e.target instanceof HTMLButtonElement) return; // let the focused button handle Space
    e.preventDefault();
    s.togglePlay();
  } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
    if (e.target instanceof HTMLElement && e.target.getAttribute('role') === 'tab') return;
    e.preventDefault();
    s.setPlaying(false);
    s.stepFrame(k === 'ArrowRight' ? 1 : -1);
  } else if (/^[1-9]$/.test(k)) {
    s.setPlaying(false);
    s.selectFrame(Number(k) - 1);
  } else if (k === 'd' || k === 'D') {
    s.setSequence(s.sequence === 'difference' ? 'epochs' : 'difference');
  } else if (k === '+' || k === '=') {
    s.setZoom(s.zoom * 1.5);
  } else if (k === '-' || k === '_') {
    s.setZoom(s.zoom / 1.5);
  } else if (k === '0') {
    s.setZoom(1);
  }
}

export function App() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const uiMode = useApp((s) => s.uiMode);
  const embed = useApp((s) => s.embed);
  const minimalEmbed = embed === true;
  const panelEmbed = embed === 'panel';
  const demo = useApp((s) => s.demo);

  useEffect(() => {
    if (booted) return;
    booted = true;
    const stop = boot();
    return () => {
      // StrictMode mounts twice in development; keep the single boot alive.
      void stop;
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className={`app${minimalEmbed ? ' embed' : ''}${panelEmbed ? ' embed-panel' : ''}`} data-mode={uiMode}>
      {panelEmbed && <PlanetariumHeader />}
      {!minimalEmbed && <TopBar />}
      {!minimalEmbed && <StatusBar />}
      {!minimalEmbed && <NoticeBar />}
      {demo && !minimalEmbed && (
        <p className="demo-banner" role="note">
          <strong>DEMO</strong> {t('demo.banner')}
        </p>
      )}
      <main className="main" id="main">
        <ViewerPanel />
        {!minimalEmbed && (
          <aside className="side" aria-label={uiMode === 'explore' ? t('panel.explore') : t('panel.research')}>
            {uiMode === 'explore' ? <ExplorePanel /> : <ResearchPanel />}
          </aside>
        )}
      </main>
      <AboutDialog />
    </div>
  );
}
