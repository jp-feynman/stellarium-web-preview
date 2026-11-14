// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Demo of every Research-mode component with realistic synthetic data (no network):
// a red dwarf spectrum over two visits, a Mira light curve, about 240 exposures of coverage,
// 3000 table rows, Barnard's Star motion and an S-type asteroid with a thermal tail.
// Open /demo/research.html (add ?lang=ko for the Korean strings).

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/styles/tokens.css';
import {
  AsteroidPanel,
  CoverageChart,
  ExposureTable,
  FlagLegend,
  LightCurveChart,
  MotionPanel,
  ProvenancePanel,
  RatioChart,
  SpectrumChart,
  makeT,
  researchStringsKo,
  downloadText,
  toCsv,
} from '../src/app/research';
import type { CoverageExposure, ExposureRow, LightCurveSeries, RatioRow } from '../src/app/research';
import type { PhotPoint, Visit } from '../src/core/types';
import { DETECTOR_BANDS, mjdToIsoDate } from '../src/core/types';
import busdemeo from '../public/data/busdemeo_class_means.json';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261114);
const gauss = () => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

/** Planck F_nu shape, arbitrary units: lambda^-3 / (exp(hc / lambda k T) - 1), lambda in microns. */
function planckNu(um: number, T: number): number {
  return Math.pow(um, -3) / (Math.exp(14387.77 / (um * T)) - 1);
}

/** A cool red dwarf (about 3100 K) with water bands at 1.4, 1.9 and 2.7 um and CO at 4.6 um, in mJy. */
function redDwarf(um: number): number {
  const base = (planckNu(um, 3100) / planckNu(1.25, 3100)) * 320;
  const dip = (c: number, w: number, d: number) => 1 - d * Math.exp(-0.5 * ((um - c) / w) ** 2);
  return base * dip(1.4, 0.06, 0.18) * dip(1.88, 0.08, 0.2) * dip(2.75, 0.18, 0.22) * dip(4.6, 0.12, 0.1);
}

// ---------------------------------------------------------------------------------------------
// Two visits of about two weeks, six months apart. Each observation reads a pair of detectors at
// once (D1+D4, D2+D5, D3+D6); successive observations step the target across the filter.

const VISIT_STARTS = [60807.2, 60988.6];
const visits: Visit[] = [];
const coverage: CoverageExposure[] = [];
const points: PhotPoint[] = [];
let obsCounter = 0;
VISIT_STARTS.forEach((t0, vi) => {
  const ids: string[] = [];
  let tMax = t0;
  for (let k = 0; k < 60; k++) {
    const pair = k % 3;
    const step = Math.floor(k / 3);
    const mjd = t0 + (13.5 * k) / 60 + rand() * 0.05;
    tMax = Math.max(tMax, mjd);
    obsCounter += 1;
    const obsId = `2025W${String(19 + vi * 26).padStart(2, '0')}_${vi + 1}B_${String(100 + obsCounter).padStart(4, '0')}_1`;
    for (const d of [pair + 1, pair + 4]) {
      const b = DETECTOR_BANDS[d];
      const frac = Math.min(0.99, Math.max(0.01, (step + 0.5 + (rand() - 0.5) * 0.4) / 20));
      const wl = b.min + (b.max - b.min) * frac;
      const id = `${obsId}D${d}`;
      ids.push(id);
      const cubeChannel = 17 * (d - 1) + Math.min(17, Math.max(1, Math.ceil(frac * 17)));
      const flux0 = redDwarf(wl);
      const err = flux0 * 0.02 + 0.3;
      const flagged = rand() < 0.06;
      const saturated = d === 2 && step === 9;
      points.push({
        exposureId: id,
        obsId,
        detector: d,
        mjd,
        wavelength: wl,
        bandwidth: wl / (d >= 5 ? 115 : 40),
        cubeChannel,
        flux: flux0 + err * gauss() + (flagged ? flux0 * 0.15 * (rand() - 0.3) : 0),
        fluxErr: err,
        method: 'aperture',
        flags: flagged ? 1 << 0 : saturated ? 1 << 1 : 0,
        saturated,
        good: !flagged && !saturated,
        snr: flux0 / err,
        visit: vi,
      });
      coverage.push({ id, mjd, wavelength: wl, detector: d, loaded: !(vi === 1 && k > 50), inSequence: d >= 5, visit: vi });
    }
  }
  visits.push({ index: vi, mjdMin: t0, mjdMax: tMax, mjdMid: (t0 + tMax) / 2, exposureIds: ids, label: mjdToIsoDate((t0 + tMax) / 2) });
});

// Binned spectrum: mean of good points per cube channel.
const byChannel = new Map<number, PhotPoint[]>();
for (const p of points) if (p.good) byChannel.set(p.cubeChannel, [...(byChannel.get(p.cubeChannel) ?? []), p]);
const binned = [...byChannel.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([, ps]) => {
    const n = ps.length;
    const w = ps.reduce((s, p) => s + p.wavelength, 0) / n;
    const f = ps.reduce((s, p) => s + p.flux, 0) / n;
    const e = Math.sqrt(ps.reduce((s, p) => s + p.fluxErr ** 2, 0)) / n;
    return { wavelength: w, flux: f, fluxErr: e, n };
  });

const cubeRef = { label: 'All-sky cube spectrum (all epochs averaged)', wavelength: [] as number[], flux: [] as number[] };
for (let d = 1; d <= 6; d++) {
  const b = DETECTOR_BANDS[d];
  for (let c = 0; c < 17; c++) {
    const wl = b.min + ((b.max - b.min) * (c + 0.5)) / 17;
    cubeRef.wavelength.push(wl);
    cubeRef.flux.push(redDwarf(wl) * 1.04);
  }
}

// Ratio of visit B to visit A in channels measured in both.
const ratioRows: RatioRow[] = [];
for (const [cc, ps] of byChannel) {
  const a = ps.filter((p) => p.visit === 0);
  const b = ps.filter((p) => p.visit === 1);
  if (!a.length || !b.length) continue;
  const fa = a[0].flux;
  const fb = b[0].flux;
  const r = fb / fa;
  ratioRows.push({ cubeChannel: cc, wavelength: (a[0].wavelength + b[0].wavelength) / 2, ratio: r, ratioErr: r * Math.hypot(a[0].fluxErr / fa, b[0].fluxErr / fb) });
}
ratioRows.sort((x, y) => x.wavelength - y.wavelength);

// Mira light curve (period about 245 days, like R Draconis) seen in four visits.
const miraVisits = [60807, 60988, 61170, 61352];
const miraSeries: LightCurveSeries[] = [{ label: 'Mira at 1.1 µm (matched channel)', color: 'var(--accent-time)', points: [] }];
const comp = [
  { label: 'Comparison star A', points: [] as { mjd: number; value: number; err: number }[] },
  { label: 'Comparison star B', points: [] as { mjd: number; value: number; err: number }[] },
];
for (const t0 of miraVisits) {
  for (let k = 0; k < 6; k++) {
    const mjd = t0 + k * 2.4 + rand() * 0.3;
    const v = 1 + 0.65 * Math.sin((2 * Math.PI * (mjd - 60750)) / 245);
    miraSeries[0].points.push({ mjd, value: v * (1 + 0.015 * gauss()), err: 0.02 * v, n: 1 });
    for (const c of comp) c.points.push({ mjd, value: 1 + 0.015 * gauss(), err: 0.015 });
  }
}

// 3000 table rows (several releases and both detectors of each pair).
const tableRows: ExposureRow[] = [];
const statuses: ExposureRow['status'][] = ['loaded', 'loaded', 'loaded', 'pending', 'off-detector', 'error'];
for (let i = 0; i < 3000; i++) {
  const d = (i % 6) + 1;
  const b = DETECTOR_BANDS[d];
  const week = 19 + Math.floor(i / 120);
  const wl = b.min + (b.max - b.min) * rand();
  const obsId = `2025W${week}_1B_${String(i % 997).padStart(4, '0')}_1`;
  const tag = `l2b-v27-2026-${197 + (i % 9)}`;
  const release = i % 7 === 0 ? 'qr3' : 'dr1';
  tableRows.push({
    id: `${obsId}D${d}`,
    obsId,
    detector: d,
    mjd: 60800 + i * 0.12,
    wavelength: wl,
    bandwidth: wl / (d >= 5 ? 115 : 40),
    cubeChannel: 17 * (d - 1) + 1 + Math.floor(rand() * 17),
    release,
    collection: `spherex_${release}`,
    flagsSummary: i % 11 === 0 ? 'PERSIST, SOURCE' : i % 5 === 0 ? 'SOURCE' : '',
    s3Key: `${release}/level2/2025W${week}_1B/${tag}/${d}/level2_${obsId}D${d}_spx_${tag}.fits`,
    status: statuses[i % statuses.length],
  });
}

// Barnard's Star: catalogue proper motion (-801.6, 10362.5) mas/yr, four dates over a year.
const pm = { pmRa: -801.6, pmDec: 10362.5 };
const motionEpochs = [60807.4, 60995.1, 61171.8, 61360.2].map((mjd) => {
  const dt = (mjd - 60807.4) / 365.25;
  return { label: mjdToIsoDate(mjd), mjd, dRaArcsec: (pm.pmRa / 1000) * dt + 0.35 * gauss(), dDecArcsec: (pm.pmDec / 1000) * dt + 0.35 * gauss(), err: 0.45 };
});

// S-type asteroid: reflectance with 1 and 2 um bands, plus a thermal tail.
const classes = (busdemeo as { wave_um: number[]; classes: Record<string, { mean: number[] }> }).classes;
const waveUm = (busdemeo as { wave_um: number[] }).wave_um;
const templates = ['S', 'V', 'C', 'D'].map((c) => ({ label: `${c} (Bus-DeMeo mean)`, wavelength: waveUm, reflectance: classes[c].mean, highlight: c === 'S' }));
const sMean = classes['S'].mean;
function interpS(wl: number): number {
  for (let i = 0; i < waveUm.length - 1; i++) {
    if (wl >= waveUm[i] && wl <= waveUm[i + 1]) return sMean[i] + ((sMean[i + 1] - sMean[i]) * (wl - waveUm[i])) / (waveUm[i + 1] - waveUm[i]);
  }
  return NaN;
}
const reflect: { wavelength: number; reflectance: number; err: number }[] = [];
for (let d = 1; d <= 3; d++) {
  const b = DETECTOR_BANDS[d];
  for (let c = 0; c < 17; c++) {
    const wl = b.min + ((b.max - b.min) * (c + 0.5)) / 17;
    // An S-type surface: the S class mean with a slightly redder slope (space weathering) and noise.
    const r = interpS(wl) * (1 + 0.04 * (wl - 1.2));
    reflect.push({ wavelength: wl, reflectance: r * (1 + 0.025 * gauss()), err: 0.025 });
  }
}
const norm = reflect.find((p) => Math.abs(p.wavelength - 1.2) < 0.03)?.reflectance ?? 1;
for (const p of reflect) p.reflectance /= norm;

const thW: number[] = [];
for (let w = 0.75; w <= 5.0001; w += 0.05) thW.push(Number(w.toFixed(3)));
const solar = (um: number) => (planckNu(um, 5778) / planckNu(1.0, 5778)) * 1.6;
const reflected = thW.map((w) => solar(w) * (1 + 0.04 * (Math.min(w, 2.45) - 1.2)));
const therm = (w: number, T: number, s: number) => s * (planckNu(w, T) / planckNu(4.5, 245));
const thermalLo = thW.map((w) => therm(w, 232, 0.55));
const thermalHi = thW.map((w) => therm(w, 258, 1.25));
const cross = (th: number[]) => thW.find((w, i) => th[i] > reflected[i]) ?? NaN;
const crossover: [number, number] = [cross(thermalHi), cross(thermalLo)];
const measuredTh = thW
  .filter((_, i) => i % 3 === 0)
  .map((w) => {
    const i = thW.indexOf(w);
    const f = reflected[i] + Math.sqrt(thermalLo[i] * thermalHi[i]);
    return { wavelength: w, flux: f * (1 + 0.05 * gauss()), err: f * 0.05 + 0.01 };
  });

function Demo() {
  const lang = new URLSearchParams(location.search).get('lang');
  const t = useMemo(() => (lang === 'ko' ? makeT(researchStringsKo) : undefined), [lang]);
  const [colorBy, setColorBy] = useState<'detector' | 'visit'>('detector');
  const [yScale, setYScale] = useState<'linear' | 'log'>('log');
  const [showFlagged, setShowFlagged] = useState(true);
  const [flagSel, setFlagSel] = useState<string[]>(['PERSIST']);
  const [picked, setPicked] = useState<string>('');
  const flagCounts: Record<string, number> = { TRANSIENT: 412, OVERFLOW: 37, NONFUNC: 9, DICHROIC: 1210, HOT: 22, PERSIST: 58, OUTLIER: 640, SOURCE: 21480, BLOOM: 31, HALO: 288, CROSSTALK: 14, GHOST: 6 };

  return (
    <main className="demo">
      <h1>TrueBlink · research components</h1>
      <p className="demo-sub">Synthetic data only. Selected: {picked || 'none'}</p>
      <div className="demo-controls" role="group" aria-label="Spectrum options">
        <button type="button" className="rs-btn" onClick={() => setColorBy(colorBy === 'detector' ? 'visit' : 'detector')}>
          Colour by: {colorBy}
        </button>
        <button type="button" className="rs-btn" onClick={() => setYScale(yScale === 'log' ? 'linear' : 'log')}>
          Y scale: {yScale}
        </button>
        <button type="button" className="rs-btn" onClick={() => setShowFlagged(!showFlagged)}>
          Flagged points: {showFlagged ? 'shown' : 'hidden'}
        </button>
      </div>
      <section id="spectrum">
        <SpectrumChart points={points} binned={binned} visits={visits} colorBy={colorBy} yScale={yScale} showFlagged={showFlagged} reference={cubeRef} t={t} />
      </section>
      <section id="coverage">
        <CoverageChart exposures={coverage} visits={visits} onSelect={setPicked} t={t} />
      </section>
      <div className="demo-two">
        <section id="lightcurve">
          <LightCurveChart series={miraSeries} controls={comp} yLabel="Relative flux (median = 1)" t={t} />
        </section>
        <section id="ratio">
          <RatioChart rows={ratioRows} labelA={visits[0].label} labelB={visits[1].label} t={t} />
        </section>
      </div>
      <section id="table">
        <ExposureTable rows={tableRows} onSelect={setPicked} t={t} />
      </section>
      <section id="motion">
        <MotionPanel
          target={{ name: "Barnard's Star", pmRa: pm.pmRa, pmDec: pm.pmDec, parallax: 546.98 }}
          epochs={motionEpochs}
          fit={{ pmRa: -760, pmDec: 10290, pmRaErr: 260, pmDecErr: 260, total: 10318, totalErr: 260, chi2: 3.1, n: 4 }}
          controls={[
            { label: 'Field star 1 (synthetic)', total: 180, totalErr: 250 },
            { label: 'Field star 2 (synthetic)', total: 310, totalErr: 270 },
            { label: 'Field star 3 (synthetic)', total: 95, totalErr: 240 },
            { label: 'Field star 4 (synthetic)', total: 220, totalErr: 260 },
          ]}
          t={t}
        />
      </section>
      <section id="flags">
        <FlagLegend counts={flagCounts} selected={flagSel} onToggle={(n) => setFlagSel(flagSel.includes(n) ? flagSel.filter((x) => x !== n) : [...flagSel, n])} t={t} />
      </section>
      <section id="provenance">
        <ProvenancePanel
          level="detected"
          items={[
            { label: 'Target', value: 'WISE 0855-0714 (RA 133.7864, Dec -7.2449)' },
            { label: 'Collection', value: 'spherex_dr1' },
            { label: 'Files', value: '240 Level-2 images (D1-D6)' },
            { label: 'Dates (UTC)', value: `${visits[0].label} and ${visits[1].label}` },
            { label: 'Pipeline', value: 'VERSION 7.0.5, l2b-v27' },
            { label: 'Example file', value: 'level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits', href: 'https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W19_1B/l2b-v27-2026-197/3/level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits' },
            { label: 'Photometry', value: 'aperture r = 2 px, ZODI subtracted, mask 0x3C028E44' },
            { label: 'Not recorded', value: 'He I 1.083 µm airglow amplitude' },
          ]}
          citations={[
            { label: 'SPHEREx DR1 Level-2 spectral images (IRSA)', doi: '10.26131/IRSA678' },
            { label: 'SPHEREx DR1 all-sky spectral cube (IRSA)', doi: '10.26131/IRSA679' },
            { label: 'SPHEREx Explanatory Supplement v2.1', url: 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/' },
          ]}
          onExportJson={() => downloadText(JSON.stringify({ visits }, null, 2), 'provenance.json', 'application/json')}
          onExportCsv={() => downloadText(toCsv(visits.map((v) => ({ index: v.index, label: v.label, mjdMin: v.mjdMin, mjdMax: v.mjdMax }))), 'visits.csv', 'text/csv')}
          t={t}
        />
      </section>
      <section id="asteroid">
        <AsteroidPanel
          name="(6425) 1994 WZ3 (synthetic)"
          catalogType="S (SMASS)"
          reflectance={reflect}
          templates={templates}
          thermal={{ wavelength: thW, reflected, thermalLo, thermalHi, measured: measuredTh, crossoverUm: crossover, eta: 1.05, etaErr: 0.18 }}
          classification={{ group: 'S-like', ranked: [{ group: 'S-like', cls: 'S', chi2: 14.2 }, { group: 'S-like', cls: 'Sq', chi2: 16.0 }, { group: 'V', cls: 'V', chi2: 31.5 }], gapToNext: 17.3 }}
          notes={['Reflectance divided by a solar spectrum and normalised at 1.2 µm.', 'Points above 2.4 µm are not used for taxonomy (thermal contamination).']}
          t={t}
        />
        <AsteroidPanel
          name="faint example"
          reflectance={reflect.slice(0, 20).map((p) => ({ ...p, err: 0.15 }))}
          templates={templates.slice(0, 2)}
          classification={{ group: '', ranked: [], gapToNext: 0, refused: 'median signal-to-noise 4 is below 10, and fewer than 12 usable points.' }}
          notes={[]}
          t={t}
        />
      </section>
    </main>
  );
}

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); }
  .demo { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
  .demo h1 { font-size: 1.2rem; margin: 0; }
  .demo-sub { color: var(--muted); margin: 0; font-size: 0.85rem; }
  .demo-controls { display: flex; flex-wrap: wrap; gap: 8px; }
  .demo-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .demo > section, .demo-two > section { min-width: 0; display: grid; gap: 16px; }
  @media (max-width: 420px) { .demo-two { grid-template-columns: minmax(0, 1fr); } }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
