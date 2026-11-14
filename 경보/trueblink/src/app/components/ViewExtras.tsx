// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Viewer extras wired for the real pipeline: view switcher (Blink | 3D stack | Sky map), field-of-view
// control, the hover read-out under the viewer, the notice bar and the landing state.
import { useSyncExternalStore } from 'react';
import { formatDec, formatRa } from '../../core/coords';
import type { SkyPos } from '../../core/types';
import { FOV_CHOICES_ARCSEC } from '../config';
import { useT } from '../i18n';
import { PRESETS } from '../presets';
import { getPipeline } from '../seams';
import { useApp, type ViewKind } from '../store';
import { SkyView } from '../views/SkyView';

// ------------------------------------------------------------------ hover read-out (outside the store: it changes per mouse move)

export interface HoverInfo {
  ra: number;
  dec: number;
  value: number;
}

let hover: HoverInfo | null = null;
const hoverListeners = new Set<() => void>();

export function setHover(h: HoverInfo | null): void {
  if (h === hover) return;
  hover = h;
  hoverListeners.forEach((l) => l());
}

function useHover(): HoverInfo | null {
  return useSyncExternalStore(
    (cb) => {
      hoverListeners.add(cb);
      return () => hoverListeners.delete(cb);
    },
    () => hover,
    () => hover,
  );
}

function fmtValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

export function HoverReadout() {
  const t = useT();
  const h = useHover();
  const isDiff = useApp((s) => s.frames[s.frameIndex]?.meta.kind === 'difference');
  const isExternal = useApp((s) => s.frames[s.frameIndex]?.meta.kind === 'external');
  return (
    <p className="hover-readout" data-testid="hover-readout" aria-live="off">
      {h ? (
        <>
          <span>RA {formatRa(h.ra)}</span>
          <span>Dec {formatDec(h.dec)}</span>
          <span className="hv-deg">
            ({h.ra.toFixed(5)}, {h.dec >= 0 ? '+' : ''}
            {h.dec.toFixed(5)})
          </span>
          <strong>
            {Number.isFinite(h.value)
              ? isExternal
                ? `${fmtValue(h.value)} (survey units)`
                : `${isDiff ? 'Δ ' : ''}${t('hover.value', { value: fmtValue(h.value) })}`
              : t('hover.nodata')}
          </strong>
        </>
      ) : (
        <span className="muted">{t('hover.hint')}</span>
      )}
    </p>
  );
}

// ------------------------------------------------------------------ view switcher and field of view

const VIEWS: ViewKind[] = ['blink', 'cube', 'sky'];

export function ViewSwitcher() {
  const t = useT();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <div className="view-switch" role="tablist" aria-label={t('view.label')}>
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          className={`btn small${view === v ? ' active' : ''}`}
          onClick={() => setView(v)}
          data-testid={`view-${v}`}
        >
          {t(`view.${v}`)}
        </button>
      ))}
    </div>
  );
}

export function FovControl() {
  const t = useT();
  const fov = useApp((s) => s.fovArcsec);
  const choices = FOV_CHOICES_ARCSEC.includes(fov) ? FOV_CHOICES_ARCSEC : [...FOV_CHOICES_ARCSEC, fov].sort((a, b) => a - b);
  return (
    <label className="fov-control">
      <span>{t('fov.label')}</span>
      <select value={fov} onChange={(e) => getPipeline()?.setFov(Number(e.target.value))} data-testid="fov-select">
        {choices.map((c) => (
          <option key={c} value={c}>
            {t('fov.option', { n: Number((c / 60).toFixed(1)) })}
          </option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ notices

export function NoticeBar() {
  const t = useT();
  const notices = useApp((s) => s.notices);
  const remove = useApp((s) => s.removeNotice);
  if (!notices.length) return null;
  return (
    <ul className="notice-bar" data-testid="notices">
      {notices.map((n) => (
        <li key={n.id} className={`notice ${n.level ?? 'info'}`}>
          <span>{t(n.text, n.vars)}</span>
          {n.action && (
            <button type="button" className="btn small" onClick={() => n.action!.run()}>
              {t(n.action.label, n.action.vars)}
            </button>
          )}
          <button type="button" className="btn icon small" aria-label={t('pipeline.dismiss')} title={t('pipeline.dismiss')} onClick={() => remove(n.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ landing and sky map

export function openSkyPick(pos: SkyPos, name?: string): void {
  const p = getPipeline();
  if (!p) return;
  useApp.getState().setView('blink');
  void p.open(name ? { name } : { ra: pos.ra, dec: pos.dec });
}

export function SkyMapView() {
  const center = useApp((s) => s.center);
  return (
    <div className="sky-view-host" data-testid="sky-view">
      <SkyView onPick={openSkyPick} center={center} />
    </div>
  );
}

export function Landing() {
  const t = useT();
  return (
    <div className="landing" data-testid="landing">
      <div className="landing-map">
        <SkyView onPick={openSkyPick} center={null} />
      </div>
      <div className="landing-side">
        <h2>{t('landing.title')}</h2>
        <p className="hint">{t('landing.lead')}</p>
        <h3>{t('landing.targets')}</h3>
        <ul className="landing-targets">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button type="button" className="btn" onClick={() => openSkyPick({ ra: p.target.ra, dec: p.target.dec }, p.target.name)} data-testid={`landing-${p.id}`}>
                <strong>{t(`mission.${p.id}.name`) === `mission.${p.id}.name` ? p.target.name : t(`mission.${p.id}.name`)}</strong>
                <span className="muted small">{p.target.objectType}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
