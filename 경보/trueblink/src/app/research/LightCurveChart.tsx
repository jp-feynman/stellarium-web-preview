// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Brightness against date. Dates are UTC and drawn in amber (the colour for time). Comparison
// stars measured the same way are drawn in grey: if they wobble as much as the target, the
// "variability" is instrumental.

import { AxisX, AxisY, ChartBox, ErrBarY, Legend, markProps, useT, useTip } from './chart';
import { extent, fill, fmtNum, mjdToUtc, niceTicks, scaleLinear, timeTicks, visitColor } from './helpers';
import type { Translate } from './strings';

export interface LightCurvePoint {
  mjd: number;
  value: number;
  err: number;
  n?: number;
}

export interface LightCurveSeries {
  label: string;
  color?: string;
  points: LightCurvePoint[];
}

export interface LightCurveChartProps {
  series: LightCurveSeries[];
  yLabel: string;
  controls?: { label: string; points: LightCurvePoint[] }[];
  t?: Translate;
  height?: number;
}

const GAP_DAYS = 30;

export function LightCurveChart(props: LightCurveChartProps) {
  const t = useT(props.t);
  const { tip, show, hide } = useTip();
  const controls = props.controls ?? [];
  const all = [...props.series.flatMap((s) => s.points), ...controls.flatMap((c) => c.points)];
  const mjds = all.map((p) => p.mjd).filter(Number.isFinite);
  const yv: number[] = [];
  for (const p of all) {
    if (!Number.isFinite(p.value)) continue;
    yv.push(p.value);
    if (Number.isFinite(p.err)) yv.push(p.value - p.err, p.value + p.err);
  }
  const seriesColor = (s: LightCurveSeries, i: number) => s.color ?? visitColor(i);
  const legend = [
    ...props.series.map((s, i) => ({ label: s.label, color: seriesColor(s, i), kind: 'dot' as const })),
    ...(controls.length ? [{ label: `${t('lc.controls')} (${controls.length})`, color: 'var(--muted)', kind: 'line' as const }] : []),
  ];

  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('lc.title')}</figcaption>
      <ChartBox height={props.height ?? ((w) => Math.round(Math.max(220, Math.min(340, w * 0.45))))} ariaLabel={fill(t('lc.aria'), { y: props.yLabel, n: props.series.length })} tip={tip}>
        {(W, H) => {
          if (!mjds.length) {
            return (
              <text x={W / 2} y={H / 2} textAnchor="middle" className="rs-empty">
                {t('common.noData')}
              </text>
            );
          }
          const m = { top: 12, right: 14, bottom: 44, left: W < 480 ? 50 : 62 };
          let t0 = Math.min(...mjds);
          let t1 = Math.max(...mjds);
          const pad = Math.max(1, (t1 - t0) * 0.04);
          t0 -= pad;
          t1 += pad;
          const x = scaleLinear(t0, t1, m.left, W - m.right);
          const [lo, hi] = extent(yv);
          const y = scaleLinear(lo, hi, H - m.bottom, m.top);
          const maxTicks = Math.max(2, Math.floor((W - m.left - m.right) / 92));
          const tt = timeTicks(t0, t1, maxTicks).map((k) => ({ v: k.mjd, label: k.label }));
          // Join points only within a visit: a line across a months-long gap would pretend we
          // know the brightness in between.
          const line = (pts: LightCurvePoint[]) => {
            const sorted = [...pts].filter((p) => Number.isFinite(p.value)).sort((a, b) => a.mjd - b.mjd);
            return sorted.map((p, i) => `${i === 0 || p.mjd - sorted[i - 1].mjd > GAP_DAYS ? 'M' : 'L'}${x(p.mjd).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
          };
          return (
            <>
              <AxisX ticks={tt} scale={x} y={H - m.bottom} top={m.top} x0={m.left} x1={W - m.right} label={t('common.dateUtc')} color="var(--accent-time)" />
              <AxisY ticks={niceTicks(lo, hi, H < 260 ? 4 : 6)} scale={y} x={m.left} x1={W - m.right} y0={m.top} y1={H - m.bottom} label={props.yLabel} />
              {controls.map((c, ci) => (
                <g key={`c${ci}`} className="rs-control">
                  <path d={line(c.points)} className="rs-ctrlline" />
                  {c.points
                    .filter((p) => Number.isFinite(p.value))
                    .map((p, i) => {
                      const px = x(p.mjd);
                      const py = y(p.value);
                      return (
                        <g key={i} className="rs-mark" {...markProps(px, py, fill(t('lc.tip'), { label: c.label, date: mjdToUtc(p.mjd, true), v: fmtNum(p.value, 3), e: fmtNum(p.err, 3) }), show, hide)}>
                          <circle cx={px} cy={py} r={2.2} style={{ fill: 'var(--muted)', opacity: 0.7 }} />
                        </g>
                      );
                    })}
                </g>
              ))}
              {props.series.map((s, si) => {
                const c = seriesColor(s, si);
                return (
                  <g key={`s${si}`}>
                    <path d={line(s.points)} style={{ fill: 'none', stroke: c, strokeWidth: 1.2, opacity: 0.55 }} />
                    {s.points
                      .filter((p) => Number.isFinite(p.value))
                      .map((p, i) => {
                        const px = x(p.mjd);
                        const py = y(p.value);
                        const label = fill(t('lc.tip'), { label: s.label, date: mjdToUtc(p.mjd, true), v: fmtNum(p.value, 3), e: fmtNum(p.err, 3) }) + (p.n !== undefined ? ` · N=${p.n}` : '');
                        return (
                          <g key={i} className="rs-mark" {...markProps(px, py, label, show, hide)}>
                            {Number.isFinite(p.err) && p.err > 0 && <ErrBarY x={px} y0={y(p.value - p.err)} y1={y(p.value + p.err)} color={c} />}
                            <circle cx={px} cy={py} r={3.4} style={{ fill: c, stroke: 'var(--bg)', strokeWidth: 0.8 }} />
                          </g>
                        );
                      })}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartBox>
      <Legend items={legend} />
    </figure>
  );
}
