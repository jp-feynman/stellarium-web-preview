// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Research-mode Asteroid tab and the Solar System overlays of the blink view.
// The tab shows asteroids this project measured on real SPHEREx DR1 exposures
// (public/data/asteroids): reflectance against Bus-DeMeo class means, the heat-glow model band and an
// indicative group or a stated refusal, all recomputed in the browser with core/solar. Below it, the known
// Solar System objects of the open field (session.solarSystem, filled by solarSystemOverlays).
import { useEffect, useMemo, useState } from 'react';
import { THERMAL_NOTES } from '../../core/solar';
import { mjdToIsoDate } from '../../core/types';
import { useLang, useT } from '../i18n';
import { AsteroidPanel, makeT, researchStringsKo } from '../research';
import type { Classification } from '../research';
import { session, useSessionVersion } from '../session';
import { useApp } from '../store';
import { analyseAsteroid, type AsteroidFile } from './analysis';
import { ASTEROID_INDEX, loadAsteroid } from './data';
import { JihoAnalysis } from './JihoAnalysis';
import { jihoStrings } from './jiho-strings';
import './strings';
import './asteroid.css';

export { solarSystemOverlays, SMEAR_NOTE } from './overlays';

type T = (key: string, vars?: Record<string, string | number>) => string;

const fmt = (v: number | undefined, d: number) => (v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d));

function Facts({ file, t }: { file: AsteroidFile; t: T }) {
  const c = file.catalogue;
  const rows: { k: string; v?: string; src?: string; missing?: string }[] = [
    { k: 'astro.fact.type', v: c.taxonomy ? `${c.taxonomy.value} · ${c.taxonomy.system}` : undefined, src: c.taxonomy?.source },
    { k: 'astro.fact.diameter', v: c.diameterKm ? `${c.diameterKm.value} km` : undefined, src: c.diameterKm?.source },
    { k: 'astro.fact.albedo', v: c.albedoV ? String(c.albedoV.value) : undefined, src: c.albedoV?.source },
    { k: 'astro.fact.H', v: c.H ? String(c.H.value) : undefined, src: c.H ? `JPL SBDB (${c.H.source})` : undefined },
    { k: 'astro.fact.G', v: c.G ? String(c.G.value) : undefined, src: c.G?.source, missing: t('astro.gAssumed') },
    { k: 'astro.fact.period', v: c.rotationPeriodH ? `${c.rotationPeriodH.value} h` : undefined, src: c.rotationPeriodH?.source },
  ];
  return (
    <section className="astro-block" aria-labelledby="astro-facts">
      <h4 id="astro-facts">{t('astro.facts')}</h4>
      <dl className="astro-facts">
        {rows.map((r) => (
          <div key={r.k}>
            <dt>{t(r.k)}</dt>
            <dd>
              {r.v ?? <span className="astro-na">{r.missing ?? t('astro.na')}</span>}
              {r.v && r.src && <span className="astro-src">{t('astro.fact.source', { s: r.src })}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="astro-src">{c.retrieved}</p>
    </section>
  );
}

function SolarSystemSection({ t }: { t: T }) {
  useSessionVersion();
  const on = useApp((s) => s.overlaysOn.solarSystem);
  const setOverlayOn = useApp((s) => s.setOverlayOn);
  const centre = useApp((s) => s.center);
  const entries = [...session.solarSystem.entries()].filter(([k]) => k >= 0).sort((a, b) => a[0] - b[0]);
  const fieldOpen = !!(session.grid || centre);
  return (
    <section className="astro-block astro-sso" aria-labelledby="astro-sso">
      <h4 id="astro-sso">{t('astro.sso.title')}</h4>
      {!fieldOpen ? (
        <p className="astro-muted">{t('astro.sso.noField')}</p>
      ) : entries.length === 0 ? (
        on ? (
          <p className="astro-muted">{t('astro.sso.waiting')}</p>
        ) : (
          <p className="astro-muted">
            {t('astro.sso.hint')}{' '}
            <button type="button" className="astro-btn" onClick={() => setOverlayOn('solarSystem', true)}>
              {t('astro.sso.turnOn')}
            </button>
          </p>
        )
      ) : (
        entries.map(([visit, objs]) => {
          const v = session.visits.find((x) => x.index === visit);
          const date = v?.label ?? (objs[0] ? mjdToIsoDate(objs[0].mjd) : '');
          return (
            <div key={visit} className="astro-ssovisit">
              <h5>
                <span className="astro-time">{t('astro.sso.visit', { v: visit + 1, date })}</span>
              </h5>
              {objs.length === 0 ? (
                <p className="astro-muted">{t('astro.sso.none')}</p>
              ) : (
                <div className="astro-tablewrap">
                  <table className="astro-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('astro.sso.col.name')}</th>
                        <th scope="col">{t('astro.sso.col.class')}</th>
                        <th scope="col">{t('astro.sso.col.v')}</th>
                        <th scope="col">{t('astro.sso.col.motion')}</th>
                        <th scope="col">{t('astro.sso.col.dist')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...objs]
                        .sort((a, b) => (a.vMag ?? 99) - (b.vMag ?? 99))
                        .map((o) => (
                          <tr key={`${o.number ?? ''}${o.name}`}>
                            <td>{`${o.number !== undefined ? `(${o.number}) ` : ''}${o.name}`}</td>
                            <td>{o.objectClass ?? ''}</td>
                            <td className="num">{fmt(o.vMag, 1)}</td>
                            <td className="num">{o.dRa !== undefined && o.dDec !== undefined ? Math.hypot(o.dRa, o.dDec).toFixed(1) : ''}</td>
                            <td className="num">{fmt(o.deltaAu, 2)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
      <p className="astro-note">{t('astro.sso.smear')}</p>
      <p className="astro-note">{t('astro.sso.observer')}</p>
    </section>
  );
}

function LegacyAsteroidAnalysis() {
  const t = useT();
  const lang = useLang();
  const [id, setId] = useState(ASTEROID_INDEX[0]?.id ?? '');
  const [file, setFile] = useState<AsteroidFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightcurve, setLightcurve] = useState(true);
  const [visit, setVisit] = useState<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    setVisit(undefined);
    loadAsteroid(id).then(
      (f) => live && setFile(f),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const analysis = useMemo(() => {
    if (!file) return null;
    try {
      return { ok: analyseAsteroid(file, { lightcurve, visit }) };
    } catch (e) {
      return { err: e instanceof Error ? e.message : String(e) };
    }
  }, [file, lightcurve, visit]);

  const panelT = lang === 'ko' ? makeT(researchStringsKo) : undefined;
  const a = analysis?.ok;
  const hasLc = !!file?.points.some((p) => Math.abs(p.lightcurve_factor - 1) > 1e-9);
  const catType = file?.catalogue.taxonomy?.value;

  const classification: Classification | undefined = a
    ? { group: a.taxonomy.group, ranked: a.taxonomy.ranked, gapToNext: a.taxonomy.gapToNext, refused: a.taxonomy.refused }
    : undefined;

  const notes: string[] = [];
  if (a && file) {
    for (const v of a.thermalByVisit) {
      notes.push(
        v.eta !== undefined
          ? t('astro.eta.ok', { v: v.visit + 1, e: v.eta.toFixed(2), s: (v.etaErr ?? NaN).toFixed(3) })
          : t('astro.eta.refused', { v: v.visit + 1, r: v.refused ?? '' }),
      );
    }
    if (a.thermal && a.thermalVisit !== undefined) notes.push(t('astro.thermal.how', { v: a.thermalVisit + 1 }));
    if (a.thermalUnavailable) notes.push(t('astro.thermal.na', { r: a.thermalUnavailable }));
    // The STM is not drawn here, so its "shown for comparison" note is left out.
    THERMAL_NOTES.forEach((n, i) => {
      if (!/\bSTM\b/.test(n)) notes.push(lang === 'ko' ? t(`astro.tnote.${i}`) : n);
    });
  }

  return (
    <div className="astro" data-testid="asteroid-legacy">
      <header className="astro-head">
        <h3>{t('astro.title')}</h3>
        <p className="astro-muted">{t('astro.intro')}</p>
      </header>

      <div className="astro-controls">
        <label>
          <span>{t('astro.pick')}</span>
          <select value={id} onChange={(e) => setId(e.target.value)} data-testid="asteroid-select">
            {ASTEROID_INDEX.map((x) => (
              <option key={x.id} value={x.id}>
                ({x.number}) {x.name}
              </option>
            ))}
          </select>
        </label>
        {file && (
          <label>
            <span>{t('astro.visit')}</span>
            <select value={visit ?? a?.thermalVisit ?? ''} onChange={(e) => setVisit(Number(e.target.value))}>
              {file.provenance.visits.map((v) => (
                <option key={v.index} value={v.index}>
                  {t('astro.visitOpt', { v: v.index + 1, from: v.from, to: v.to })}
                </option>
              ))}
            </select>
          </label>
        )}
        {file && hasLc && (
          <label className="astro-check">
            <input type="checkbox" checked={lightcurve} onChange={(e) => setLightcurve(e.target.checked)} />
            <span>{t('astro.lightcurve')}</span>
          </label>
        )}
      </div>
      {file && !hasLc && <p className="astro-muted">{t('astro.lightcurve.none')}</p>}
      {file && (
        <p className="astro-prov" data-testid="asteroid-provenance">
          <strong>{t('astro.provenance')}:</strong> {file.provenance.summary}
        </p>
      )}

      {error && <p className="astro-error">{t('astro.loadError', { e: error })}</p>}
      {!file && !error && <p className="astro-muted">{t('astro.loading')}</p>}
      {analysis?.err && <p className="astro-error">{t('astro.loadError', { e: analysis.err })}</p>}

      {a && file && (
        <>
          <AsteroidPanel
            name={a.name}
            catalogType={catType ? `${catType} (${file.catalogue.taxonomy?.system.startsWith('Bus') ? 'Bus SMASSII' : file.catalogue.taxonomy?.system})` : t('astro.na')}
            reflectance={a.reflectance}
            templates={a.templates.map((x) => ({
              ...x.template,
              label: t(x.role === 'best' ? 'astro.tpl.best' : 'astro.tpl.next', { cls: x.cls }),
            }))}
            thermal={a.thermal ? { ...a.thermal, eta: undefined, etaErr: undefined } : undefined}
            classification={classification}
            notes={notes}
            t={panelT}
          />
          <div className="astro-verdict" role="note" data-testid="asteroid-verdict">
            {a.taxonomy.refused ? (
              <p>{t('astro.class.refusedNote', { c: catType ?? t('astro.na') })}</p>
            ) : (
              <p>
                {t('astro.class.consistent', { g: a.taxonomy.group })}{' '}
                {catType &&
                  (a.catalogueGroup === a.taxonomy.group
                    ? t('astro.class.agrees', { c: catType })
                    : t('astro.class.differs', { c: catType, cg: a.catalogueGroup ?? '?' }))}
              </p>
            )}
          </div>

          <section className="astro-block astro-explain">
            <div>
              <h4>{t('astro.explain.refl.title')}</h4>
              <p>{t('astro.explain.refl')}</p>
            </div>
            <div>
              <h4>{t('astro.explain.heat.title')}</h4>
              <p>{t('astro.explain.heat')}</p>
            </div>
          </section>

          <section className="astro-block">
            <h4>{t('astro.limits')}</h4>
            <ul className="astro-list">
              <li>{t('astro.limit.rotation')}</li>
              <li>{t('astro.limit.groups')}</li>
              <li>{t('astro.limit.range')}</li>
              <li>{t('astro.limit.errors')}</li>
              <li>{t('astro.sso.smear')}</li>
            </ul>
          </section>

          <Facts file={file} t={t} />

          <details className="astro-block astro-details">
            <summary>{t('astro.provenance')}</summary>
            <p>{file.provenance.method}</p>
            <p>{file.provenance.geometry}</p>
            <p>{file.provenance.lightcurve}</p>
            <p>{file.provenance.errors}</p>
            <p>
              {file.provenance.release} · {file.provenance.measuredBy} · {file.provenance.date}
            </p>
          </details>
        </>
      )}

    </div>
  );
}

export function AsteroidTab({ initialMode = 'integrated' }: { initialMode?: 'integrated' | 'legacy' } = {}) {
  const t = useT();
  const copy = jihoStrings[useLang() === 'ko' ? 'ko' : 'en'];
  const [mode, setMode] = useState<'integrated' | 'legacy'>(initialMode);
  return <div className="astro" data-testid="asteroid-tab">
    <div className="astro-mode-buttons" role="group" aria-label={copy.title}>
      <button type="button" className="astro-btn" aria-pressed={mode === 'integrated'} onClick={() => setMode('integrated')}>{copy.integrated}</button>
      <button type="button" className="astro-btn" aria-pressed={mode === 'legacy'} onClick={() => setMode('legacy')}>{copy.legacy}</button>
    </div>
    {mode === 'integrated' ? <JihoAnalysis /> : <><p className="astro-note">{copy.originalNote}</p><LegacyAsteroidAnalysis /></>}
    <SolarSystemSection t={t} />
  </div>;
}
