// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Measurements on the loaded cutouts of the current session: photometry on native pixels, a binned
// spectrum, a like-with-like light curve and brightness ratio, and motion from per-visit centroids,
// each compared with comparison stars measured the same way. Saturated targets are measured on
// their wings (relative brightness only); cold objects use arrays 5 and 6 for motion.
// Results: points -> useApp spectrum, plain-language findings -> useApp findings, everything else
// -> useMeasure (src/app/measure/store.ts) for the Research tabs.

import { aperturePhot, buildSpectrum, centroid, lightCurve, matchedRatio } from '../../core/phot';
import type { CatalogSource, NativeCutout, PhotPoint, SkyPos, TargetInfo, Visit } from '../../core/types';
import { mjdToIsoDate } from '../../core/types';
import { angularSepArcsec, skyToPix } from '../../core/wcs';
import { registerStrings, t as translate } from '../i18n';
import { session } from '../session';
import { useApp } from '../store';
import {
  aggregateVisits,
  bandRatios,
  brightnessVerdict,
  centroidErr,
  coreSaturated,
  isColdTarget,
  motionFromVisits,
  motionSignificant,
  nearNeighbours,
  positionAt,
  robustRatio,
  selectGaiaControls,
  selectPeakControls,
  wellCoveredVisits,
  saturationRadius,
  wingCentroid,
  wingPhot,
  wingRings,
  type ControlStar,
  type PosSample,
} from './core';
import { buildFindings, renderFinding } from './findings';
import { useMeasure } from './store';
import { measureEn, measureKo } from './strings';
import type { ControlResult, MeasureResult, MotionResult, Neighbour, RatioResult } from './types';

export { useMeasure } from './store';
export type { MeasureResult, MotionResult, ControlResult, RatioResult } from './types';

registerStrings('en', measureEn);
registerStrings('ko', measureKo);

/** What measureSession needs from the session (the live Session object satisfies it). */
export interface MeasureInput {
  id: number;
  target: TargetInfo | null;
  center: SkyPos | null;
  cutouts: Map<string, NativeCutout>;
  visits: Visit[];
  visitOf: Map<string, number>;
  gaia: CatalogSource[] | null;
}

/** A picked position closer than this to the target's predicted position counts as the target. */
const SAME_AS_TARGET_ARCSEC = 10;
const SATURATED_FRACTION = 0.2;

function visitFor(input: MeasureInput, c: NativeCutout): number | undefined {
  const v = input.visitOf.get(c.exposure.id);
  if (v !== undefined) return v;
  const m = c.header.mjdAvg;
  const hit = input.visits.find((x) => m >= x.mjdMin - 1 && m <= x.mjdMax + 1);
  return hit?.index;
}

function onWindow(c: NativeCutout, p: SkyPos, margin = 0): boolean {
  const [x, y] = skyToPix(c.header.wcs, p.ra, p.dec);
  const lx = x - c.x0;
  const ly = y - c.y0;
  return lx >= margin && ly >= margin && lx <= c.nx - 1 - margin && ly <= c.ny - 1 - margin;
}

function mjdOf(c: NativeCutout): number {
  return Number.isFinite(c.header.mjdAvg) ? c.header.mjdAvg : c.exposure.mjd;
}

interface Measured {
  points: PhotPoint[];
  samples: PosSample[];
  saturated: number;
}

/** Photometry and centroids of one source on every cutout. */
function measureSource(
  cutouts: NativeCutout[],
  input: MeasureInput,
  at: (mjd: number) => SkyPos,
  mode: 'auto' | 'aperture' | 'wings',
): Measured & { relative: boolean; satR: number } {
  let satR = 0;
  const used = cutouts.filter((c) => onWindow(c, at(mjdOf(c)), 1));
  let saturated = 0;
  const ap: PhotPoint[] = [];
  for (const c of used) {
    const pos = at(mjdOf(c));
    const p = aperturePhot(c, pos);
    p.visit = visitFor(input, c);
    if (p.saturated || coreSaturated(c, pos)) saturated++;
    ap.push(p);
  }
  const relative = mode === 'wings' || (mode === 'auto' && saturated >= Math.max(3, SATURATED_FRACTION * used.length));
  // One fixed set of rings for the whole series (so ratios compare like with like), outside the
  // saturated core of the brightest exposures (90th percentile of the saturation radius).
  let rings = wingRings(0);
  if (relative) {
    const radii = used.map((c) => saturationRadius(c, at(mjdOf(c)))).sort((a, b) => a - b);
    satR = radii.length ? radii[Math.min(radii.length - 1, Math.floor(0.9 * radii.length))] : 0;
    rings = wingRings(satR);
  }
  const points = relative
    ? used.map((c) => {
        const p = wingPhot(c, at(mjdOf(c)), rings.phot);
        p.visit = visitFor(input, c);
        return p;
      })
    : ap;
  const samples: PosSample[] = [];
  used.forEach((c, k) => {
    const pos = at(mjdOf(c));
    const visit = visitFor(input, c);
    if (visit === undefined) return;
    if (relative) {
      const w = wingCentroid(c, pos, rings.cen);
      if (!w || !w.ok) return;
      samples.push({ visit, mjd: mjdOf(c), ra: w.ra, dec: w.dec, err: 0.5, detector: c.header.detector ?? c.exposure.detector });
    } else {
      const ce = centroid(c, pos);
      if (!ce || !ce.ok) return;
      // Reject centroids that jumped to a neighbour (more than 1.5 px from the prediction).
      if (angularSepArcsec(ce.ra, ce.dec, pos.ra, pos.dec) > 9.5) return;
      samples.push({
        visit,
        mjd: mjdOf(c),
        ra: ce.ra,
        dec: ce.dec,
        err: centroidErr(c.header.psfFwhmArcsec, ap[k].snr),
        detector: c.header.detector ?? c.exposure.detector,
      });
    }
  });
  return { points, samples, saturated, relative, satR };
}

function detectorOf(s: PosSample): number {
  return s.detector ?? 0;
}

/**
 * Measure a position (or the session target, propagated to each exposure's date) on every loaded
 * cutout. Pure apart from reading `input`; used by runMeasurements and by scripts/measure-check.ts.
 */
export function measureSession(input: MeasureInput, pos: SkyPos | null): MeasureResult {
  const cutouts = [...input.cutouts.values()].sort((a, b) => mjdOf(a) - mjdOf(b));
  const target = input.target;
  const midMjd = cutouts.length ? mjdOf(cutouts[Math.floor(cutouts.length / 2)]) : 60800;
  const targetAt = (mjd: number): SkyPos => (target ? positionAt(target, target, mjd) : (input.center ?? { ra: 0, dec: 0 }));
  let isTarget = !pos && !!(target || input.center);
  if (pos && target) {
    const tp = targetAt(midMjd);
    if (angularSepArcsec(pos.ra, pos.dec, tp.ra, tp.dec) < SAME_AS_TARGET_ARCSEC) isTarget = true;
  }
  const fixed = pos ?? input.center ?? { ra: 0, dec: 0 };
  const at = (mjd: number): SkyPos => (isTarget && target ? targetAt(mjd) : fixed);
  const notes: string[] = [];

  const main = measureSource(cutouts, input, at, 'auto');
  const relative = main.relative;
  if (relative) {
    const rg = wingRings(main.satR);
    notes.push(
      `saturated in ${main.saturated} of ${main.points.length} exposures (core radius ${main.satR} px): wing photometry ${rg.phot.rin}-${rg.phot.rout} px, wing centroids ${rg.cen.rin}-${rg.cen.rout} px`,
    );
  }

  // Cold objects: motion on detectors 5 and 6 only.
  const snrByDet = new Map<number, number[]>();
  if (!relative) {
    for (const p of main.points) {
      if (!Number.isFinite(p.snr)) continue;
      const l = snrByDet.get(p.detector);
      if (l) l.push(p.snr);
      else snrByDet.set(p.detector, [p.snr]);
    }
  }
  const cold = !relative && isColdTarget(isTarget ? target : null, snrByDet);
  const motionDets = cold ? [5, 6] : [1, 2, 3, 4, 5, 6];
  if (cold) notes.push('cold object: motion from detectors 5 and 6 only');
  const samples = main.samples.filter((s) => motionDets.includes(detectorOf(s)));
  const epochs = aggregateVisits(samples);
  const parallax = isTarget && target?.parallax ? target.parallax : undefined;
  const fit = motionFromVisits(epochs, parallax);

  // Comparison stars.
  let stars: ControlStar[] = [];
  if (input.gaia && input.gaia.length) stars = selectGaiaControls(input.gaia, cutouts, at);
  if (stars.length < 2) {
    const peaks = selectPeakControls(cutouts, at).filter((p) => !stars.some((s) => angularSepArcsec(s.ra, s.dec, p.ra, p.dec) < 10));
    stars = [...stars, ...peaks].slice(0, 5);
  }

  // Like-with-like brightness: first and last well-covered visit.
  // Cold objects: brightness only where they are detected (arrays 5 and 6); shorter wavelengths
  // hold noise or a neighbour's light.
  const varPoints = (pts: PhotPoint[]) => (cold ? pts.filter((p) => p.detector >= 5) : pts);
  const covered = wellCoveredVisits(varPoints(main.points));
  let ratio: RatioResult | null = null;
  const label = (v: number) => input.visits[v]?.label ?? `visit ${v + 1}`;
  if (covered.length >= 2) {
    const a = covered[0];
    const b = covered[covered.length - 1];
    const rows = matchedRatio(varPoints(main.points), a, b);
    if (rows.length) {
      const bands = bandRatios(rows);
      ratio = { visitA: a, visitB: b, labelA: label(a), labelB: label(b), rows, combined: robustRatio(rows), bands: { short: bands.short, long: bands.long }, perDetector: bands.perDetector };
      if (relative) {
        // How much does the wing ratio depend on where it is measured? The same two visits with a
        // ring 2 px further from the core (only these visits' exposures are measured again).
        const phot = wingRings(main.satR).phot;
        const alt = { rin: phot.rin + 2, rout: phot.rout + 2 };
        const altPts: PhotPoint[] = [];
        for (const c of cutouts) {
          const v = visitFor(input, c);
          if (v !== a && v !== b) continue;
          const p0 = at(mjdOf(c));
          if (!onWindow(c, p0, 1)) continue;
          const p = wingPhot(c, p0, alt);
          p.visit = v;
          altPts.push(p);
        }
        const ab = bandRatios(matchedRatio(varPoints(altPts), a, b));
        ratio.rings = { phot, alt, altBands: { short: ab.short, long: ab.long } };
      }
    }
  }

  const controls: ControlResult[] = [];
  for (const star of stars) {
    const cat = (mjd: number) => positionAt(star.src, star, mjd);
    const m = measureSource(cutouts, input, cat, 'aperture');
    if (m.points.length === 0 || m.saturated > 0.3 * m.points.length) continue;
    const ep = aggregateVisits(m.samples.filter((s) => motionDets.includes(detectorOf(s))));
    const cfit = motionFromVisits(ep);
    const crow = ratio ? matchedRatio(varPoints(m.points), ratio.visitA, ratio.visitB) : [];
    const cr = crow.length ? robustRatio(crow) : null;
    const cb = crow.length ? bandRatios(crow) : null;
    controls.push({ star, points: m.points, epochs: ep, fit: cfit, ratio: cr, bands: cb ? { short: cb.short, long: cb.long } : null, lightCurve: lightCurve(varPoints(m.points)) });
  }

  const brightness = ratio
    ? brightnessVerdict(
        ratio.combined.ratio,
        ratio.combined.ratioErr,
        controls.map((c) => c.ratio?.ratio).filter((x): x is number => x !== undefined && Number.isFinite(x)),
      )
    : null;

  let motion: MotionResult | null = null;
  if (epochs.length > 0) {
    const sig = fit
      ? motionSignificant(fit.total, fit.totalErr, controls.filter((c) => c.fit).map((c) => ({ total: c.fit!.total })))
      : { significant: false, threshold: NaN, controlMedian: NaN };
    const pmRa = isTarget ? target?.pmRa : undefined;
    const pmDec = isTarget ? target?.pmDec : undefined;
    motion = {
      epochs,
      fit,
      catalogue: pmRa !== undefined || pmDec !== undefined ? { pmRa: pmRa ?? 0, pmDec: pmDec ?? 0, total: Math.hypot(pmRa ?? 0, pmDec ?? 0) } : undefined,
      detectors: motionDets,
      method: relative ? 'wings' : 'centroid',
      nCentroids: samples.length,
      significant: sig.significant,
      threshold: sig.threshold,
      controlMedian: sig.controlMedian,
    };
  }

  // Neighbouring Gaia stars within 8 arcsec at any epoch.
  const neighbours: Neighbour[] = [];
  if (input.gaia && input.gaia.length && cutouts.length) {
    const mjds = input.visits.length ? input.visits.map((v) => v.mjdMid) : [mjdOf(cutouts[0]), mjdOf(cutouts[cutouts.length - 1])];
    // A faint star next to a saturated one does not matter; next to a faint target it does.
    const magLimit = relative ? 14 : 19.5;
    for (const n of nearNeighbours(input.gaia.filter((s) => (s.mag ?? 0) <= magLimit), at, mjds, 8)) {
      neighbours.push({ id: n.source.id, mag: n.source.mag, sepArcsec: n.sepArcsec, date: mjdToIsoDate(n.mjd) });
    }
  }

  return {
    sessionId: input.id,
    pos: isTarget ? null : fixed,
    isTarget,
    targetName: isTarget ? (target?.name ?? '') : '',
    points: main.points,
    binned: buildSpectrum(main.points),
    lightCurve: lightCurve(varPoints(main.points)),
    ratio,
    brightness,
    motion,
    controls,
    relative,
    wingRing: relative ? wingRings(main.satR).phot : undefined,
    saturatedCount: main.saturated,
    cold,
    neighbours,
    nCutouts: cutouts.length,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Wiring to the app

let runCounter = 0;
let langHooked = false;

function publishFindings(): void {
  const { result, specs } = useMeasure.getState();
  const app = useApp.getState();
  const others = app.findings.filter((f) => !f.id.startsWith('measure:'));
  if (!result) {
    if (others.length !== app.findings.length) app.setFindings(others);
    return;
  }
  const tt = (k: string, v?: Record<string, string | number>) => translate(k, v);
  app.setFindings([...others, ...specs.map((s) => renderFinding(s, tt, !result.isTarget))]);
}

function hookLanguage(): void {
  if (langHooked) return;
  langHooked = true;
  useApp.subscribe((s, prev) => {
    if (s.lang !== prev.lang) publishFindings();
  });
}

/** Photometry, like-with-like variability and motion for a sky position (default: the session target). */
/** Main-thread time of the last synchronous measureSession call (ms), for profiling. */
export let lastMeasureMs = 0;

export async function runMeasurements(pos?: SkyPos | null, opts?: { signal?: AbortSignal }): Promise<void> {
  hookLanguage();
  const run = ++runCounter;
  const sess = session;
  const sid = sess.id;
  useMeasure.getState().set({ status: 'running', error: undefined });
  // Let the UI paint the "measuring" state before the synchronous work.
  await new Promise((r) => setTimeout(r, 0));
  const stale = () => run !== runCounter || session.id !== sid || !!opts?.signal?.aborted;
  if (stale()) return;
  let result: MeasureResult;
  try {
    const t0 = performance.now();
    result = measureSession(sess, pos ?? null);
    lastMeasureMs = performance.now() - t0;
    if (typeof window !== 'undefined') (window as unknown as { __trueblinkMeasureMs?: number }).__trueblinkMeasureMs = lastMeasureMs;
  } catch (e) {
    if (!stale()) useMeasure.getState().set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (stale()) return;
  const specs = buildFindings(result, (v) => sess.visits[v]?.label ?? `visit ${v + 1}`);
  useMeasure.getState().set({ status: 'done', result, specs });
  useApp.getState().setSpectrum(result.points);
  publishFindings();
}

/** Forget measurement results (called when a new field is opened). */
export function clearMeasurements(): void {
  runCounter++;
  useMeasure.getState().clear();
  publishFindings();
}
