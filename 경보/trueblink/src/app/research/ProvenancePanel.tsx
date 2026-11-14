// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Provenance first: every result says which files, dates and software produced it, and how far up
// the evidence ladder it goes. Observed (pixels exist) -> Detected (above the noise) -> Classified
// (matched to a known kind of object) -> Inferred (a physical conclusion from a model). Each rung
// needs the ones below it; we never show a claim higher than the evidence supports.

import { useT } from './chart';
import { evidenceSteps, fill } from './helpers';
import type { EvidenceLevel } from './helpers';
import type { Translate } from './strings';

export interface ProvenanceItem {
  label: string;
  value: string;
  href?: string;
}

export interface Citation {
  label: string;
  doi?: string;
  url?: string;
}

export interface ProvenancePanelProps {
  items: ProvenanceItem[];
  citations: Citation[];
  level: EvidenceLevel;
  onExportJson?: () => void;
  onExportCsv?: () => void;
  t?: Translate;
}

export function ProvenancePanel(props: ProvenancePanelProps) {
  const t = useT(props.t);
  const steps = evidenceSteps(props.level);
  return (
    <section className="rs-card rs-prov" aria-label={t('prov.title')}>
      <header className="rs-cardhead">
        <h3>{t('prov.title')}</h3>
        <span className="rs-actions">
          {props.onExportJson && (
            <button type="button" className="rs-btn" onClick={props.onExportJson}>
              {t('common.exportJson')}
            </button>
          )}
          {props.onExportCsv && (
            <button type="button" className="rs-btn" onClick={props.onExportCsv}>
              {t('common.exportCsv')}
            </button>
          )}
        </span>
      </header>
      <ol className="rs-stepper" aria-label={`${t('prov.stepper')}: ${t(`prov.level.${props.level}`)}`}>
        {steps.map((s, i) => (
          <li key={s.level} className={`rs-step rs-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="rs-stepdot" aria-hidden="true">
              {s.state === 'done' ? '✓' : i + 1}
            </span>
            <span className="rs-steptext">
              <strong>{t(`prov.level.${s.level}`)}</strong>
              <span>{s.state === 'todo' ? t('prov.notClaimed') : t(`prov.desc.${s.level}`)}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="rs-claim">{fill(t('prov.claim'), { level: t(`prov.level.${props.level}`) })}</p>
      <dl className="rs-dl">
        {props.items.map((it, i) => (
          <div key={`${it.label}-${i}`}>
            <dt>{it.label}</dt>
            <dd>
              {it.href ? (
                <a href={it.href} target="_blank" rel="noopener noreferrer">
                  {it.value}
                </a>
              ) : (
                it.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {props.citations.length > 0 && (
        <>
          <h4>{t('prov.citations')}</h4>
          <ul className="rs-cites">
            {props.citations.map((c, i) => {
              const href = c.doi ? `https://doi.org/${c.doi}` : c.url;
              return (
                <li key={i}>
                  {c.label}
                  {href && (
                    <>
                      {' · '}
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {c.doi ? `doi:${c.doi}` : c.url}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
