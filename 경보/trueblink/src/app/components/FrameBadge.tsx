// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The label every frame carries: date range in amber (time), wavelength range in cyan, exposure count, warnings.
import { mjdToIsoDate, type SkyFrame } from '../../core/types';
import { useT } from '../i18n';
import { useApp } from '../store';

export function dateRange(f: SkyFrame): string {
  const a = mjdToIsoDate(f.meta.mjdMin);
  const b = mjdToIsoDate(f.meta.mjdMax);
  return a === b ? a : `${a} – ${b.slice(a.slice(0, 5) === b.slice(0, 5) ? 5 : 0)}`;
}

export function waveRange(f: SkyFrame): string {
  const { waveMin: a, waveMax: b } = f.meta;
  return Math.abs(b - a) < 0.005 ? `${a.toFixed(2)} µm` : `${a.toFixed(2)}–${b.toFixed(2)} µm`;
}

export function FrameBadge({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const frames = useApp((s) => s.frames);
  const i = useApp((s) => s.frameIndex);
  const f = frames[i];
  if (!f) return null;
  const isDiff = f.meta.kind === 'difference';
  const notes = [...(f.meta.notes ?? [])];
  return (
    <div className={`frame-badge${compact ? ' compact' : ''}`} aria-live="polite" data-testid="frame-badge">
      <span className="fb-count">{t('badge.frame', { i: i + 1, n: frames.length })}</span>
      <span className="fb-time" title={t('badge.time')}>
        <span className="fb-dot" aria-hidden="true" />
        {isDiff ? f.meta.label.split(' · ')[0] : dateRange(f)}
      </span>
      <span className="fb-wave" title={t('badge.wave')}>
        <span className="fb-dot" aria-hidden="true" />
        {waveRange(f)}
      </span>
      <span className="fb-exp">{f.meta.nExposures === 1 ? t('badge.exposure1') : t('badge.exposures', { n: f.meta.nExposures })}</span>
      {!compact &&
        notes.map((n) => (
          <span key={n} className={`chip ${/^like-with-like/.test(n) ? 'chip-good' : 'chip-warn'}`} data-testid={/^like-with-like/.test(n) ? 'like-chip' : undefined}>
            {t(n)}
          </span>
        ))}
      {f.meta.kind === 'external' && f.meta.source && <span className="chip chip-warn">{f.meta.source}</span>}
    </div>
  );
}
