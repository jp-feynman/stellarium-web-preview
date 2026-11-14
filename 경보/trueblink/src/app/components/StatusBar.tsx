// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Progress while exposures stream in, a cancel button, and friendly errors that say what to try.
import { useT } from '../i18n';
import { getPipeline } from '../seams';
import { useApp } from '../store';
import { openInput } from './TopBar';
import { PRESETS } from '../presets';
import { INITIAL_EXPOSURES_PER_FIELD, MAX_EXPOSURES_PER_FIELD } from '../config';
import { pixelSourceCounts, session, useSessionVersion } from '../session';

/** "pixels from the baked bundle 358 · live from NASA's archive 12": where the loaded cutouts came from. */
function PixelSources() {
  const t = useT();
  useSessionVersion();
  const c = pixelSourceCounts(session);
  const total = c.bundle + c.cache + c.archive;
  if (!total) return null;
  const parts = (['bundle', 'cache', 'archive'] as const)
    .filter((k) => c[k] > 0)
    .map((k) => (c[k] === total ? t(`status.pixels.${k}`) : `${t(`status.pixels.${k}`)} ${c[k]}`));
  return (
    <span className="status-src" data-testid="pixel-source" title={t('status.pixels.title', { date: session.bundle?.generated?.slice(0, 10) ?? '-' })}>
      {parts.join(' · ')}
    </span>
  );
}

type MaybeLoadMore = { loadMore?: () => void; reopen?: () => void };

function PresetLinks() {
  const t = useT();
  return (
    <span className="preset-links">
      <span>{t('status.relayPresets')}</span>
      {PRESETS.map((p) => (
        <button key={p.id} type="button" className="btn small" onClick={() => void getPipeline()?.open({ name: p.target.name })}>
          {p.target.name}
        </button>
      ))}
    </span>
  );
}

function hintKey(message: string): string {
  if (/find|resolve|name|unknown target/i.test(message)) return 'status.hint.resolve';
  if (/network|fetch|timeout|timed out|HTTP|offline|CORS/i.test(message)) return 'status.hint.network';
  if (/no exposures|no data|not covered/i.test(message)) return 'status.hint.empty';
  return 'status.hint.generic';
}

export function StatusBar() {
  const t = useT();
  const status = useApp((s) => s.status);
  const frames = useApp((s) => s.frames.length);
  const visits = useApp((s) => s.visits.length);
  const exposures = useApp((s) => s.exposures.length);
  const demo = useApp((s) => s.demo);
  const query = useApp((s) => s.query);
  useSessionVersion();
  const used = demo ? exposures : session.exposureFrames.size;
  const remaining = status.remaining ?? 0;
  const cancelled = status.message === 'cancelled';
  const previewLoading = status.phase === 'loading' && status.total <= INITIAL_EXPOSURES_PER_FIELD && remaining > 0;
  const busy = status.phase === 'resolving' || status.phase === 'searching' || status.phase === 'loading';
  const pct = status.total > 0 ? Math.round((100 * status.loaded) / status.total) : 0;

  let text = '';
  if (status.phase === 'resolving') text = t('status.resolving', { name: status.message || query });
  else if (status.phase === 'searching') text = t('status.searching');
  else if (status.phase === 'loading') text = t(previewLoading ? 'status.previewLoading' : 'status.loading', { loaded: status.loaded, total: status.total });
  else if (status.phase === 'ready') text = demo
    ? t('status.ready', { frames, visits, exposures })
    : t(cancelled ? 'status.stopped' : remaining > 0 ? 'status.previewReady' : 'status.dataReady', { frames, used, exposures });
  else if (status.phase === 'idle') text = status.message === 'cancelled' ? t('status.cancelled') : t('status.idle');

  if (status.phase === 'error') {
    return (
      <div className="statusbar error" role="alert" data-testid="status">
        <strong>{t('status.error')}:</strong>
        <span className="status-msg">{status.message}</span>
        <span className="status-hint">{t(hintKey(status.message ?? ''))}</span>
        {query && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const p = getPipeline() as (ReturnType<typeof getPipeline> & MaybeLoadMore) | null;
              if (p?.reopen) p.reopen();
              else openInput(query);
            }}
          >
            {t('status.retry')}
          </button>
        )}
        {/relay|unreachable|no exposures|not covered|edge of a detector|could not find|nothing to open/i.test(status.message ?? '') && <PresetLinks />}
      </div>
    );
  }

  return (
    <div className={`statusbar${busy ? ' busy' : ''}`} role="status" aria-live="polite" data-testid="status" data-phase={status.phase}>
      <span className="status-msg">{text}</span>
      {(status.phase === 'loading' || status.phase === 'ready') && <PixelSources />}
      {status.phase === 'ready' && remaining > 0 && !cancelled && (
        <span className="status-hint" data-testid="partial-data">{t('status.partialData')}</span>
      )}
      {status.phase === 'loading' && (
        <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {busy && (
        <button type="button" className="btn small" onClick={() => getPipeline()?.cancel()} data-testid="cancel">
          {t('status.cancel')}
        </button>
      )}
      {!busy && cancelled && query && (
        <button type="button" className="btn small" onClick={() => (getPipeline() as (ReturnType<typeof getPipeline> & MaybeLoadMore) | null)?.reopen?.()}>
          {t('status.retry')}
        </button>
      )}
      {!busy && remaining > 0 && !cancelled && (
        <button
          type="button"
          className="btn small"
          data-testid="load-more"
          onClick={() => (getPipeline() as (ReturnType<typeof getPipeline> & MaybeLoadMore) | null)?.loadMore?.()}
        >
          {t(remaining <= MAX_EXPOSURES_PER_FIELD ? 'pipeline.loadRemaining' : 'pipeline.loadMore', { n: Math.min(MAX_EXPOSURES_PER_FIELD, remaining) })}
        </button>
      )}
    </div>
  );
}
