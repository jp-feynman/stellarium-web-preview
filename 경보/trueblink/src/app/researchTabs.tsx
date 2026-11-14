// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Registers the Research panel tabs: frames, measure, overlays, provenance. The components come from
// src/app/research (props only); this file feeds them from the session, the app store and the
// measurement store, and re-renders on session changes (useSessionVersion).
import { useMemo, useState } from 'react';
import { cutoutSource } from '../core/cache';
import { angularSepArcsec } from '../core/wcs';
import { FLAG_BITS, mjdToIsoDate, type PhotPoint } from '../core/types';
import { DATA_CREDITS, SPHEREX_ACKNOWLEDGEMENT } from './config';
import { registerStrings, useT } from './i18n';
import { runMeasurements, useMeasure, type MeasureResult } from './measure';
import { DETECTOR_RANGE } from './measure/core';
import {
  CoverageChart,
  ExposureTable,
  FlagLegend,
  LightCurveChart,
  MotionPanel,
  ProvenancePanel,
  RatioChart,
  SpectrumChart,
  downloadText,
  flagNames,
  researchStringsEn,
  researchStringsKo,
  toCsv,
  type CoverageExposure,
  type EvidenceLevel,
  type ExposureRow,
  type ProvenanceItem,
} from './research';
import { registerResearchTab } from './seams';
import { session, useSessionVersion } from './session';
import { useApp, type OverlayToggles } from './store';

function useRt(): (k: string) => string {
  const t = useT();
  return (k: string) => t(k);
}

function DemoChip() {
  const demo = useApp((s) => s.demo);
  return demo ? <span className="chip chip-demo">DEMO</span> : null;
}

const capStyle = { margin: '4px 0 14px' } as const;

// ---------------------------------------------------------------- frames

function FramesTab() {
  const v = useSessionVersion();
  const t = useT();
  const rt = useRt();
  const frames = useApp((s) => s.frames);
  const frameIndex = useApp((s) => s.frameIndex);
  const selectFrame = useApp((s) => s.selectFrame);
  const result = useMeasure((s) => s.result);

  const inSeq = useMemo(() => new Set(frames[frameIndex]?.meta.exposureIds ?? []), [frames, frameIndex]);
  const coverage: CoverageExposure[] = useMemo(
    () =>
      session.exposures.map((e) => {
        const c = session.cutouts.get(e.id);
        return {
          id: e.id,
          mjd: c?.header.mjdAvg ?? e.mjd,
          wavelength: c?.wavelength ?? session.wavelengthOf.get(e.id) ?? NaN,
          detector: e.detector,
          loaded: session.status.get(e.id) === 'loaded' || !!c,
          inSequence: inSeq.has(e.id),
          visit: session.visitOf.get(e.id),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, inSeq],
  );
  const flagsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of result?.points ?? []) m.set(p.exposureId, p.flags);
    return m;
  }, [result]);
  const rows: ExposureRow[] = useMemo(
    () =>
      session.exposures.map((e) => {
        const c = session.cutouts.get(e.id);
        const st = session.status.get(e.id);
        const status: ExposureRow['status'] = c || st === 'loaded' ? 'loaded' : st === 'off-detector' ? 'off-detector' : st === 'error' ? 'error' : 'pending';
        const f = flagsById.get(e.id);
        return {
          id: e.id,
          obsId: e.obsId,
          detector: e.detector,
          mjd: c?.header.mjdAvg ?? e.mjd,
          wavelength: c?.wavelength ?? session.wavelengthOf.get(e.id) ?? NaN,
          bandwidth: c?.bandwidth ?? NaN,
          cubeChannel: c?.cubeChannel ?? 0,
          release: e.release,
          collection: e.collection,
          flagsSummary: f ? flagNames(f).join(' ') : undefined,
          s3Key: e.s3Key,
          status,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, flagsById],
  );
  const onSelect = (id: string) => {
    const k = frames.findIndex((f) => f.meta.exposureIds.includes(id));
    if (k >= 0) selectFrame(k);
  };
  return (
    <div data-testid="rtab-frames-body">
      <DemoChip />
      <CoverageChart exposures={coverage} visits={session.visits} onSelect={onSelect} t={rt} />
      <p className="muted small" style={capStyle}>
        {t('mtab.frames.cap')}
      </p>
      <ExposureTable rows={rows} onSelect={onSelect} t={rt} height={300} />
    </div>
  );
}

// ---------------------------------------------------------------- measure

const fmtRatio = (c: { ratio: number; ratioErr: number; n: number } | undefined) =>
  c && Number.isFinite(c.ratio) ? `${c.ratio.toFixed(3)} ± ${Number.isFinite(c.ratioErr) ? c.ratioErr.toFixed(3) : '–'} (${c.n})` : '–';

/** The robust like-with-like ratio per wavelength range and per detector array (a colour-dependent change shows here). */
function BandRatioTable({ ratio }: { ratio: NonNullable<MeasureResult['ratio']> }) {
  const t = useT();
  if (!ratio.bands && !ratio.perDetector?.length) return null;
  const alt = ratio.rings;
  return (
    <div className="band-ratios" data-testid="band-ratios">
      <table>
        <caption>{t('mtab.ratio.bands')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('mtab.ratio.range')}</th>
            <th scope="col">
              {t('mtab.ratio.ratio')}
              {alt ? ` · ${t('mtab.ratio.alt', { r: `${alt.phot.rin}–${alt.phot.rout}` })}` : ''}
            </th>
            {alt && <th scope="col">{t('mtab.ratio.alt', { r: `${alt.alt.rin}–${alt.alt.rout}` })}</th>}
          </tr>
        </thead>
        <tbody>
          {ratio.bands && (
            <>
              <tr>
                <th scope="row">{t('mtab.ratio.short')}</th>
                <td className="mono">{fmtRatio(ratio.bands.short)}</td>
                {alt && <td className="mono">{fmtRatio(alt.altBands.short)}</td>}
              </tr>
              <tr>
                <th scope="row">{t('mtab.ratio.long')}</th>
                <td className="mono">{fmtRatio(ratio.bands.long)}</td>
                {alt && <td className="mono">{fmtRatio(alt.altBands.long)}</td>}
              </tr>
            </>
          )}
          {(ratio.perDetector ?? []).map((d) => (
            <tr key={d.detector}>
              <th scope="row">{t('mtab.ratio.det', { d: d.detector, w: `${DETECTOR_RANGE[d.detector][0]}–${DETECTOR_RANGE[d.detector][1]}` })}</th>
              <td className="mono">{fmtRatio(d)}</td>
              {alt && <td />}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('mtab.ratio.bandsCap')}</p>
    </div>
  );
}

function MeasureTab() {
  useSessionVersion();
  const t = useT();
  const rt = useRt();
  const { result, status, error } = useMeasure();
  const target = useApp((s) => s.target);
  const [colorBy, setColorBy] = useState<'detector' | 'visit'>('detector');
  const [yScale, setYScale] = useState<'linear' | 'log'>('linear');
  const [showFlagged, setShowFlagged] = useState(false);
  const busy = status === 'running';

  const head = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
      <button type="button" className="btn small primary" disabled={busy || session.cutouts.size === 0} onClick={() => void runMeasurements()} data-testid="measure-run">
        {busy ? t('mtab.running') : t('mtab.run')}
      </button>
      <DemoChip />
      {result && (
        <span className="small muted" data-testid="measure-status">
          {!result.isTarget && result.pos ? `${t('mtab.pickedAt', { pos: `${result.pos.ra.toFixed(4)} ${result.pos.dec.toFixed(4)}` })} · ` : ''}
          {t('mtab.status', {
            n: result.points.length,
            good: result.points.filter((p) => p.good).length,
            visits: new Set(result.points.filter((p) => p.good).map((p) => p.visit)).size,
            rel: result.relative ? t('mtab.relative') : '',
          })}
        </span>
      )}
      {error && <span className="small chip chip-warn">{error}</span>}
    </div>
  );
  if (!result) {
    return (
      <div data-testid="rtab-measure-body">
        {head}
        <p className="muted">{t('mtab.none')}</p>
      </div>
    );
  }
  const seg = (on: boolean) => (on ? 'on' : '');
  const lcSeries = [
    {
      label: t('mtab.lc.target'),
      points: result.lightCurve.map((p) => ({ mjd: p.mjd, value: p.rel, err: p.relErr, n: p.n })),
    },
  ];
  const lcControls = result.controls
    .filter((c) => c.lightCurve.length > 0)
    .map((c) => ({ label: c.star.label, points: c.lightCurve.map((p) => ({ mjd: p.mjd, value: p.rel, err: p.relErr, n: p.n })) }));
  const m = result.motion;
  const epochs = (m?.epochs ?? []).map((e) => ({
    label: session.visits[e.visit]?.label ?? mjdToIsoDate(e.mjd),
    mjd: e.mjd,
    dRaArcsec: e.dRa,
    dDecArcsec: e.dDec,
    err: e.err,
  }));
  const controls = result.controls
    .filter((c) => c.fit && Number.isFinite(c.fit.total))
    .map((c) => ({ label: c.star.label, total: c.fit!.total, totalErr: c.fit!.totalErr }));
  return (
    <div data-testid="rtab-measure-body">
      {head}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }} className="small">
        <span>
          {t('mtab.colourBy')}{' '}
          <span className="seg">
            <button type="button" className={seg(colorBy === 'detector')} onClick={() => setColorBy('detector')}>
              {t('mtab.byDetector')}
            </button>
            <button type="button" className={seg(colorBy === 'visit')} onClick={() => setColorBy('visit')}>
              {t('mtab.byVisit')}
            </button>
          </span>
        </span>
        <span>
          {t('mtab.yScale')}{' '}
          <span className="seg">
            <button type="button" className={seg(yScale === 'linear')} onClick={() => setYScale('linear')}>
              {t('mtab.linear')}
            </button>
            <button type="button" className={seg(yScale === 'log')} onClick={() => setYScale('log')}>
              {t('mtab.log')}
            </button>
          </span>
        </span>
        <label>
          <input type="checkbox" checked={showFlagged} onChange={(e) => setShowFlagged(e.target.checked)} /> {t('mtab.showFlagged')}
        </label>
      </div>
      <SpectrumChart points={result.points} binned={result.binned} visits={session.visits} colorBy={colorBy} yScale={yScale} showFlagged={showFlagged} t={rt} />
      <p className="muted small" style={capStyle}>
        {t(result.relative ? 'mtab.cap.spectrumRel' : 'mtab.cap.spectrum')}
      </p>
      <LightCurveChart series={lcSeries} controls={lcControls} yLabel={t('mtab.lc.y')} t={rt} />
      <p className="muted small" style={capStyle}>
        {t('mtab.cap.lc')}
      </p>
      {result.ratio && (
        <>
          <RatioChart rows={result.ratio.rows} labelA={result.ratio.labelA} labelB={result.ratio.labelB} combined={result.ratio.combined} t={rt} />
          <p className="muted small" style={capStyle}>
            {t('mtab.cap.ratio')}
          </p>
          <BandRatioTable ratio={result.ratio} />
        </>
      )}
      <MotionPanel
        target={result.isTarget && target ? { name: target.name, pmRa: target.pmRa, pmDec: target.pmDec, parallax: target.parallax } : undefined}
        epochs={epochs}
        fit={m?.fit ?? undefined}
        controls={controls}
        t={rt}
      />
      <p className="muted small" style={capStyle}>
        {t('mtab.cap.motion')} {controls.length === 0 ? t('mtab.ctrlNone') : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- overlays

/** Pixels per flag name over all loaded cutouts. */
export function countFlags(arrays: Iterable<Int32Array | undefined>): Record<string, number> {
  const bits = Object.entries(FLAG_BITS);
  const counts: Record<string, number> = {};
  for (const [name] of bits) counts[name] = 0;
  for (const f of arrays) {
    if (!f) continue;
    for (let k = 0; k < f.length; k++) {
      const v = f[k];
      if (!v) continue;
      for (const [name, bit] of bits) if (v & (1 << bit)) counts[name]++;
    }
  }
  return counts;
}

function OverlaysTab() {
  const v = useSessionVersion();
  const t = useT();
  const rt = useRt();
  const on = useApp((s) => s.overlaysOn);
  const setOn = useApp((s) => s.setOverlayOn);
  const counts = useMemo(
    () => countFlags([...session.cutouts.values()].map((c) => c.flags)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v],
  );
  const gaia = useMemo(() => {
    const c = session.center;
    return (session.gaia ?? [])
      .map((s) => ({ s, sep: c ? angularSepArcsec(c.ra, c.dec, s.ra, s.dec) : NaN }))
      .sort((a, b) => (a.s.mag ?? 99) - (b.s.mag ?? 99))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const layers: (keyof OverlayToggles)[] = ['gaia', 'track', 'flags', 'solarSystem'];
  return (
    <div data-testid="rtab-overlays-body">
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {layers.map((k) => (
          <label key={k} className="small">
            <input type="checkbox" checked={on[k]} onChange={(e) => setOn(k, e.target.checked)} data-testid={`ov-${k}`} /> {t(`mtab.ov.${k}`)}
          </label>
        ))}
      </fieldset>
      {/* Read-only: the blink view's "Flagged pixels" toggle shows every flagged pixel, not a chosen bit. */}
      <FlagLegend counts={counts} t={rt} />
      <p className="muted small" style={capStyle}>
        {t('mtab.ov.flagsCap', { n: session.cutouts.size })}
      </p>
      <h4 style={{ margin: '8px 0 4px' }}>{t('mtab.ov.gaiaList', { n: session.gaia?.length ?? 0 })}</h4>
      {gaia.length === 0 ? (
        <p className="muted small">{t('mtab.ov.gaiaNone')}</p>
      ) : (
        <ul className="small mono" style={{ maxHeight: 220, overflow: 'auto', margin: 0, paddingLeft: 18 }}>
          {gaia.map(({ s, sep }) => (
            <li key={s.id}>
              {s.id} · {s.magBand ?? 'G'} {s.mag?.toFixed(2) ?? '–'} · {s.ra.toFixed(5)} {s.dec >= 0 ? '+' : ''}
              {s.dec.toFixed(5)}
              {Number.isFinite(sep) ? ` · ${t('mtab.ov.sep')} ${sep.toFixed(0)}″` : ''}
              {s.pmRa !== undefined && s.pmDec !== undefined ? ` · pm ${Math.hypot(s.pmRa, s.pmDec).toFixed(0)} mas/yr` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- provenance

const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

export function measurementCsv(points: PhotPoint[], relative: boolean): string {
  return toCsv(
    points.map((p) => ({
      exposureId: p.exposureId,
      obsId: p.obsId,
      detector: p.detector,
      mjd: p.mjd,
      utc: mjdToIsoDate(p.mjd),
      visit: p.visit ?? '',
      wavelength: p.wavelength,
      bandwidth: p.bandwidth,
      cubeChannel: p.cubeChannel,
      flux_mJy: p.flux,
      fluxErr_mJy: p.fluxErr,
      snr: p.snr,
      good: p.good,
      saturated: p.saturated,
      flags: p.flags,
      flagNames: flagNames(p.flags).join(' '),
      method: relative ? 'wing-relative' : p.method,
    })),
  );
}

function ProvenanceTab() {
  useSessionVersion();
  const t = useT();
  const rt = useRt();
  const demo = useApp((s) => s.demo);
  const target = useApp((s) => s.target);
  const { result, specs } = useMeasure();
  const s = session;
  const cutouts = [...s.cutouts.values()];
  const mjds = s.exposures.map((e) => e.mjd).filter(Number.isFinite);
  const sources: Record<string, number> = {};
  for (const id of s.cutouts.keys()) {
    const k = cutoutSource(id) ?? 'archive (S3 range reads)';
    sources[k] = (sources[k] ?? 0) + 1;
  }
  const items: ProvenanceItem[] = [
    { label: t('mtab.prov.target'), value: target ? target.name : s.center ? `${s.center.ra.toFixed(5)} ${s.center.dec.toFixed(5)}` : '–' },
    { label: t('mtab.prov.releases'), value: uniq(s.exposures.map((e) => e.release)).join(', ') || '–' },
    { label: t('mtab.prov.collections'), value: uniq(s.exposures.map((e) => e.collection)).join(', ') || '–' },
    { label: t('mtab.prov.exposures'), value: `${s.cutouts.size} / ${s.exposures.length}` },
    { label: t('mtab.prov.pipeline'), value: uniq(cutouts.map((c) => c.header.version).filter((x): x is string => !!x)).join(', ') || '–' },
    { label: t('mtab.prov.tags'), value: uniq(s.exposures.map((e) => e.pipelineTag)).slice(0, 4).join(', ') || '–' },
    { label: t('mtab.prov.dates'), value: mjds.length ? `${mjdToIsoDate(Math.min(...mjds))} – ${mjdToIsoDate(Math.max(...mjds))}` : '–' },
    { label: t('mtab.prov.pixels'), value: Object.entries(sources).map(([k, n]) => `${k}: ${n}`).join(', ') || '–', href: 'https://nasa-irsa-spherex.s3.amazonaws.com/index.html' },
    { label: t('mtab.prov.list'), value: demo ? 'DEMO (synthetic)' : s.source },
  ];
  if (result) {
    const ring = result.wingRing ?? result.ratio?.rings?.phot;
    items.push({
      label: t('mtab.prov.method'),
      value: result.relative ? t('mtab.prov.methodWing', { rin: ring ? ring.rin : '–', rout: ring ? ring.rout : '–' }) : t('mtab.prov.methodAp'),
    });
  }
  items.push({ label: t('mtab.prov.ack'), value: SPHEREX_ACKNOWLEDGEMENT });
  const citations = DATA_CREDITS.map((c) => ({ label: `${c.name} (${c.provider})`, doi: c.doi, url: c.url }));
  const detected = !!result && result.binned.some((b) => b.fluxErr > 0 && b.flux / b.fluxErr >= 3);
  const level: EvidenceLevel = detected ? 'detected' : 'observed';
  const stamp = new Date().toISOString().slice(0, 10);
  const name = (target?.id ?? 'field').replace(/[^\w-]+/g, '_');
  const exportCsv = () => {
    if (!result) return;
    downloadText(measurementCsv(result.points, result.relative), `trueblink-${name}-photometry-${stamp}.csv`, 'text/csv');
  };
  const exportJson = () => {
    const summary = {
      generator: 'TrueBlink (NASA Space Apps Challenge 2026)',
      demo,
      target,
      center: s.center,
      fovArcsec: s.fovArcsec,
      source: s.source,
      releases: uniq(s.exposures.map((e) => e.release)),
      collections: uniq(s.exposures.map((e) => e.collection)),
      exposures: s.exposures.length,
      loaded: s.cutouts.size,
      visits: s.visits.map((v) => ({ index: v.index, label: v.label, mjdMin: v.mjdMin, mjdMax: v.mjdMax, n: v.exposureIds.length })),
      pipelineVersions: uniq(cutouts.map((c) => c.header.version).filter(Boolean)),
      pixelSources: sources,
      warnings: s.warnings,
      measurement: result
        ? {
            relative: result.relative,
            cold: result.cold,
            isTarget: result.isTarget,
            pos: result.pos,
            binnedSpectrum: result.binned,
            lightCurve: result.lightCurve,
            ratio: result.ratio,
            brightness: result.brightness,
            motion: result.motion
              ? { ...result.motion, units: 'fit in mas/yr; epoch offsets in arcsec east (RA cos Dec) and north from the first visit' }
              : null,
            controls: result.controls.map((c) => ({ star: c.star, fit: c.fit, ratio: c.ratio, visits: c.epochs.length })),
            neighbours: result.neighbours,
            notes: result.notes,
            findings: specs,
          }
        : null,
      citations: DATA_CREDITS.map((c) => ({ name: c.name, doi: c.doi, url: c.url })),
      acknowledgement: SPHEREX_ACKNOWLEDGEMENT,
    };
    downloadText(JSON.stringify(summary, null, 2), `trueblink-${name}-session-${stamp}.json`, 'application/json');
  };
  return (
    <div data-testid="rtab-provenance-body">
      <DemoChip />
      <ProvenancePanel items={items} citations={citations} level={level} onExportCsv={result ? exportCsv : undefined} onExportJson={exportJson} t={rt} />
    </div>
  );
}

// ---------------------------------------------------------------- registration

let registered = false;

export function registerAllResearchTabs(): void {
  if (registered) return;
  registered = true;
  registerStrings('en', researchStringsEn as Record<string, string>);
  registerStrings('ko', researchStringsKo as Record<string, string>);
  registerResearchTab('frames', 'research.tab.frames', FramesTab);
  registerResearchTab('measure', 'research.tab.measure', MeasureTab);
  registerResearchTab('overlays', 'research.tab.overlays', OverlaysTab);
  registerResearchTab('provenance', 'research.tab.provenance', ProvenanceTab);
}
