// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The left-hand viewer column: frame label, the blink canvas with a compass, transport and pickers.
import { useT } from '../i18n';
import { useApp } from '../store';
import { FrameBadge } from './FrameBadge';
import { ViewerCanvas } from './ViewerCanvas';
import { BandPicker, OverlayToggles, SequencePicker, StretchControls, TransportBar, ZoomControls } from './ViewerControls';
import { CubePanel } from '../views/CubePanel';
import { FovControl, HoverReadout, Landing, SkyMapView, ViewSwitcher } from './ViewExtras';

function Compass() {
  const t = useT();
  // North up, east LEFT: this is how the sky looks from below, the opposite of a map.
  return (
    <svg className="compass" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M48 48 V14" />
      <path d="M48 48 H14" />
      <path d="M44 19 48 12 52 19" />
      <path d="M19 44 12 48 19 52" />
      <text x="48" y="9" textAnchor="middle">{t('viewer.north')}</text>
      <text x="7" y="52" textAnchor="middle">{t('viewer.east')}</text>
    </svg>
  );
}

function ScaleBar() {
  const fov = useApp((s) => s.fovArcsec);
  const zoom = useApp((s) => s.zoom);
  // A 30-arcsec bar as a fraction of the visible width.
  const visible = fov / zoom;
  const arcsec = visible > 240 ? 60 : visible > 60 ? 30 : 10;
  const pct = (arcsec / visible) * 100;
  return (
    <div className="scalebar" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
      <em>{arcsec}″</em>
    </div>
  );
}

export function ViewerPanel() {
  const t = useT();
  const embed = useApp((s) => s.embed === true);
  const nFrames = useApp((s) => s.frames.length);
  const phase = useApp((s) => s.status.phase);
  const demo = useApp((s) => s.demo);
  const view = useApp((s) => s.view);
  const hasField = useApp((s) => s.target !== null || s.center !== null);
  const landing = !embed && !hasField && phase === 'idle' && nFrames === 0;
  if (landing) {
    return (
      <section className="viewer-panel" aria-label="Viewer">
        <Landing />
      </section>
    );
  }
  return (
    <section className="viewer-panel" aria-label="Viewer">
      {!embed && (
        <div className="viewer-head">
          <ViewSwitcher />
          <FovControl />
        </div>
      )}
      {view === 'blink' || embed ? <FrameBadge compact={embed} /> : null}
      <div className="viewer-body">
        <div className="stage-col">
          {view === 'blink' || embed ? (
            <>
              <div className="stage-wrap">
                <ViewerCanvas />
                {nFrames === 0 && (
                  <div className="stage-empty">
                    <p>{t(phase === 'ready' ? 'viewer.noFrames' : phase === 'idle' || phase === 'error' ? 'viewer.empty' : 'viewer.loading')}</p>
                  </div>
                )}
                {nFrames > 0 && (
                  <>
                    <Compass />
                    <ScaleBar />
                    {demo && !embed && <span className="stage-demo">DEMO</span>}
                  </>
                )}
              </div>
              {!embed && <HoverReadout />}
            </>
          ) : view === 'cube' ? (
            <div className="alt-view" data-testid="cube-view">
              <CubePanel />
            </div>
          ) : (
            <div className="alt-view">
              <SkyMapView />
            </div>
          )}
          <TransportBar />
          {!embed && view === 'blink' && (
            <div className="viewer-tools">
              <ZoomControls />
              <OverlayToggles />
              <span className="nodata-legend">
                <i aria-hidden="true" />
                {t('viewer.nodata')}
              </span>
            </div>
          )}
        </div>
        {!embed && (
          <div className="viewer-pickers">
            <SequencePicker />
            <div className="picker-side">
              <BandPicker />
              <details className="stretch-details">
                <summary>{t('stretch.label')}</summary>
                <StretchControls />
                <p className="hint small">{t('stretch.shared')}</p>
              </details>
              <p className="hint small keys">{t('transport.keys')}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
