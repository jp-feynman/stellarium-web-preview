// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Transport bar, frame strip, sequence / band pickers, stretch and overlay controls.
import { useEffect, useRef } from 'react';
import { BAND_GROUPS, type SkyFrame, type Stretch } from '../../core/types';
import { MAX_SPEED_MS, MIN_SPEED_MS } from '../config';
import { useReducedMotion } from '../hooks';
import { useT } from '../i18n';
import { drawFrame } from '../render2d';
import { SEQUENCES, useApp, type OverlayToggles } from '../store';
import { dateRange, waveRange } from './FrameBadge';
import { revealFrameInStrip } from './filmstripScroll';

function FrameThumb({ frame, stretch }: { frame: SkyFrame; stretch: Stretch }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) drawFrame(ctx, frame, stretch, c.width, c.height);
  }, [frame, stretch]);
  return <canvas ref={ref} width={40} height={40} className="thumb" aria-hidden="true" />;
}

export function TransportBar() {
  const t = useT();
  const frames = useApp((s) => s.frames);
  const i = useApp((s) => s.frameIndex);
  const playing = useApp((s) => s.playing);
  const speedMs = useApp((s) => s.speedMs);
  const stretch = useApp((s) => s.stretch);
  const reduced = useReducedMotion();
  const { togglePlay, stepFrame, selectFrame, setSpeed, setPlaying } = useApp.getState();
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (strip && el) revealFrameInStrip(strip, el, reduced);
  }, [i, reduced]);

  const disabled = frames.length < 2;
  return (
    <div className="transport" data-testid="transport">
      <div className="transport-row">
        <button type="button" className="btn icon" onClick={() => { setPlaying(false); stepFrame(-1); }} disabled={disabled} aria-label={t('transport.prev')} title={t('transport.prev')}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4 6 10l7 6z" /></svg>
        </button>
        <button type="button" className="btn icon primary" onClick={togglePlay} disabled={disabled} aria-pressed={playing} aria-label={playing ? t('transport.pause') : t('transport.play')} title={playing ? t('transport.pause') : t('transport.play')} data-testid="play">
          {playing ? (
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6z" /></svg>
          )}
        </button>
        <button type="button" className="btn icon" onClick={() => { setPlaying(false); stepFrame(1); }} disabled={disabled} aria-label={t('transport.next')} title={t('transport.next')}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l7 6-7 6z" /></svg>
        </button>
        <label className="speed">
          <span>{t('transport.speed')}</span>
          <input
            type="range"
            min={MIN_SPEED_MS}
            max={MAX_SPEED_MS}
            step={50}
            // Slider to the right = faster, so invert the milliseconds.
            value={MAX_SPEED_MS + MIN_SPEED_MS - speedMs}
            onChange={(e) => setSpeed(MAX_SPEED_MS + MIN_SPEED_MS - Number(e.target.value))}
            aria-valuetext={t('transport.speedValue', { s: (speedMs / 1000).toFixed(2) })}
          />
          <span className="speed-val">{(speedMs / 1000).toFixed(1)} s</span>
        </label>
      </div>
      <div className="strip" ref={stripRef} role="listbox" aria-label={t('transport.frames')}>
        {frames.map((f, k) => (
          <button
            key={k}
            type="button"
            role="option"
            aria-selected={k === i}
            data-index={k}
            className={`strip-chip${k === i ? ' active' : ''}`}
            onClick={() => { setPlaying(false); selectFrame(k); }}
            title={f.meta.label}
          >
            <FrameThumb frame={f} stretch={stretch} />
            <span className="strip-text">
              <span className="strip-num">{k + 1}</span>
              <span className="t-time">{f.meta.kind === 'difference' ? f.meta.label.split(' ')[0] : dateRange(f).slice(0, 10)}</span>
              <span className="t-wave">{waveRange(f)}</span>
            </span>
          </button>
        ))}
      </div>
      {reduced && <p className="hint small">{t('transport.reducedMotion')}</p>}
    </div>
  );
}

export function SequencePicker() {
  const t = useT();
  const seq = useApp((s) => s.sequence);
  const setSequence = useApp((s) => s.setSequence);
  return (
    <fieldset className="seq-picker" data-testid="sequence-picker">
      <legend>{t('seq.label')}</legend>
      <div className="seq-options">
        {SEQUENCES.map((k) => (
          <label key={k} className={`seq-option${seq === k ? ' active' : ''}${k === 'sweep' ? ' is-wave' : ''}`}>
            <input type="radio" name="sequence" value={k} checked={seq === k} onChange={() => setSequence(k)} />
            <span className="seq-title">{t(`seq.${k}`)}</span>
            <span className="seq-help">{t(`seq.${k}.help`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function BandPicker() {
  const t = useT();
  const band = useApp((s) => s.bandGroupId);
  const balanced = useApp((s) => s.balanced);
  const { setBandGroup, setBalanced } = useApp.getState();
  return (
    <div className="band-picker">
      <label className="field">
        <span className="field-label wave-label">{t('band.label')}</span>
        <select value={band} onChange={(e) => setBandGroup(e.target.value)} data-testid="band-select">
          {BAND_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {t(`band.${g.id}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={balanced} onChange={(e) => setBalanced(e.target.checked)} />
        <span>{t('band.balanced')}</span>
      </label>
    </div>
  );
}

export function StretchControls() {
  const t = useT();
  const s = useApp((st) => st.stretch);
  const setStretch = useApp((st) => st.setStretch);
  const modes: Stretch['mode'][] = ['asinh', 'linear', 'sqrt', 'log'];
  const maps: Stretch['colormap'][] = ['gray', 'heat', 'viridis', 'diverging'];
  return (
    <div className="stretch" title={t('stretch.shared')}>
      <label className="field">
        <span className="field-label">{t('stretch.mode')}</span>
        <select value={s.mode} onChange={(e) => setStretch({ mode: e.target.value as Stretch['mode'] })}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`stretch.mode.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">{t('stretch.contrast')}</span>
        <input type="range" min={1} max={60} step={1} value={s.q} onChange={(e) => setStretch({ q: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label">{t('stretch.colormap')}</span>
        <select value={s.colormap} onChange={(e) => setStretch({ colormap: e.target.value as Stretch['colormap'] })}>
          {maps.map((m) => (
            <option key={m} value={m}>
              {t(`stretch.colormap.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.invert} onChange={(e) => setStretch({ invert: e.target.checked })} />
        <span>{t('stretch.invert')}</span>
      </label>
    </div>
  );
}

export function OverlayToggles() {
  const t = useT();
  const on = useApp((s) => s.overlaysOn);
  const setOverlayOn = useApp((s) => s.setOverlayOn);
  const keys: (keyof OverlayToggles)[] = ['gaia', 'track', 'flags', 'solarSystem'];
  return (
    <div className="overlay-toggles" role="group" aria-label={t('viewer.overlays')}>
      {keys.map((k) => (
        <button key={k} type="button" className={`toggle${on[k] ? ' on' : ''}${k === 'track' ? ' is-time' : ''}`} aria-pressed={on[k]} onClick={() => setOverlayOn(k, !on[k])}>
          {t(`viewer.overlay.${k}`)}
        </button>
      ))}
    </div>
  );
}

export function ZoomControls() {
  const t = useT();
  const zoom = useApp((s) => s.zoom);
  const setZoom = useApp((s) => s.setZoom);
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button type="button" className="btn icon small" onClick={() => setZoom(zoom / 1.5)} aria-label={t('viewer.zoomOut')} title={t('viewer.zoomOut')} disabled={zoom <= 1}>
        −
      </button>
      <button type="button" className="btn small" onClick={() => setZoom(1)} title={t('viewer.zoomReset')}>
        {zoom.toFixed(1)}×
      </button>
      <button type="button" className="btn icon small" onClick={() => setZoom(zoom * 1.5)} aria-label={t('viewer.zoomIn')} title={t('viewer.zoomIn')} disabled={zoom >= 16}>
        +
      </button>
    </div>
  );
}
