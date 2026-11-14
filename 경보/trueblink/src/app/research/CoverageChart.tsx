// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The key teaching chart. SPHEREx sees each patch of sky in "visits" of about two weeks, a few
// months apart. During one visit the patch drifts across the linear variable filter, so successive
// exposures sample successive wavelengths: one visit sweeps the whole 0.75-5.0 um spectrum.
// Time runs left to right in one panel per visit (a broken axis), wavelength runs upward.

import type { Visit } from '../../core/types';
import { DETECTOR_BANDS } from '../../core/types';
import { ChartBox, Legend, markProps, useT, useTip } from './chart';
import { detectorColor, fill, fmtNum, mjdToUtc, niceTicks, scaleLinear, timeSegments, timeTicks } from './helpers';
import type { Translate } from './strings';

export interface CoverageExposure {
  id: string;
  mjd: number;
  wavelength: number;
  detector: number;
  loaded: boolean;
  inSequence: boolean;
  visit?: number;
}

export interface CoverageChartProps {
  exposures: CoverageExposure[];
  visits: Visit[];
  onSelect?: (id: string) => void;
  t?: Translate;
}

const WMIN = 0.7;
const WMAX = 5.1;
const PANEL_MIN = 130;
const PANEL_H = 260;

export function CoverageChart(props: CoverageChartProps) {
  const t = useT(props.t);
  const { tip, show, hide } = useTip();
  const segs = timeSegments(
    props.exposures.map((e) => e.mjd),
    props.visits,
  );
  const nSeg = Math.max(1, segs.length);
  const left = 54;
  const right = 10;
  const colsFor = (w: number) => Math.max(1, Math.min(nSeg, Math.floor((w - left - right) / PANEL_MIN)));
  const heightFor = (w: number) => Math.ceil(nSeg / colsFor(w)) * PANEL_H;

  // Which segment does an exposure belong to? Its visit when known, else by time.
  const segOf = (e: CoverageExposure) => {
    if (e.visit !== undefined) {
      const k = segs.findIndex((s) => s.visit === e.visit);
      if (k >= 0) return k;
    }
    let best = 0;
    let bd = Infinity;
    segs.forEach((s, k) => {
      const d = e.mjd < s.mjdMin ? s.mjdMin - e.mjd : e.mjd > s.mjdMax ? e.mjd - s.mjdMax : 0;
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  };

  return (
    <figure className="rs-figure">
      <figcaption className="rs-caption">{t('cov.title')}</figcaption>
      <ChartBox height={heightFor} ariaLabel={fill(t('cov.aria'), { n: props.exposures.length, v: segs.length })} tip={tip}>
        {(W) => {
          if (!segs.length) {
            return (
              <text x={W / 2} y={40} textAnchor="middle" className="rs-empty">
                {t('common.noData')}
              </text>
            );
          }
          const cols = colsFor(W);
          const pw = (W - left - right) / cols;
          const groups: CoverageExposure[][] = segs.map(() => []);
          for (const e of props.exposures) groups[segOf(e)].push(e);
          return segs.map((s, k) => {
            const col = k % cols;
            const row = Math.floor(k / cols);
            const gx0 = left + col * pw + (col > 0 ? 8 : 0);
            const gx1 = left + (col + 1) * pw - 4;
            const top = row * PANEL_H + 26;
            const bottom = row * PANEL_H + PANEL_H - 34;
            const pad = Math.max(0.3, (s.mjdMax - s.mjdMin) * 0.05);
            const x = scaleLinear(s.mjdMin - pad, s.mjdMax + pad, gx0 + 4, gx1 - 4);
            const y = scaleLinear(WMIN, WMAX, bottom, top);
            const ticks = timeTicks(s.mjdMin - pad, s.mjdMax + pad, Math.max(3, Math.floor((gx1 - gx0) / 44))).filter((tk) => x(tk.mjd) >= gx0 + 14 && x(tk.mjd) <= gx1 - 14);
            const exps = groups[k];
            const year = mjdToUtc((s.mjdMin + s.mjdMax) / 2).slice(0, 4);
            return (
              <g key={k}>
                <rect x={gx0} y={top} width={gx1 - gx0} height={bottom - top} className="rs-panel" />
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <rect key={d} x={gx0} width={gx1 - gx0} y={y(DETECTOR_BANDS[d].max)} height={y(DETECTOR_BANDS[d].min) - y(DETECTOR_BANDS[d].max)} className="rs-band" style={{ fill: detectorColor(d) }} />
                ))}
                <text x={gx0} y={top - 8} className="rs-paneltitle" style={{ fill: 'var(--accent-time)' }}>
                  {gx1 - gx0 < 190 ? s.label : fill(t('cov.panel'), { label: s.label, n: exps.length })}
                </text>
                {(col === 0 || cols === 1) &&
                  niceTicks(WMIN, WMAX, 5).map((v) => (
                    <text key={v} x={gx0 - 6} y={y(v) + 4} textAnchor="end" className="rs-tick" style={{ fill: 'var(--accent-wave)' }}>
                      {v}
                    </text>
                  ))}
                {col === 0 && (
                  <text transform={`translate(12, ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" className="rs-axislabel" style={{ fill: 'var(--accent-wave)' }}>
                    {t('common.wavelength')}
                  </text>
                )}
                {ticks.map((tk) => (
                  <g key={tk.mjd}>
                    <line x1={x(tk.mjd)} x2={x(tk.mjd)} y1={top} y2={bottom} className="rs-grid" />
                    <text x={x(tk.mjd)} y={bottom + 15} textAnchor="middle" className="rs-tick" style={{ fill: 'var(--accent-time)' }}>
                      {tk.short}
                    </text>
                  </g>
                ))}
                <text x={(gx0 + gx1) / 2} y={bottom + 30} textAnchor="middle" className="rs-axislabel" style={{ fill: 'var(--accent-time)' }}>
                  {`${t('common.dateUtc')} ${year}`}
                </text>
                {exps.map((e) => {
                  const px = x(e.mjd);
                  const py = y(e.wavelength);
                  if (!Number.isFinite(py)) return null;
                  const c = detectorColor(e.detector);
                  const label = fill(t('cov.tip'), { id: e.id, date: mjdToUtc(e.mjd, true), w: fmtNum(e.wavelength, 3), d: e.detector }) + ` · ${e.inSequence ? t('cov.inSeq') : t('cov.notInSeq')}`;
                  return (
                    <g key={e.id} className="rs-mark" {...markProps(px, py, label, show, hide, props.onSelect ? () => props.onSelect!(e.id) : undefined)}>
                      <circle cx={px} cy={py} r={2.8} style={e.inSequence ? { fill: c, opacity: e.loaded ? 1 : 0.4 } : { fill: 'none', stroke: c, strokeWidth: 1, opacity: e.loaded ? 0.9 : 0.35 }} />
                    </g>
                  );
                })}
              </g>
            );
          });
        }}
      </ChartBox>
      <Legend
        items={[
          ...[1, 2, 3, 4, 5, 6].map((d) => ({ label: `D${d}`, color: detectorColor(d), kind: 'dot' as const })),
          { label: t('cov.inSeq'), color: 'var(--text)', kind: 'dot' as const },
          { label: t('cov.notInSeq'), color: 'var(--text)', kind: 'hollow' as const },
          { label: t('cov.notLoaded'), color: 'var(--muted)', kind: 'dot' as const },
        ]}
      />
      <p className="rs-note">{t('cov.explain')}</p>
    </figure>
  );
}
