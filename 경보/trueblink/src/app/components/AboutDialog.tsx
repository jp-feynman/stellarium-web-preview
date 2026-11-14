// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// What it is, data credits with DOIs, limits and honesty, AI-assistance disclosure, licences.
import { useEffect, useRef } from 'react';
import { APP_NAME, DATA_CREDITS, LICENSE_NAME, LINKS, REPOSITORY_URL, SPHEREX_ACKNOWLEDGEMENT } from '../config';
import { useT } from '../i18n';
import { useApp } from '../store';

export function AboutDialog() {
  const t = useT();
  const open = useApp((s) => s.aboutOpen);
  const setOpen = useApp((s) => s.setAboutOpen);
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab' && boxRef.current) {
        // Keep keyboard focus inside the dialog.
        const f = boxRef.current.querySelectorAll<HTMLElement>('a[href], button');
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-h" ref={boxRef} data-testid="about-dialog">
        <header className="modal-head">
          <h2 id="about-h">{t('about.title', { app: APP_NAME })}</h2>
          <button type="button" className="btn" onClick={() => setOpen(false)} ref={closeRef}>
            {t('about.close')}
          </button>
        </header>
        <div className="modal-body">
          <section>
            <h3>{t('about.what.title')}</h3>
            <p>{t('about.what.body')}</p>
          </section>
          <section className="honesty">
            <h3>{t('about.honesty.title')}</h3>
            <ul>
              <li>{t('about.honesty.body1')}</li>
              <li>{t('about.honesty.body2')}</li>
              <li>{t('about.honesty.body3')}</li>
            </ul>
          </section>
          <section>
            <h3>{t('about.credits.title')}</h3>
            <ul className="credits">
              {DATA_CREDITS.map((c) => (
                <li key={c.id}>
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>{' '}
                  <span className="muted">· {c.provider}</span>
                  {c.doi && (
                    <>
                      {' '}
                      · <span className="mono">DOI {c.doi}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="small muted ack">{SPHEREX_ACKNOWLEDGEMENT}</p>
          </section>
          <section>
            <h3>{t('about.ai.title')}</h3>
            <p>{t('about.ai.body')}</p>
          </section>
          <section>
            <h3>{t('about.licence.title')}</h3>
            <p>{t('about.licence.body', { licence: LICENSE_NAME })}</p>
            <p className="links">
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                {t('about.source')}
              </a>
              <a href={LINKS.explanatorySupplement} target="_blank" rel="noreferrer">
                {t('about.supplement')}
              </a>
              <a href={LINKS.anomalyImages} target="_blank" rel="noreferrer">
                {t('about.anomalies')}
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
