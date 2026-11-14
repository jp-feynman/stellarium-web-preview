import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLang } from '../i18n';
import {
  ApiError, cancelJob, getCapabilities, getCatalog, getJob, getResult, getStoredJobId,
  resolveAssetUrl, resolveResultUrl, startJob, storeJobId,
} from './jiho-client';
import type { Capabilities, Catalog, Job, Loaded, Result } from './jiho-client';
import { jihoStrings } from './jiho-strings';
import type { JihoText } from './jiho-strings';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x !== null && typeof x === 'object' && !Array.isArray(x)) as Row[] : [];
const string = (v: unknown): string => typeof v === 'string' ? v : '';
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const abort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

function value(v: unknown, t: JihoText, uncertainty?: unknown, unit = ''): string {
  if (!numeric(v)) return t.na;
  const fmt = (x: number) => Math.abs(x) >= 1e8 || (x !== 0 && Math.abs(x) < 0.0001)
    ? x.toExponential(3) : new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(x);
  return `${fmt(v)}${numeric(uncertainty) ? ` ± ${fmt(uncertainty)}` : ''}${unit ? ` ${unit}` : ''}`;
}

function confidence(v: unknown, t: JihoText): string {
  return v === 'High' ? t.high : v === 'Medium' ? t.medium : v === 'Low' ? t.low : t.na;
}

function asset(file: unknown, resultUrl: string): string | undefined {
  if (typeof file !== 'string') return undefined;
  try { return resolveAssetUrl(file, resultUrl); } catch { return undefined; }
}

function sourceUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try { const url = new URL(v); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function JihoResultView({ loaded, t }: { loaded: Loaded<Result>; t: JihoText }) {
  const { data: result, url } = loaded;
  const r = result.record;
  const [plotKind, setPlotKind] = useState('spectrum');
  const plots = result.assets.plots.filter(p => asset(p.file, url));
  const plot = plots.find(p => p.kind === plotKind) ?? plots[0];
  const plotTitle = (kind: string) => {
    const key = kind.replaceAll('-', '_');
    return key in t ? t[key as keyof JihoText] : key.replaceAll('_', ' ');
  };
  const validation = row(result.validation);
  const reference = row(validation.reference);
  const criteria = rows(validation.criteria);
  const c7 = criteria.find(c => c.id === 'C7')?.result ?? row(validation.results).C7;
  const mismatch = c7 === 'FAIL';
  const candidates = rows(r.spectral_class_probability).slice(0, 8);
  const minerals = rows(r.mineral_candidates);
  const features = rows(r.absorption_features);
  const calibration = row(r.spectral_calibration);
  const missing = strings(r.missing_data);
  const limitations = strings(r.limitations);
  const quality = row(r.quality_flag);
  const sources = rows(r.input_data_sources).filter((s, i, all) => all.findIndex(x => x.name === s.name && x.url === s.url) === i);
  const thermalDiameter = numeric(r.diameter_km);
  const catalogDiameter = numeric(r.catalog_diameter_km);
  const densityDiameterError = thermalDiameter ? r.diameter_uncertainty : r.catalog_diameter_uncertainty;
  const densitySource = thermalDiameter ? t.densityThermal : catalogDiameter ? t.densityCatalog : t.densityVolume;
  const albedoLowerBound = numeric(r.geometric_albedo_pV) && numeric(r.albedo_uncertainty)
    && (!numeric(r.H_uncertainty) || !numeric(r.diameter_uncertainty));
  const densityLowerBound = numeric(r.density) && numeric(r.density_uncertainty)
    && (!numeric(r.mass_uncertainty) || ((thermalDiameter || catalogDiameter) && !numeric(densityDiameterError)));
  const downloads = [
    [t.report, result.assets.report], [t.rawSpectrum, result.assets.spectrum],
    [t.components, result.assets.components], [t.temporal, result.assets.temporal], [t.observations, result.assets.observations],
  ].map(([label, file]) => ({ label, href: asset(file, url) })).filter(x => x.href);
  const metrics = [
    { label: t.diameter, content: value(r.diameter_km, t, r.diameter_uncertainty, 'km'), detail: string(r.diameter_source),
      extra: `${t.catalogDiameter}: ${value(r.catalog_diameter_km, t, r.catalog_diameter_uncertainty, 'km')}` },
    { label: t.albedo, content: value(r.geometric_albedo_pV, t, r.albedo_uncertainty), detail: string(r.albedo_status), extra: string(r.albedo_method), warning: albedoLowerBound ? t.lowerBound : undefined },
    { label: t.temperature, content: value(r.estimated_temperature, t, r.estimated_temperature_err, 'K') },
    { label: t.h, content: value(r.absolute_magnitude_H, t, r.H_uncertainty, 'mag'), detail: string(r.absolute_magnitude_source) },
    { label: t.mass, content: value(r.mass_kg, t, r.mass_uncertainty, 'kg'), detail: string(r.mass_method) },
    { label: t.density, content: value(r.density, t, r.density_uncertainty, 'kg/m³'), detail: string(r.shape_assumption), extra: numeric(r.density) ? densitySource : undefined, warning: densityLowerBound ? t.lowerBound : undefined },
  ];

  return <div className="astro-results" data-testid="jiho-result">
    <section className="astro-block">
      <div className="astro-result-heading">
        <h4>{string(r.official_name) || result.id}</h4>
        <span className="astro-badge">{t.observed}</span>
      </div>
      <dl className="astro-facts">
        <div><dt>{t.period}</dt><dd>{result.coverage.start?.slice(0, 10) ?? t.na} — {result.coverage.end?.slice(0, 10) ?? t.na}</dd></div>
        <div><dt>{t.measuredPeriod}</dt><dd>{result.measuredCoverage?.start?.slice(0, 10) ?? t.na} — {result.measuredCoverage?.end?.slice(0, 10) ?? t.na}</dd></div>
        <div><dt>{t.exposures} / {t.points}</dt><dd>{result.counts.exposures ?? '—'} / {result.counts.points ?? '—'}</dd></div>
        <div><dt>{t.uniqueExposures}</dt><dd>{result.counts.uniqueExposureIds ?? '—'}</dd></div>
        <div><dt>{t.confidence}</dt><dd>{confidence(r.confidence_level, t)}</dd></div>
        <div><dt>{t.generated}</dt><dd>{string(r.analysis_timestamp) || t.na}</dd></div>
      </dl>
      <p className="astro-note">{r.quality_status === 'Complete' ? t.complete : t.partial}. {t.completeNote}</p>
      {missing.length > 0 && <p className="astro-note"><strong>{t.missing}:</strong> {missing.join(', ')}</p>}
    </section>

    <div className="astro-metrics">
      {metrics.map(m => <section key={m.label} className="astro-block astro-metric">
        <h4>{m.label}</h4><p className="astro-metric-value">{m.content}</p>
        {m.detail && <p className="astro-src">{m.detail}</p>}
        {m.extra && <p className="astro-src">{m.extra}</p>}
        {m.warning && <p className="astro-note">{m.warning}</p>}
      </section>)}
    </div>
    <p className="astro-note">{t.uncertainty} {t.massNote}</p>

    <section className="astro-block">
      <h4>{t.classification}</h4>
      <p><strong>{string(r.spectral_class) || t.na}</strong> · {t.classConfidence}: {confidence(r.classification_confidence, t)}</p>
      <p className="astro-note">{t.probabilityNote}</p>
      {mismatch && <p className="astro-science-warning" role="note" data-testid="jiho-validation-mismatch">{t.validationMismatch}</p>}
      {Object.keys(reference).length > 0
        ? <p className="astro-note">{t.reference}: {string(reference.class)} ({string(reference.complex)}). {c7 === 'PASS' ? t.validationPass : ''}</p>
        : <p className="astro-note">{t.validationNone}</p>}
      {candidates.length > 0 && <div className="astro-tablewrap"><table className="astro-table">
        <thead><tr><th>{t.className}</th><th>{t.complex}</th><th>{t.probability}</th></tr></thead>
        <tbody>{candidates.map((c, i) => <tr key={`${string(c.class)}-${i}`}><td>{string(c.class)}</td><td>{string(c.complex)}</td><td className="num">{numeric(c.probability) ? `${(c.probability * 100).toFixed(1)} %` : t.na}</td></tr>)}</tbody>
      </table></div>}
    </section>

    <section className="astro-block">
      <h4>{t.minerals}</h4><p className="astro-note">{t.mineralNote}</p>
      {minerals.length ? <ul className="astro-list">{minerals.map((m, i) => <li key={i}><strong>{string(m.mineral)}</strong> — {string(m.evidence)} ({confidence(m.confidence, t)})</li>)}</ul> : <p>{t.noMinerals}</p>}
      {features.length > 0 && <div className="astro-tablewrap astro-features"><table className="astro-table">
        <thead><tr><th>{t.feature}</th><th>{t.status}</th><th>{t.center}</th><th>{t.depth}</th><th>{t.evidence}</th></tr></thead>
        <tbody>{features.map((f, i) => <tr key={i}>
          <td>{string(f.name)}</td><td>{f.status === 'DETECTED' ? t.detected : f.status === 'NOT_DETECTED' ? t.notDetected : t.insufficient}</td>
          <td className="num">{f.status === 'DETECTED' ? value(f.center_um, t, f.center_err_um) : '—'}</td>
          <td className="num">{f.status === 'DETECTED' ? value(f.depth, t, f.depth_err) : '—'}</td>
          <td className="astro-wrap">{string(f.reason) || string(f.note)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="astro-block">
      <h4>{t.plots}</h4><p className="astro-note">{t.plotNote}</p>
      {plot ? <>
        <div className="astro-mode-buttons" role="group" aria-label={t.plots}>
          {plots.map(p => <button key={p.kind} type="button" className="astro-btn" aria-pressed={p.kind === plot.kind} onClick={() => setPlotKind(p.kind)}>{plotTitle(p.kind)}</button>)}
        </div>
        <figure className="astro-result-figure"><img src={asset(plot.file, url)} alt={`${string(r.official_name) || result.id}: ${plotTitle(plot.kind)}`} loading="lazy" /><figcaption>{plotTitle(plot.kind)}</figcaption></figure>
      </> : <p>{t.noPlots}</p>}
    </section>

    <section className="astro-block">
      <h4>{t.downloads}</h4>
      <div className="astro-downloads">
        <a className="astro-btn" href={url} download={`${result.id}-analysis.json`}>{t.json}</a>
        {downloads.map(d => <a key={d.label} className="astro-btn" href={d.href} download>{d.label}</a>)}
      </div>
    </section>

    <details className="astro-block astro-details">
      <summary>{t.limitations}</summary>
      <p>{t.model}: {string(r.model_version) || t.na}</p>
      <p>{t.quality}: {Object.entries(quality).map(([k, v]) => `${k}: ${v}`).join(', ') || t.na}</p>
      <p>{t.calibration}: {typeof calibration.applied === 'boolean' ? calibration.applied ? t.applied : t.notApplied : t.notRecorded}{numeric(calibration.n_stars) ? ` (${calibration.n_stars})` : ''}. {string(calibration.reason)}</p>
      <ul className="astro-list">{limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul>
      <h5>{t.sources}</h5>
      <ul className="astro-list">{sources.map((s, i) => <li key={i}>
        {sourceUrl(s.url) ? <a href={sourceUrl(s.url)} target="_blank" rel="noreferrer">{string(s.name)}</a> : string(s.name)}
        {string(s.retrieved_utc) ? ` · ${string(s.retrieved_utc)}` : ''}
      </li>)}</ul>
      {Object.keys(validation).length > 0 && <details className="astro-details"><summary>{t.validation}</summary><pre className="astro-json">{JSON.stringify(validation, null, 2)}</pre></details>}
    </details>
  </div>;
}

export function JihoAnalysis() {
  const t = jihoStrings[useLang() === 'ko' ? 'ko' : 'en'];
  const [catalog, setCatalog] = useState<Loaded<Catalog> | null>(null);
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState<Loaded<Result> | null>(null);
  const [latest, setLatest] = useState<Loaded<Result> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [probe, setProbe] = useState(0);
  const [jobId, setJobId] = useState<string | null>(() => getStoredJobId());
  const [job, setJob] = useState<Job | null>(null);
  const [pollError, setPollError] = useState(false);
  const [previousJobMissing, setPreviousJobMissing] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [requestError, setRequestError] = useState('');
  const [busyNotice, setBusyNotice] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [target, setTarget] = useState('433');
  const [start, setStart] = useState('2026-02-01');
  const [end, setEnd] = useState('2026-02-21');
  const [maxImages, setMaxImages] = useState(120);
  const active = job?.status === 'queued' || job?.status === 'running' || starting;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    getCatalog(controller.signal).then(c => {
      setCatalog(c); setSelected(prev => prev || c.data.targets[0]?.id || '');
      if (!c.data.targets.length) setLoading(false);
    }).catch(e => { if (!abort(e)) { setLoadError(true); setLoading(false); } });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (selected === 'latest' && latest) { setLoaded(latest); setLoading(false); setLoadError(false); return; }
    const entry = catalog?.data.targets.find(x => x.id === selected);
    if (!entry || !catalog) return;
    const controller = new AbortController();
    setLoading(true); setLoadError(false); setLoaded(null);
    getResult(resolveResultUrl(entry.detail, catalog.url), controller.signal).then(r => {
      setLoaded(r); setLoading(false);
    }).catch(e => { if (!abort(e)) { setLoadError(true); setLoading(false); } });
    return () => controller.abort();
  }, [catalog, selected, latest, reload]);

  useEffect(() => {
    const controller = new AbortController();
    setCapabilities(null);
    getCapabilities(controller.signal).then(setCapabilities).catch(e => {
      if (!abort(e)) setCapabilities({ available: false, maxImages: 360 });
    });
    return () => controller.abort();
  }, [probe]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    setPollError(false); setPreviousJobMissing(false);
    async function poll() {
      try {
        const current = await getJob(jobId!, controller.signal);
        if (!live) return;
        setJob(current); setPollError(false);
        if (current.status === 'completed' && current.resultUrl) {
          const result = await getResult(new URL(current.resultUrl, window.location.origin).href, controller.signal);
          if (!live) return;
          setLatest(result); setSelected('latest'); setLoaded(result); setLoading(false);
        } else if (current.status === 'running' || current.status === 'queued') {
          timer = setTimeout(() => void poll(), 1500);
        }
      } catch (e) {
        if (!live || abort(e)) return;
        setPollError(true);
        if (e instanceof ApiError && e.status === 404) { storeJobId(null); setJob(null); setPreviousJobMissing(true); }
      }
    }
    void poll();
    return () => { live = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [jobId, reconnect]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const maximum = capabilities?.maxImages ?? 360;
    if (!target.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || !Number.isInteger(maxImages) || maxImages < 1 || maxImages > maximum) {
      setRequestError(t.inputInvalid); return;
    }
    setStarting(true); setRequestError(''); setBusyNotice(false); setPollError(false);
    try {
      const created = await startJob({ target: target.trim(), start, end, maxImages });
      storeJobId(created.id); setJobId(created.id); setJob(null); setReconnect(x => x + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.id) {
        storeJobId(e.id); setJobId(e.id); setBusyNotice(true); setReconnect(x => x + 1);
      } else setRequestError(e instanceof Error ? e.message : t.jobError);
    } finally { setStarting(false); }
  }

  async function cancel() {
    if (!jobId) return;
    setCancelling(true); setRequestError('');
    try { await cancelJob(jobId); setReconnect(x => x + 1); }
    catch (e) { setRequestError(e instanceof Error ? e.message : t.jobError); }
    finally { setCancelling(false); }
  }

  return <div className="astro-integrated" data-testid="jiho-analysis">
    <header className="astro-head"><h3>{t.title}</h3><p className="astro-muted">{t.intro}</p></header>
    <div className="astro-controls">
      <label htmlFor="jiho-saved"><span>{t.pick}</span><select id="jiho-saved" value={selected} onChange={e => setSelected(e.target.value)} disabled={!catalog && !latest}>
        {!catalog?.data.targets.length && !latest && <option value="">{t.empty}</option>}
        {catalog?.data.targets.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        {latest && <option value="latest">{string(latest.data.record.official_name) || latest.data.id} · {t.live}</option>}
      </select></label>
    </div>

    <details className="astro-block astro-details astro-run" open={!!jobId}>
      <summary>{t.runTitle}</summary>
      <p>{t.runIntro}</p>
      {capabilities === null ? <p role="status">{t.checking}</p> : !capabilities.available ? <div>
        <p>{capabilities.code === 'python_unavailable' ? t.setupUnavailable : t.localUnavailable}</p>
        <button type="button" className="astro-btn" onClick={() => setProbe(x => x + 1)}>{t.retry}</button>
      </div> : <>
        <p className="astro-note">{t.ready}</p>
        <form className="astro-run-form" onSubmit={event => void submit(event)}>
          <label htmlFor="jiho-target"><span>{t.target}</span><input id="jiho-target" required maxLength={100} value={target} placeholder={t.targetPlaceholder} onChange={e => setTarget(e.target.value)} disabled={active} /></label>
          <label htmlFor="jiho-start"><span>{t.start}</span><input id="jiho-start" type="date" required value={start} max={end || undefined} onChange={e => setStart(e.target.value)} disabled={active} /></label>
          <label htmlFor="jiho-end"><span>{t.end}</span><input id="jiho-end" type="date" required value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} disabled={active} /></label>
          <label htmlFor="jiho-limit"><span>{t.imageLimit}</span><input id="jiho-limit" type="number" required min={1} max={capabilities.maxImages} step={1} value={Number.isFinite(maxImages) ? maxImages : ''} onChange={e => setMaxImages(e.target.valueAsNumber)} disabled={active} /></label>
          <button className="astro-btn astro-primary" type="submit" disabled={active}>{starting ? t.starting : t.run}</button>
        </form>
        <p className="astro-note">{t.slow}</p>
      </>}
      {busyNotice && <p role="status">{t.busy}</p>}
      {requestError && <p className="astro-error" role="alert">{requestError}</p>}
      {pollError && <p className="astro-error" role="alert">{previousJobMissing ? t.previousJobMissing : <>{t.pollError} <button type="button" className="astro-btn" onClick={() => setReconnect(x => x + 1)}>{t.retry}</button></>}</p>}
      {job && <section className="astro-job" aria-label={t.job} data-testid="jiho-job">
        <p role="status"><strong>{t[job.status]}</strong> · {job.target} · {job.start} — {job.end}</p>
        {(job.status === 'running' || job.status === 'queued') && <>
          <p className="astro-note">{t.resultsPending}</p>
          <button type="button" className="astro-btn" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? t.cancelling : t.cancel}</button>
        </>}
        {job.error && <p className="astro-error">{job.error}</p>}
        {job.logs.length > 0 && <details className="astro-details"><summary>{t.logs}</summary><pre className="astro-job-log">{job.logs.join('\n')}</pre></details>}
      </section>}
    </details>

    {loading && <p role="status">{t.loading}</p>}
    {loadError && <p className="astro-error" role="alert">{t.loadError} <button type="button" className="astro-btn" onClick={() => setReload(x => x + 1)}>{t.retry}</button></p>}
    {!loading && !loadError && !loaded && <p>{t.empty}</p>}
    {loaded && !loading && <JihoResultView key={loaded.url} loaded={loaded} t={t} />}
  </div>;
}
