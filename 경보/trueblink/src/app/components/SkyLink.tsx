// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// "See it in the live sky": a link to the separate sky app (Stellarium Web Lab + SPHEREx, AGPL-3.0)
// when the site hosts it (SKY_APP_URL, default ./sky/). The two programs only exchange URLs.
// The address is probed once per page load; a missing app (or a host that answers every path with
// TrueBlink's own page) hides the link.
import { useEffect, useState } from 'react';
import { SKY_APP_CHANNEL, SKY_APP_FOV_DEG, SKY_APP_URL } from '../config';
import { useT } from '../i18n';
import { useApp } from '../store';

let probe: Promise<boolean> | null = null;

/** True when SKY_APP_URL serves the sky app's page. Runs at most once per page load. */
export function probeSkyApp(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      try {
        const page = new URL('index.html', new URL(SKY_APP_URL, window.location.href));
        const res = await fetch(page, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!res.ok) return false;
        const text = await res.text();
        return /stellarium/i.test(text.slice(0, 8000));
      } catch {
        return false;
      }
    })();
  }
  return probe;
}

/** Sky app address for a field (or the bare app when there is none). Pure; exported for tests. */
export function skyAppHref(base: string, field: { ra: number; dec: number; name?: string } | null): string {
  if (!field) return base;
  const p = new URLSearchParams();
  p.set('ra', String(Number(field.ra.toFixed(6))));
  p.set('dec', String(Number(field.dec.toFixed(6))));
  p.set('fov', String(SKY_APP_FOV_DEG));
  p.set('view', 'sky');
  p.set('spherex', String(SKY_APP_CHANNEL));
  if (field.name) p.set('name', field.name);
  return `${base}${base.includes('?') ? '&' : '?'}${p.toString()}`;
}

export function SkyLink() {
  const t = useT();
  const target = useApp((s) => s.target);
  const center = useApp((s) => s.center);
  const [present, setPresent] = useState(false);

  useEffect(() => {
    let alive = true;
    void probeSkyApp().then((ok) => alive && setPresent(ok));
    return () => {
      alive = false;
    };
  }, []);

  if (!present) return null;
  const field = target ? { ra: target.ra, dec: target.dec, name: target.name } : center ? { ra: center.ra, dec: center.dec } : null;
  return (
    <div className="sky-link-box">
      <span id="sky-link-hint" className="sr-only">
        {t('skyLink.hint')}
      </span>
      <a
        className="btn sky-link"
        href={skyAppHref(SKY_APP_URL, field)}
        target="_blank"
        rel="noopener"
        title={t('skyLink.hint')}
        aria-describedby="sky-link-hint"
        data-testid="sky-link"
      >
        <span className="sky-link-title">{t('skyLink.button')}</span>
        <span className="sky-link-sub">{t('skyLink.sub')}</span>
      </a>
    </div>
  );
}
