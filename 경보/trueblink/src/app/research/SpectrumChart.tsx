// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Flux density against wavelength. SPHEREx has six detector arrays, each covering one slice of
// 0.75-5.0 um; the shaded bands show which array measured which part of the spectrum. Points that
// carry a warning flag or are saturated are drawn hollow so they are never mistaken for good data.

import type { PhotPoint, Visit } from '../../core/types';
import { DETECTOR_BANDS } from '../../core/types';
import { AxisX, AxisY, ChartBox, ErrBarY, Legend, markProps, useT, useTip } from './chart';
import { detectorColor, extent, fill, fmtNum, logTicks, mjdToUtc, niceTicks, scaleLinear, scaleLog, visitColor } from './helpers';
import type { Translate } from './strings';

export interface SpectrumBin {
  wavelength: number;
  flux: number;
  fluxErr: number;
  n: number;
}

export interface SpectrumReference {
  label: string;
  wavelength: number[];
  flux: number[];
}

export interface SpectrumChartProps {
  points: PhotPoint[];
  binned?: SpectrumBin[];
  visits?: Visit[];
  colorBy: 'detector' | 'visit';
  yScale: 'linear' | 'log';
  showFlagged: boolean;
  onHoverPoint?: (p: PhotPoint | null) => void;
  reference?: SpectrumReference;
  t?: Translate;
  height?: number;
}

const WMIN = 0.7;
const WMAX = 5.1;

export function SpectrumChart(props: SpectrumChartProps) {
  const t = useT(props.t);
  const { tip, show, hide } = useTip();
  const isLog = props.yScale === 'log';
  const flaggedCount = props.points.filter((p) => !p.good || p.saturated).length;
  const shown = props.points.filter((p) => props.showFlagged || (p.good && !p.saturated));
  const plottable = isLog ? shown.filter((p) => p.flux > 0) : shown.filter((p) => Number.isFinite(p.flux));
  const dropped = shown.length - plottable.length;
  const visitIdx = new Map<number, number>();
  (props.visits ?? []).forEach((v, i) => visitIdx.set(v.index, i));

  const yVals: number[] = [];
  for (const p of plottable) {
    yVals.push(p.flux);
    if (Number.isFinite(p.fluxErr)) {
      yVals.push(p.flux + p.fluxErr);
      if (!isLog || p.flux - p.fluxErr > 0) yVals.push(p.flux - p.fluxErr);
    }
  }
  for (const b of props.binned ?? []) if (!isLog || b.flux > 0) yVals.push(b.flux);
  if (props.reference) props.reference.flux.forEach((f, i) => {
    const w = props.reference!.wavelength[i];
    if (w >= WMIN && w <= WMAX && (!isLog || f > 0)) yVals.push(f);
  });

  const color = (p: PhotPoint) => (props.colorBy === 'visit' ? visitColor(p.visit !== undefined ? (visitIdx.get(p.visit) ?? p.visit) : 0) : detectorColor(p.detector));

  const legendItems =
    props.colorBy === 'detector'
      ? [1, 2, 3, 4, 5, 6].map((d) => ({ label: `D${d} ${DETECTOR_BANDS[d].min.toFixed(2)}–${DETECTOR_BANDS[d].max.toFixed(2)} µm`, color: detectorColor(d) }))
      : (props.visits ?? []).map((v, i) => ({ label: `${t('common.visit')} ${v.label}`, color: visitColor(i) }));
  legendItems.push({ label: t('spectrum.hollowPoint'), color: 'var(--text)', kind: 'hollow' } as (typeof legendItems)[number]);
  if (props.binned?.length) legendItems.push({ label: t('spectrum.binned'), color: 'var(--text)', kind: 'square' } as (typeof legendItems)[number]);
  if (props.reference) legendItems.push({ label: props.reference.label, color: 'var(--muted)', kind: 'dash' } as (typeof legendItems)[number]);

  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('spectrum.title')}</figcaption>
      <ChartBox
        height={props.height ?? ((w) => Math.round(Math.max(240, Math.min(380, w * 0.5))))}
        ariaLabel={fill(t('spectrum.aria'), { n: plottable.length })}
        tip={tip}
      >
        {(W, H) => {
          const m = { top: 22, right: 12, bottom: 44, left: W < 480 ? 50 : 62 };
          const x = scaleLinear(WMIN, WMAX, m.left, W - m.right);
          let y: (v: number) => number;
          let yTicks: number[];
          if (isLog) {
            const pos = yVals.filter((v) => v > 0);
            let lo = pos.length ? Math.min(...pos) : 0.1;
            let hi = pos.length ? Math.max(...pos) : 10;
            if (hi / lo < 10) {
              const mid = Math.sqrt(lo * hi);
              lo = mid / 3.2;
              hi = mid * 3.2;
            } else {
              lo /= 1.3;
              hi *= 1.3;
            }
            y = scaleLog(lo, hi, H - m.bottom, m.top);
            yTicks = logTicks(lo, hi);
          } else {
            const [lo, hi] = extent(yVals);
            y = scaleLinear(lo, hi, H - m.bottom, m.top);
            yTicks = niceTicks(lo, hi, H < 280 ? 4 : 6);
          }
          const xTicks = niceTicks(WMIN, WMAX, W < 480 ? 5 : 9).map((v) => ({ v, label: String(v) }));
          const yBottom = H - m.bottom;
          return (
            <>
              {[1, 2, 3, 4, 5, 6].map((d) => {
                const b = DETECTOR_BANDS[d];
                const x0 = x(b.min);
                const x1 = x(b.max);
                return (
                  <g key={d} aria-hidden="true">
                    <rect x={x0} y={m.top} width={x1 - x0} height={yBottom - m.top} className="rs-band" style={{ fill: detectorColor(d) }} />
                    <text x={(x0 + x1) / 2} y={m.top - 7} textAnchor="middle" className="rs-bandlabel" style={{ fill: detectorColor(d) }}>
                      D{d}
                    </text>
                  </g>
                );
              })}
              <AxisX ticks={xTicks} scale={x} y={yBottom} top={m.top} x0={m.left} x1={W - m.right} label={t('common.wavelength')} color="var(--accent-wave)" />
              <AxisY ticks={yTicks} scale={y} x={m.left} x1={W - m.right} y0={m.top} y1={yBottom} label={t('common.fluxMjy')} />
              <g>
                {props.reference && (
                  <polyline
                    className="rs-refline"
                    points={props.reference.wavelength
                      .map((w, i) => [w, props.reference!.flux[i]] as const)
                      .filter(([w, f]) => w >= WMIN && w <= WMAX && Number.isFinite(y(f)))
                      .map(([w, f]) => `${x(w).toFixed(1)},${y(f).toFixed(1)}`)
                      .join(' ')}
                  />
                )}
                {plottable.map((p) => {
                  const px = x(p.wavelength);
                  const py = y(p.flux);
                  const c = color(p);
                  const hollow = !p.good || p.saturated;
                  const eLo = isLog && p.flux - p.fluxErr <= 0 ? yBottom : y(p.flux - p.fluxErr);
                  const label = fill(t('spectrum.tip'), { w: fmtNum(p.wavelength, 3), f: fmtNum(p.flux, 3), e: fmtNum(p.fluxErr, 3), d: p.detector, date: mjdToUtc(p.mjd) }) + (p.saturated ? ` · ${t('common.saturated')}` : !p.good ? ` · ${t('common.flagged')}` : '');
                  const mp = markProps(px, py, label, show, hide);
                  return (
                    <g
                      key={p.exposureId}
                      className="rs-mark"
                      {...mp}
                      onMouseEnter={() => {
                        mp.onMouseEnter();
                        props.onHoverPoint?.(p);
                      }}
                      onMouseLeave={() => {
                        mp.onMouseLeave();
                        props.onHoverPoint?.(null);
                      }}
                    >
                      {Number.isFinite(p.fluxErr) && p.fluxErr > 0 && <ErrBarY x={px} y0={eLo} y1={y(p.flux + p.fluxErr)} color={c} cap={2} />}
                      <circle cx={px} cy={py} r={hollow ? 3.2 : 3} style={hollow ? { fill: 'var(--panel)', stroke: c, strokeWidth: 1.4 } : { fill: c }} />
                    </g>
                  );
                })}
                {(props.binned ?? [])
                  .filter((b) => Number.isFinite(y(b.flux)))
                  .map((b, i) => {
                    const px = x(b.wavelength);
                    const py = y(b.flux);
                    const label = `${fmtNum(b.wavelength, 3)} µm · ${fmtNum(b.flux, 3)} ± ${fmtNum(b.fluxErr, 3)} mJy · N=${b.n}`;
                    return (
                      <g key={`b${i}`} className="rs-mark" {...markProps(px, py, label, show, hide)}>
                        <ErrBarY x={px} y0={isLog && b.flux - b.fluxErr <= 0 ? yBottom : y(b.flux - b.fluxErr)} y1={y(b.flux + b.fluxErr)} color="var(--text)" cap={3} />
                        <rect x={px - 3} y={py - 3} width={6} height={6} style={{ fill: 'var(--text)', stroke: 'var(--bg)', strokeWidth: 1 }} />
                      </g>
                    );
                  })}
              </g>
            </>
          );
        }}
      </ChartBox>
      <Legend items={legendItems} />
      <p className="rs-note" aria-live="polite">
        {!props.showFlagged && flaggedCount > 0 ? fill(t('spectrum.hiddenFlagged'), { n: flaggedCount }) : ' '}
        {dropped > 0 ? ` ${fill(t('spectrum.droppedLog'), { n: dropped })}` : ''}
      </p>
    </figure>
  );
}
