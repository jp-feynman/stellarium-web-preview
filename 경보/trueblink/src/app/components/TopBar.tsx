// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Name, search (name or coordinates), challenge presets, mode and language toggles, share and About.
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '../config';
import { useT } from '../i18n';
import { parseCoordinatesLoose } from '../parseInput';
import { PRESETS } from '../presets';
import { getPipeline } from '../seams';
import { useApp } from '../store';
import { SkyLink } from './SkyLink';

export function openInput(text: string): void {
  const p = getPipeline();
  if (!p || !text.trim()) return;
  const pos = parseCoordinatesLoose(text);
  void p.open(pos ? { ra: pos.ra, dec: pos.dec } : { name: text.trim() });
}

export function TopBar() {
  const t = useT();
  const query = useApp((s) => s.query);
  const uiMode = useApp((s) => s.uiMode);
  const lang = useApp((s) => s.lang);
  const target = useApp((s) => s.target);
  const { setQuery, setUiMode, setLang, setAboutOpen } = useApp.getState();
  const [toast, setToast] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    openInput(query);
  };

  const share = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(window.location.href);
      ok = true;
    } catch {
      ok = false;
    }
    setToast(ok ? t('share.copied') : t('share.failed'));
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="11" cy="16" r="6" className="logo-a" />
          <circle cx="21" cy="16" r="6" className="logo-b" />
        </svg>
        <div>
          <h1>{APP_NAME}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
      </div>

      <form className="search" role="search" onSubmit={submit}>
        <label htmlFor="search-input" className="sr-only">
          {t('search.label')}
        </label>
        <input
          id="search-input"
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="search-examples"
          data-testid="search-input"
        />
        <button type="submit" className="btn primary">
          {t('search.go')}
        </button>
        <p id="search-examples" className="hint small">
          {t('search.examples')}
        </p>
      </form>

      <div className="topbar-actions">
        <div className="seg" role="group" aria-label={t('mode.label')}>
          {(['explore', 'research'] as const).map((m) => (
            <button key={m} type="button" className={uiMode === m ? 'on' : ''} aria-pressed={uiMode === m} onClick={() => setUiMode(m)} data-testid={`mode-${m}`}>
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={t('lang.label')}>
          {(['en', 'ko'] as const).map((l) => (
            <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)} lang={l} data-testid={`lang-${l}`}>
              {l === 'en' ? 'EN' : '한국어'}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={share}>
          {t('share.button')}
        </button>
        <button type="button" className="btn" onClick={() => setAboutOpen(true)} data-testid="about-button">
          {t('about.button')}
        </button>
        {toast && (
          <span className="toast" role="status">
            {toast}
          </span>
        )}
      </div>

      <nav className="presets" aria-label={t('presets.label')}>
        <span className="presets-label">{t('presets.label')}</span>
        <div className="preset-chips">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-chip${target?.id === p.id ? ' active' : ''}`}
              aria-pressed={target?.id === p.id}
              onClick={() => void getPipeline()?.open({ name: p.target.name })}
              data-testid={`preset-${p.id}`}
            >
              <strong>{t(`mission.${p.id}.name`)}</strong>
              <span>{t(`mission.${p.id}.tag`)}</span>
            </button>
          ))}
        </div>
        <SkyLink />
      </nav>
    </header>
  );
}
