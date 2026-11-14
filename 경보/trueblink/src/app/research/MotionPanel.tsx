// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Proper motion: how far a star drifts across the sky per year. The plot shows the measured position
// at each date as an offset in arcseconds, drawn as on the sky (north up, east LEFT, because we look
// at the sky from inside the celestial sphere). Field stars measured the same way are controls: a
// motion counts as real only if it is clearly larger than what the method finds for stars that
// should not move.

import { ChartBox, Legend, markProps, useT, useTip } from './chart';
import { fill, fmtNum, fmtTick, mjdToUtc, motionVerdict, niceTicks, scaleLinear } from './helpers';
import type { Translate } from './strings';

export interface MotionEpoch {
  label: string;
  mjd: number;
  /** Offset east (RA cos Dec) and north, arcsec, from a common reference position. */
  dRaArcsec: number;
  dDecArcsec: number;
  /** 1-sigma positional error, arcsec. */
  err: number;
}

/** Motion fit in mas/yr (pmRa includes cos Dec), as returned by core/astrometry fitMotion. */
export interface MotionFit {
  pmRa: number;
  pmDec: number;
  pmRaErr: number;
  pmDecErr: number;
  total: number;
  totalErr: number;
  chi2: number;
  n: number;
}

export interface MotionPanelProps {
  target?: { name: string; pmRa?: number; pmDec?: number; parallax?: number };
  epochs: MotionEpoch[];
  fit?: MotionFit;
  controls?: { label: string; total: number; totalErr: number }[];
  t?: Translate;
}

const MAS_PER_ARCSEC = 1000;
const DAYS_PER_YEAR = 365.25;

export function MotionPanel(props: MotionPanelProps) {
  const t = useT(props.t);
  const { tip, show, hide } = useTip();
  const ep = props.epochs.filter((e) => Number.isFinite(e.dRaArcsec) && Number.isFinite(e.dDecArcsec));
  const fit = props.fit;
  const controls = props.controls ?? [];
  const verdict = fit ? motionVerdict(fit.total, fit.totalErr, controls) : null;
  const cat = props.target && props.target.pmRa !== undefined && props.target.pmDec !== undefined ? { pmRa: props.target.pmRa, pmDec: props.target.pmDec, total: Math.hypot(props.target.pmRa, props.target.pmDec) } : null;

  // Anchor tracks at the error-weighted mean position and date of the measurements.
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let st = 0;
  for (const e of ep) {
    const w = e.err > 0 ? 1 / (e.err * e.err) : 1;
    sw += w;
    sx += w * e.dRaArcsec;
    sy += w * e.dDecArcsec;
    st += w * e.mjd;
  }
  const ax = sw ? sx / sw : 0;
  const ay = sw ? sy / sw : 0;
  const at = sw ? st / sw : 0;
  const tMin = ep.length ? Math.min(...ep.map((e) => e.mjd)) : 0;
  const tMax = ep.length ? Math.max(...ep.map((e) => e.mjd)) : 0;
  const track = (pmRa: number, pmDec: number) =>
    [tMin, tMax].map((m) => {
      const dy = (m - at) / DAYS_PER_YEAR;
      return [ax + (pmRa / MAS_PER_ARCSEC) * dy, ay + (pmDec / MAS_PER_ARCSEC) * dy] as [number, number];
    });
  const fitTrack = fit && ep.length > 1 ? track(fit.pmRa, fit.pmDec) : null;
  const catTrack = cat && ep.length > 1 ? track(cat.pmRa, cat.pmDec) : null;

  // Square, equal-scale box around everything drawn.
  const xs = [...ep.flatMap((e) => [e.dRaArcsec - e.err, e.dRaArcsec + e.err]), ...(fitTrack ?? []).map((p) => p[0]), ...(catTrack ?? []).map((p) => p[0])];
  const ys = [...ep.flatMap((e) => [e.dDecArcsec - e.err, e.dDecArcsec + e.err]), ...(fitTrack ?? []).map((p) => p[1]), ...(catTrack ?? []).map((p) => p[1])];
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const half = Math.max(xs.length ? (Math.max(...xs) - Math.min(...xs)) / 2 : 1, ys.length ? (Math.max(...ys) - Math.min(...ys)) / 2 : 1, 0.5) * 1.15;

  const pmRow = (label: string, m: number | undefined, me: number | undefined, c: number | undefined) => (
    <tr>
      <th scope="row">{label}</th>
      <td className="rs-num">{m === undefined ? '–' : `${fmtNum(m, 1)} ± ${fmtNum(me, 1)}`}</td>
      <td className="rs-num">{c === undefined ? '–' : fmtNum(c, 1)}</td>
    </tr>
  );

  return (
    <section className="rs-card rs-motion" aria-label={t('motion.title')}>
      <header className="rs-cardhead">
        <h3>
          {t('motion.title')}
          {props.target ? ` · ${props.target.name}` : ''}
        </h3>
      </header>
      <div className="rs-motiongrid">
        <div className="rs-motionplot">
          <ChartBox height={(w) => Math.min(w, 380)} ariaLabel={fill(t('motion.aria'), { n: ep.length })} tip={tip}>
            {(W, H) => {
              const m = { top: 10, right: 10, bottom: 44, left: 52 };
              const side = Math.min(W - m.left - m.right, H - m.top - m.bottom);
              const x0 = m.left + (W - m.left - m.right - side) / 2;
              const y0 = m.top;
              // East is +dRa but is drawn to the LEFT: the x scale runs from +half (left) to -half (right).
              const x = scaleLinear(cx + half, cx - half, x0, x0 + side);
              const y = scaleLinear(cy - half, cy + half, y0 + side, y0);
              const k = side / (2 * half);
              const ticksX = niceTicks(cx - half, cx + half, side < 260 ? 4 : 6);
              const ticksY = niceTicks(cy - half, cy + half, side < 260 ? 4 : 6);
              const line = (tr: [number, number][]) => `M${x(tr[0][0])},${y(tr[0][1])} L${x(tr[1][0])},${y(tr[1][1])}`;
              return (
                <>
                  <defs>
                    <marker id="rs-arrow-fit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--accent)' }} />
                    </marker>
                    <marker id="rs-arrow-cat" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--muted)' }} />
                    </marker>
                  </defs>
                  <rect x={x0} y={y0} width={side} height={side} className="rs-panel" />
                  {ticksX.map((v) => (
                    <g key={`x${v}`}>
                      <line x1={x(v)} x2={x(v)} y1={y0} y2={y0 + side} className="rs-grid" />
                      <text x={x(v)} y={y0 + side + 15} textAnchor="middle" className="rs-tick" style={{ fill: 'var(--muted)' }}>
                        {fmtTick(v)}
                      </text>
                    </g>
                  ))}
                  {ticksY.map((v) => (
                    <g key={`y${v}`}>
                      <line x1={x0} x2={x0 + side} y1={y(v)} y2={y(v)} className="rs-grid" />
                      <text x={x0 - 5} y={y(v) + 4} textAnchor="end" className="rs-tick" style={{ fill: 'var(--muted)' }}>
                        {fmtTick(v)}
                      </text>
                    </g>
                  ))}
                  <text x={x0 + side / 2} y={y0 + side + 33} textAnchor="middle" className="rs-axislabel" style={{ fill: 'var(--muted)' }}>
                    {t('motion.x')}
                  </text>
                  <text transform={`translate(12, ${y0 + side / 2}) rotate(-90)`} textAnchor="middle" className="rs-axislabel" style={{ fill: 'var(--muted)' }}>
                    {t('motion.y')}
                  </text>
                  <g className="rs-compass" aria-hidden="true">
                    <text x={x0 + side - 8} y={y0 + 16} textAnchor="end">N ↑</text>
                    <text x={x0 + 8} y={y0 + 16}>← E</text>
                  </g>
                  {fitTrack && <path d={line(fitTrack)} className="rs-fittrack" markerEnd="url(#rs-arrow-fit)" />}
                  {catTrack && <path d={line(catTrack)} className="rs-cattrack" markerEnd="url(#rs-arrow-cat)" />}
                  {ep.map((e, i) => {
                    const px = x(e.dRaArcsec);
                    const py = y(e.dDecArcsec);
                    const label = fill(t('motion.tip'), { label: e.label, date: mjdToUtc(e.mjd), x: fmtNum(e.dRaArcsec, 2), y: fmtNum(e.dDecArcsec, 2), e: fmtNum(e.err, 2) });
                    return (
                      <g key={i} className="rs-mark" {...markProps(px, py, label, show, hide)}>
                        <circle cx={px} cy={py} r={Math.max(2, e.err * k)} className="rs-errcircle" />
                        <circle cx={px} cy={py} r={3.4} style={{ fill: 'var(--accent-time)' }} />
                        {ep.length <= 8 && (
                          <text x={px + 6} y={py - 6} className="rs-tick" style={{ fill: 'var(--accent-time)' }}>
                            {mjdToUtc(e.mjd)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </>
              );
            }}
          </ChartBox>
          <Legend
            items={[
              { label: t('motion.measured'), color: 'var(--accent-time)', kind: 'dot' },
              { label: t('motion.fit'), color: 'var(--accent)', kind: 'line' },
              ...(cat ? [{ label: t('motion.catalog'), color: 'var(--muted)', kind: 'dash' as const }] : []),
            ]}
          />
          <p className="rs-note">{t('motion.anchor')}</p>
        </div>
        <div className="rs-motionnums">
          {fit ? (
            <>
              <table className="rs-small">
                <thead>
                  <tr>
                    <th />
                    <th scope="col">{t('motion.measuredCol')}</th>
                    <th scope="col">{t('motion.catalogCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pmRow(t('motion.pmRa'), fit.pmRa, fit.pmRaErr, cat?.pmRa)}
                  {pmRow(t('motion.pmDec'), fit.pmDec, fit.pmDecErr, cat?.pmDec)}
                  {pmRow(t('motion.total'), fit.total, fit.totalErr, cat?.total)}
                </tbody>
              </table>
              <p className="rs-muted">{fill(t('motion.chi2'), { c: fmtNum(fit.chi2, 1), n: fit.n })}</p>
              {verdict && (
                <p className={`rs-verdict ${verdict.significant ? 'rs-yes' : 'rs-no'}`} role="status">
                  {fill(t(verdict.significant ? 'motion.sig' : 'motion.notSig'), { t: fmtNum(fit.total, 1), f: fmtNum(verdict.threshold / 3, 1) })}
                </p>
              )}
            </>
          ) : (
            <p className="rs-muted">{t('motion.noFit')}</p>
          )}
          {controls.length > 0 && (
            <>
              <h4>{t('motion.controls')}</h4>
              <table className="rs-small">
                <thead>
                  <tr>
                    <th scope="col">{t('motion.control')}</th>
                    <th scope="col">{t('motion.total')} (mas/yr)</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.map((c) => (
                    <tr key={c.label}>
                      <th scope="row">{c.label}</th>
                      <td className="rs-num">
                        {fmtNum(c.total, 1)} ± {fmtNum(c.totalErr, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {verdict && <p className="rs-muted">{fill(t('motion.controlMedian'), { m: fmtNum(verdict.controlMedian, 1) })}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
