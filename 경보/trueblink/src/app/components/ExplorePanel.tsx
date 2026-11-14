// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The public side panel: a guided mission per challenge target, plain-language findings,
// the "What am I looking at?" artefact guide and the "Why TrueBlink?" explainer.
import { useState } from 'react';
import { useT } from '../i18n';
import { presetForTarget, type MissionStep } from '../presets';
import { useApp, type Finding } from '../store';

/** A guided step only sets store fields; App rebuilds the sequence when sequence or band change. */
function applyStep(s: MissionStep) {
  const st = useApp.getState();
  st.setSequence(s.sequence);
  st.setBandGroup(s.band);
  st.setZoom(s.zoom);
}

/** The finding a challenge target is about: brightness for the variable stars, motion for the movers. */
function primaryKind(presetId: string | undefined): Finding['kind'] {
  return presetId === 'rwaur' || presetId === 'rdra' ? 'brightness' : 'motion';
}

function resultFinding(findings: Finding[], presetId?: string): Finding | undefined {
  const kind = primaryKind(presetId);
  return findings.find((f) => f.kind === kind && f.value) ?? findings.find((f) => f.reference && f.value) ?? undefined;
}

/** Findings with the target's own kind first (stable otherwise). */
export function orderFindings(findings: Finding[], presetId?: string): Finding[] {
  const kind = primaryKind(presetId);
  return [...findings.filter((f) => f.kind === kind), ...findings.filter((f) => f.kind !== kind)];
}

export function MissionCard() {
  const t = useT();
  const target = useApp((s) => s.target);
  const findings = useApp((s) => s.findings);
  const sequence = useApp((s) => s.sequence);
  const band = useApp((s) => s.bandGroupId);
  const zoom = useApp((s) => s.zoom);
  const demo = useApp((s) => s.demo);
  const center = useApp((s) => s.center);
  const preset = presetForTarget(target);

  if (!preset) {
    if (!center) return null;
    return (
      <article className="card mission" data-testid="mission-card">
        <h2>{t('mission.custom.title')}</h2>
        <p className="mono small">
          RA {center.ra.toFixed(4)}° · Dec {center.dec >= 0 ? '+' : ''}
          {center.dec.toFixed(4)}°
        </p>
        <p>{t('mission.custom.story')}</p>
      </article>
    );
  }

  const r = resultFinding(findings, preset?.id);
  const id = preset.id;
  return (
    <article className="card mission" data-testid="mission-card">
      <p className="eyebrow">{t('mission.title')}</p>
      <h2>
        {t(`mission.${id}.name`)} <span className="tag">{t(`mission.${id}.tag`)}</span>
      </h2>
      <p>{t(`mission.${id}.story`)}</p>
      <h3>{t('mission.look')}</h3>
      <p>{t(`mission.${id}.look`)}</p>
      <h3>{t('mission.steps')}</h3>
      <ol className="steps">
        {preset.steps.map((s, k) => {
          const active = s.sequence === sequence && s.band === band && Math.abs(s.zoom - zoom) < 0.01;
          return (
            <li key={s.key}>
              <button type="button" className={`step${active ? ' active' : ''}`} onClick={() => applyStep(s)} aria-pressed={active} data-testid={`step-${k + 1}`}>
                <span className="step-n">{k + 1}</span>
                <span className="step-text">{t(s.key)}</span>
                <span className="step-meta">
                  {t(`seq.${s.sequence}`)} · <span className="wave-text">{t(`band.${s.band}`)}</span>
                  {s.zoom > 1 ? ` · ${s.zoom}×` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="result" data-testid="mission-result">
        <h3>
          {t('mission.result')}
          {demo && <span className="chip chip-demo">DEMO</span>}
        </h3>
        {r ? (
          <p>
            {r.reference
              ? t('mission.result.compare', { value: r.value ?? '', reference: r.reference.replace(/\s*\(catalogue\)$/, '') })
              : t('mission.result.value', { title: r.title, value: r.value ?? '' })}{' '}
            <span className={`conf conf-${r.confidence}`}>{t(`findings.confidence.${r.confidence}`)}</span>
          </p>
        ) : (
          <p className="muted">{t('mission.result.pending')}</p>
        )}
      </div>
    </article>
  );
}

export function FindingsList() {
  const t = useT();
  const raw = useApp((s) => s.findings);
  const target = useApp((s) => s.target);
  const findings = orderFindings(raw, presetForTarget(target)?.id);
  return (
    <section className="card findings" aria-labelledby="findings-h" data-testid="findings">
      <h2 id="findings-h">{t('findings.title')}</h2>
      {findings.length === 0 ? (
        <p className="muted">{t('findings.empty')}</p>
      ) : (
        <ul>
          {findings.map((f) => (
            <li key={f.id} className={`finding kind-${f.kind}`}>
              <div className="finding-head">
                <strong>{t(f.title)}</strong>
                <span className={`conf conf-${f.confidence}`}>{t(`findings.confidence.${f.confidence}`)}</span>
              </div>
              <p>{t(f.body)}</p>
              {(f.value || f.reference) && (
                <dl className="finding-vals">
                  {f.value && (
                    <>
                      <dt>{t('findings.ours')}</dt>
                      <dd>{f.value}</dd>
                    </>
                  )}
                  {f.reference && (
                    <>
                      <dt>{t('findings.catalogue')}</dt>
                      <dd>{f.reference}</dd>
                    </>
                  )}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hint small">{t('findings.candidate')}</p>
    </section>
  );
}

export const ARTIFACT_IDS = ['colour', 'cosmic', 'saturated', 'ghost', 'persist', 'streak', 'airglow', 'crosstalk', 'edge', 'blend', 'dipole', 'twinkle'] as const;

function ArtifactIcon({ id }: { id: string }) {
  // Tiny schematic drawings, not data.
  switch (id) {
    case 'cosmic':
      return <svg viewBox="0 0 32 32"><rect x="14" y="14" width="4" height="4" className="ic-hot" /></svg>;
    case 'saturated':
      return <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" className="ic-star" /><circle cx="16" cy="16" r="3.5" className="ic-hole" /><rect x="15" y="2" width="2" height="28" className="ic-star" opacity="0.5" /></svg>;
    case 'ghost':
      return <svg viewBox="0 0 32 32"><circle cx="10" cy="16" r="3" className="ic-star" /><circle cx="24" cy="16" r="5" className="ic-soft" /></svg>;
    case 'persist':
      return <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="4" className="ic-soft" /></svg>;
    case 'streak':
      return <svg viewBox="0 0 32 32"><path d="M3 26 29 6" className="ic-line" /></svg>;
    case 'airglow':
      return <svg viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="3" className="ic-soft" /></svg>;
    case 'crosstalk':
      return <svg viewBox="0 0 32 32"><circle cx="6" cy="16" r="3" className="ic-star" /><circle cx="16" cy="16" r="1.5" className="ic-soft" /><circle cx="26" cy="16" r="1.5" className="ic-soft" /></svg>;
    case 'edge':
      return <svg viewBox="0 0 32 32"><rect x="3" y="3" width="10" height="26" className="ic-hatch" /><rect x="13" y="3" width="16" height="26" className="ic-soft" opacity="0.4" /></svg>;
    case 'blend':
      return <svg viewBox="0 0 32 32"><circle cx="13" cy="16" r="6" className="ic-soft" /><circle cx="19" cy="16" r="6" className="ic-cold" /></svg>;
    case 'dipole':
      return <svg viewBox="0 0 32 32"><circle cx="11" cy="16" r="5" className="ic-neg" /><circle cx="21" cy="16" r="5" className="ic-pos" /></svg>;
    case 'twinkle':
      return <svg viewBox="0 0 32 32"><rect x="8" y="8" width="8" height="8" className="ic-star" /><rect x="16" y="8" width="8" height="8" className="ic-soft" /><rect x="8" y="16" width="8" height="8" className="ic-soft" /><rect x="16" y="16" width="8" height="8" className="ic-soft" opacity="0.5" /></svg>;
    default:
      return <svg viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="20" rx="3" className="ic-rainbow" /></svg>;
  }
}

export function ArtifactGuide() {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card artifacts" aria-labelledby="art-h" data-testid="artifact-guide">
      <h2 id="art-h">{t('artifacts.title')}</h2>
      <p className="muted">{t('artifacts.intro')}</p>
      <ul className="art-grid">
        {ARTIFACT_IDS.map((id) => {
          const isOpen = open === id;
          return (
            <li key={id} className={`art${isOpen ? ' open' : ''}`}>
              <button type="button" className="art-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                <span className="art-icon" aria-hidden="true">
                  <ArtifactIcon id={id} />
                </span>
                <span className="art-title">{t(`art.${id}.title`)}</span>
              </button>
              {isOpen && (
                <div className="art-body">
                  <p>{t(`art.${id}.body`)}</p>
                  <p>
                    <strong>{t('artifacts.tell')}:</strong> {t(`art.${id}.tell`)}
                  </p>
                  <p className="small">
                    <strong>{t('artifacts.flag')}:</strong> <code>{t(`art.${id}.flag`)}</code>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Linear variable filter diagram: the same star lands on a different colour stripe in each exposure. */
function LvfDiagram() {
  const t = useT();
  // Bottom of the detector (row 0) is the long-wavelength (red) end, the top the short (blue) end.
  const stops = ['#ff7a66', '#ffb454', '#e6d45a', '#5fd38d', '#38c6e0', '#4f8dff', '#7a5cff'];
  const exps = [0, 1, 2, 3];
  return (
    <svg className="lvf" viewBox="0 0 320 132" role="img" aria-label={t('why.diagram')}>
      <defs>
        <linearGradient id="lvf-grad" x1="0" y1="1" x2="0" y2="0">
          {stops.map((c, k) => (
            <stop key={c} offset={`${(k / (stops.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      {exps.map((k) => {
        const x = 54 + k * 66;
        const sy = 96 - k * 22;
        return (
          <g key={k}>
            <rect x={x} y="12" width="48" height="96" rx="4" fill="url(#lvf-grad)" opacity="0.85" />
            <circle cx={x + 24} cy={sy} r="6" className="lvf-star" />
            <text x={x + 24} y="124" textAnchor="middle" className="lvf-label">
              {t('why.exposure')} {k + 1}
            </text>
          </g>
        );
      })}
      <text x="4" y="104" className="lvf-axis">{t('why.long')}</text>
      <text x="4" y="20" className="lvf-axis">{t('why.short')}</text>
    </svg>
  );
}

export function WhyTrueBlink() {
  const t = useT();
  return (
    <section className="card why" aria-labelledby="why-h" data-testid="why">
      <h2 id="why-h">{t('why.title')}</h2>
      <LvfDiagram />
      <p>{t('why.body1')}</p>
      <p>{t('why.body2')}</p>
      <p>{t('why.body3')}</p>
    </section>
  );
}

export function ExplorePanel() {
  return (
    <div className="side-stack">
      <MissionCard />
      <FindingsList />
      <WhyTrueBlink />
      <ArtifactGuide />
    </div>
  );
}
