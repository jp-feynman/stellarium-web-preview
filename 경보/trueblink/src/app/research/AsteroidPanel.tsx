// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Asteroid science in two plots.
// 1. Reflectance: the measured spectrum divided by sunlight, so it shows the surface colour.
//    Bus-DeMeo class templates are normalised to 1 at 1.2 um (their near-infrared convention).
//    Absorption bands near 1 and 2 um come from minerals such as olivine and pyroxene.
// 2. "Reflected sunlight / own heat": an asteroid shines by reflected sunlight at short wavelengths
//    and by its own thermal glow at long ones. The thermal model is drawn as a band (a range of the
//    beaming parameter eta), never a single line, because eta is uncertain.
// Classification is stated as indicative (group level only) with its caveats, or as a refusal.

import { AxisX, AxisY, ChartBox, ErrBarY, Legend, markProps, useT, useTip } from './chart';
import { extent, fill, fmtNum, logTicks, niceTicks, normaliseAt, scaleLinear, scaleLog } from './helpers';
import type { Translate } from './strings';

export interface ReflectancePoint {
  wavelength: number;
  reflectance: number;
  err: number;
}

export interface ReflectanceTemplate {
  label: string;
  wavelength: number[];
  reflectance: number[];
  highlight?: boolean;
}

export interface ThermalModel {
  wavelength: number[];
  reflected: number[];
  thermalLo: number[];
  thermalHi: number[];
  measured: { wavelength: number; flux: number; err: number }[];
  crossoverUm?: [number, number];
  eta?: number;
  etaErr?: number;
}

export interface Classification {
  group: string;
  ranked: { group: string; cls: string; chi2: number }[];
  gapToNext: number;
  refused?: string;
}

export interface AsteroidPanelProps {
  name: string;
  catalogType?: string;
  /** Reflectance, already normalised to 1 at 1.2 um (core/solar toReflectance with normaliseAt 1.2). */
  reflectance: ReflectancePoint[];
  /** Templates in any normalisation; they are re-normalised at 1.2 um here. */
  templates: ReflectanceTemplate[];
  thermal?: ThermalModel;
  classification?: Classification;
  notes: string[];
  t?: Translate;
}

const TEMPLATE_DASHES = ['5 3', '2 3', '8 3 2 3', '1 2', '10 4'];

function ReflectanceChart(props: { name: string; reflectance: ReflectancePoint[]; templates: ReflectanceTemplate[]; t: Translate }) {
  const { t } = props;
  const { tip, show, hide } = useTip();
  const tpl = props.templates.map((tp) => ({ ...tp, norm: normaliseAt(tp.wavelength, tp.reflectance, 1.2) }));
  const pts = props.reflectance.filter((p) => Number.isFinite(p.reflectance));
  const ws = [...pts.map((p) => p.wavelength), 0.75, 2.45];
  const [w0, w1] = [Math.min(...ws) - 0.03, Math.max(...ws) + 0.03];
  const yv = [...pts.flatMap((p) => [p.reflectance - p.err, p.reflectance + p.err]), ...tpl.flatMap((tp) => tp.norm.filter((_, i) => tp.wavelength[i] >= w0 && tp.wavelength[i] <= w1))];
  let dashIdx = 0;
  const tplColor = tpl.map((tp) => (tp.highlight ? 'var(--accent)' : 'var(--muted)'));
  const tplDash = tpl.map((tp) => (tp.highlight ? undefined : TEMPLATE_DASHES[dashIdx++ % TEMPLATE_DASHES.length]));
  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('ast.refl.title')}</figcaption>
      <ChartBox height={(w) => Math.round(Math.max(220, Math.min(320, w * 0.6)))} ariaLabel={fill(t('ast.refl.aria'), { name: props.name })} tip={tip}>
        {(W, H) => {
          const m = { top: 12, right: 12, bottom: 44, left: 50 };
          const x = scaleLinear(w0, w1, m.left, W - m.right);
          const [lo, hi] = extent(yv, 0.08);
          const y = scaleLinear(lo, hi, H - m.bottom, m.top);
          return (
            <>
              <AxisX ticks={niceTicks(w0, w1, W < 400 ? 4 : 7).map((v) => ({ v, label: String(v) }))} scale={x} y={H - m.bottom} top={m.top} x0={m.left} x1={W - m.right} label={t('common.wavelength')} color="var(--accent-wave)" />
              <AxisY ticks={niceTicks(lo, hi, 5)} scale={y} x={m.left} x1={W - m.right} y0={m.top} y1={H - m.bottom} label={t('ast.refl.y')} />
              <line x1={x(1.2)} x2={x(1.2)} y1={m.top} y2={H - m.bottom} className="rs-normline" />
              {tpl.map((tp, i) => (
                <polyline
                  key={tp.label}
                  points={tp.wavelength
                    .map((w, k) => [w, tp.norm[k]] as const)
                    .filter(([w, r]) => w >= w0 && w <= w1 && Number.isFinite(r))
                    .map(([w, r]) => `${x(w).toFixed(1)},${y(r).toFixed(1)}`)
                    .join(' ')}
                  style={{ fill: 'none', stroke: tplColor[i], strokeWidth: tp.highlight ? 2.2 : 1.2, strokeDasharray: tplDash[i], opacity: tp.highlight ? 1 : 0.85 }}
                />
              ))}
              {pts.map((p, i) => {
                const px = x(p.wavelength);
                const py = y(p.reflectance);
                return (
                  <g key={i} className="rs-mark" {...markProps(px, py, fill(t('ast.tipRefl'), { w: fmtNum(p.wavelength, 3), r: fmtNum(p.reflectance, 3), e: fmtNum(p.err, 3) }), show, hide)}>
                    <ErrBarY x={px} y0={y(p.reflectance - p.err)} y1={y(p.reflectance + p.err)} color="var(--text)" cap={2} />
                    <circle cx={px} cy={py} r={2.8} style={{ fill: 'var(--text)' }} />
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartBox>
      <Legend items={[{ label: t('ast.measured'), color: 'var(--text)', kind: 'dot' }, ...tpl.map((tp, i) => ({ label: tp.label, color: tplColor[i], kind: tp.highlight ? ('line' as const) : ('dash' as const) }))]} />
    </figure>
  );
}

function ThermalChart(props: { thermal: ThermalModel; t: Translate }) {
  const { t, thermal: th } = props;
  const { tip, show, hide } = useTip();
  const pos = [...th.reflected, ...th.thermalLo, ...th.thermalHi, ...th.measured.map((p) => p.flux)].filter((v) => v > 0);
  // Log axis from a little below the faintest reflected or measured flux to above the brightest value.
  const floorVals = [...th.reflected, ...th.measured.map((p) => p.flux)].filter((v) => v > 0);
  const maxV = Math.max(...pos) * 2;
  const minV = Math.max(Math.min(...floorVals) / 20, maxV * 1e-5);
  const W0 = 0.7;
  const W1 = 5.1;
  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('ast.therm.title')}</figcaption>
      <ChartBox height={(w) => Math.round(Math.max(220, Math.min(320, w * 0.6)))} ariaLabel={t('ast.therm.aria')} tip={tip}>
        {(W, H) => {
          const m = { top: 12, right: 12, bottom: 44, left: 54 };
          const x = scaleLinear(W0, W1, m.left, W - m.right);
          const y = scaleLog(minV, maxV, H - m.bottom, m.top);
          // Very small model values fall far below the axis; clip the drawing to the plot area instead of squashing it.
          const clampY = (v: number) => (v > 0 ? Math.max(m.top - 50, Math.min(H - m.bottom + 400, y(v))) : H - m.bottom + 400);
          const clipId = `rs-clip-th-${W}-${H}`;
          const band =
            th.wavelength.map((w, i) => `${x(w).toFixed(1)},${clampY(th.thermalHi[i]).toFixed(1)}`).join(' ') +
            ' ' +
            [...th.wavelength.map((w, i) => `${x(w).toFixed(1)},${clampY(th.thermalLo[i]).toFixed(1)}`)].reverse().join(' ');
          return (
            <>
              <AxisX ticks={niceTicks(W0, W1, W < 400 ? 5 : 8).map((v) => ({ v, label: String(v) }))} scale={x} y={H - m.bottom} top={m.top} x0={m.left} x1={W - m.right} label={t('common.wavelength')} color="var(--accent-wave)" />
              <AxisY ticks={logTicks(minV, maxV)} scale={y} x={m.left} x1={W - m.right} y0={m.top} y1={H - m.bottom} label={t('common.fluxMjy')} />
              {th.crossoverUm && (
                <g>
                  <rect x={x(th.crossoverUm[0])} y={m.top} width={Math.max(2, x(th.crossoverUm[1]) - x(th.crossoverUm[0]))} height={H - m.top - m.bottom} className="rs-crossover" />
                  <text x={x(th.crossoverUm[0]) - 4} y={m.top + 14} textAnchor="end" className="rs-tick" style={{ fill: 'var(--d6)' }}>
                    {fill(t('ast.crossover'), { a: fmtNum(th.crossoverUm[0], 1), b: fmtNum(th.crossoverUm[1], 1) })}
                  </text>
                </g>
              )}
              <defs>
                <clipPath id={clipId}>
                  <rect x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} />
                </clipPath>
              </defs>
              <polygon points={band} className="rs-thermband" clipPath={`url(#${clipId})`} />
              <polyline
                clipPath={`url(#${clipId})`}
                points={th.wavelength
                  .map((w, i) => (th.reflected[i] > 0 ? `${x(w).toFixed(1)},${clampY(th.reflected[i]).toFixed(1)}` : ''))
                  .filter(Boolean)
                  .join(' ')}
                className="rs-reflline"
              />
              {th.measured
                .filter((p) => p.flux > 0)
                .map((p, i) => {
                  const px = x(p.wavelength);
                  const py = y(p.flux);
                  return (
                    <g key={i} className="rs-mark" {...markProps(px, py, `${fmtNum(p.wavelength, 3)} µm · ${fmtNum(p.flux, 3)} ± ${fmtNum(p.err, 3)} mJy`, show, hide)}>
                      <ErrBarY x={px} y0={clampY(p.flux - p.err)} y1={clampY(p.flux + p.err)} color="var(--text)" cap={2} />
                      <circle cx={px} cy={py} r={2.8} style={{ fill: 'var(--text)' }} />
                    </g>
                  );
                })}
            </>
          );
        }}
      </ChartBox>
      <Legend
        items={[
          { label: t('ast.measured'), color: 'var(--text)', kind: 'dot' },
          { label: t('ast.reflected'), color: 'var(--accent-wave)', kind: 'line' },
          { label: t('ast.thermal'), color: 'var(--d6)', kind: 'band' },
        ]}
      />
      {th.eta !== undefined && <p className="rs-stat">{fill(t('ast.eta'), { e: fmtNum(th.eta, 2), s: fmtNum(th.etaErr, 2) })}</p>}
    </figure>
  );
}

export function AsteroidPanel(props: AsteroidPanelProps) {
  const t = useT(props.t);
  const c = props.classification;
  return (
    <section className="rs-card rs-asteroid" aria-label={`${t('ast.title')} ${props.name}`}>
      <header className="rs-cardhead">
        <h3>
          {t('ast.title')} · {props.name}
        </h3>
        {props.catalogType && <span className="rs-muted">{fill(t('ast.catalog'), { c: props.catalogType })}</span>}
      </header>
      <div className="rs-two">
        <ReflectanceChart name={props.name} reflectance={props.reflectance} templates={props.templates} t={t} />
        {props.thermal && <ThermalChart thermal={props.thermal} t={t} />}
      </div>
      {c && (
        <div className={`rs-class ${c.refused ? 'rs-refused' : ''}`} role="status">
          {c.refused ? (
            <p>
              <strong>{fill(t('ast.class.refused'), { r: c.refused })}</strong>
            </p>
          ) : (
            <>
              <p>
                <strong>{fill(t('ast.class.indicative'), { g: c.group })}</strong>
                {' · '}
                {fill(t('ast.class.gap'), { g: fmtNum(c.gapToNext, 1) })}
              </p>
              <p className="rs-muted">
                {t('ast.class.ranked')}:{' '}
                {c.ranked
                  .slice(0, 3)
                  .map((r) => `${r.cls} (${r.group}, χ² ${fmtNum(r.chi2, 1)})`)
                  .join('; ')}
              </p>
            </>
          )}
          <ul className="rs-caveats">
            {/* The C/X caveat only concerns a C- or X-like answer (or one where they rank close). */}
            {/C\/X/.test(c.refused ? (c.ranked[0]?.group ?? '') : c.group) ? <li>{t('ast.class.caveat1')}</li> : null}
            <li>{t('ast.class.caveat2')}</li>
          </ul>
        </div>
      )}
      {props.notes.length > 0 && (
        <>
          <h4>{t('ast.notes')}</h4>
          <ul className="rs-notes">
            {props.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
