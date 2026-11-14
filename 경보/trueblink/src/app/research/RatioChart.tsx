// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Visit B divided by visit A, channel by channel. Because both visits are measured through the same
// spectral channel, colour cannot fake a change here: a constant star sits on the line at 1.
// The weighted mean tells how much the source changed; the reduced chi-square tells whether the
// channels agree with one another within their error bars.

import { AxisX, AxisY, ChartBox, ErrBarY, Legend, markProps, useT, useTip } from './chart';
import { detectorColor, detectorForCubeChannel, extent, fill, fmtNum, niceTicks, scaleLinear, weightedMean } from './helpers';
import type { Translate } from './strings';

export interface RatioRow {
  cubeChannel: number;
  wavelength: number;
  ratio: number;
  ratioErr: number;
}

export interface RatioChartProps {
  rows: RatioRow[];
  labelA: string;
  labelB: string;
  t?: Translate;
  height?: number;
  /** The robust combined ratio the findings quote; when given, the line and summary show it. */
  combined?: { ratio: number; ratioErr: number; n: number } | null;
}

export function RatioChart(props: RatioChartProps) {
  const t = useT(props.t);
  const { tip, show, hide } = useTip();
  const rows = props.rows.filter((r) => Number.isFinite(r.ratio) && Number.isFinite(r.wavelength));
  const wm = weightedMean(
    rows.map((r) => r.ratio),
    rows.map((r) => r.ratioErr),
  );
  // Same number as the findings: the robust combination (large errors dropped, 3-sigma clipped).
  const robust = props.combined && Number.isFinite(props.combined.ratio) ? props.combined : null;
  const stats = robust ? { ...wm, mean: robust.ratio, err: robust.ratioErr, n: robust.n } : wm;
  const yv = [1, ...rows.flatMap((r) => [r.ratio - (r.ratioErr || 0), r.ratio + (r.ratioErr || 0)])];
  const ws = rows.map((r) => r.wavelength);
  const yLabel = fill(t('ratio.y'), { a: props.labelA, b: props.labelB });
  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('ratio.title')}</figcaption>
      <ChartBox height={props.height ?? ((w) => Math.round(Math.max(220, Math.min(320, w * 0.42))))} ariaLabel={fill(t('ratio.aria'), { a: props.labelA, b: props.labelB, n: rows.length })} tip={tip}>
        {(W, H) => {
          const m = { top: 12, right: 14, bottom: 44, left: W < 480 ? 50 : 62 };
          const [w0, w1] = ws.length ? extent(ws, 0.04) : [0.7, 5.1];
          const x = scaleLinear(w0, w1, m.left, W - m.right);
          const [lo, hi] = extent(yv, 0.1);
          const y = scaleLinear(lo, hi, H - m.bottom, m.top);
          const xt = niceTicks(w0, w1, W < 480 ? 5 : 8).map((v) => ({ v, label: String(v) }));
          return (
            <>
              <AxisX ticks={xt} scale={x} y={H - m.bottom} top={m.top} x0={m.left} x1={W - m.right} label={t('common.wavelength')} color="var(--accent-wave)" />
              <AxisY ticks={niceTicks(lo, hi, 5)} scale={y} x={m.left} x1={W - m.right} y0={m.top} y1={H - m.bottom} label={yLabel} />
              <line x1={m.left} x2={W - m.right} y1={y(1)} y2={y(1)} className="rs-unity" />
              {Number.isFinite(stats.mean) && (
                <>
                  {Number.isFinite(stats.scatter) && (
                    <rect x={m.left} width={W - m.left - m.right} y={y(stats.mean + stats.scatter)} height={Math.max(0, y(stats.mean - stats.scatter) - y(stats.mean + stats.scatter))} className="rs-scatterband" />
                  )}
                  <line x1={m.left} x2={W - m.right} y1={y(stats.mean)} y2={y(stats.mean)} className="rs-meanline" />
                </>
              )}
              {rows.map((r) => {
                const px = x(r.wavelength);
                const py = y(r.ratio);
                const c = detectorColor(detectorForCubeChannel(r.cubeChannel));
                const label = fill(t('ratio.tip'), { c: r.cubeChannel, w: fmtNum(r.wavelength, 3), r: fmtNum(r.ratio, 3), e: fmtNum(r.ratioErr, 3) });
                return (
                  <g key={r.cubeChannel} className="rs-mark" {...markProps(px, py, label, show, hide)}>
                    {r.ratioErr > 0 && <ErrBarY x={px} y0={y(r.ratio - r.ratioErr)} y1={y(r.ratio + r.ratioErr)} color={c} />}
                    <circle cx={px} cy={py} r={3.2} style={{ fill: c }} />
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartBox>
      <Legend
        items={[
          { label: t('ratio.unity'), color: 'var(--muted)', kind: 'dash' },
          { label: `${t(robust ? 'ratio.robust' : 'ratio.mean')} ± scatter`, color: 'var(--accent)', kind: 'line' },
        ]}
      />
      <p className="rs-stat">
        {fill(t(robust ? 'ratio.summaryRobust' : 'ratio.summary'), { m: fmtNum(stats.mean, 3), e: fmtNum(stats.err, 3), s: fmtNum(stats.scatter, 3), c: fmtNum(stats.chi2r, 2), n: stats.n })}
      </p>
    </figure>
  );
}
