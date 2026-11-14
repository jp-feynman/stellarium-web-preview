// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Plain-language findings for Explore mode, built from a measurement result. Findings are kept as
// language-independent specs (i18n keys + variables) and rendered with the current language, so a
// language switch re-renders them. Rules: never "discovery", say plainly when nothing significant
// was measured, and do not print a number we know is unreliable.

import { mjdToIsoDate } from '../../core/types';
import type { Finding } from '../store';
import { median } from '../research/helpers';
import { brightnessVerdict, colourExtremes, colourSplit, compassDirection, motionSignificant, type CombinedRatio } from './core';
import type { MeasureResult } from './types';

export interface FindingPart {
  key: string;
  vars?: Record<string, string | number>;
  /** Variables whose values are i18n keys themselves (e.g. compass directions). */
  keyVars?: Record<string, string>;
  /** Variables whose values are rendered parts themselves (e.g. "about half as bright"). */
  partVars?: Record<string, FindingPart>;
}

export interface FindingSpec {
  id: string;
  kind: Finding['kind'];
  title: FindingPart;
  body: FindingPart[];
  value?: string;
  reference?: string;
  confidence: Finding['confidence'];
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

function renderPart(p: FindingPart, t: T): string {
  const vars: Record<string, string | number> = { ...(p.vars ?? {}) };
  for (const [k, key] of Object.entries(p.keyVars ?? {})) vars[k] = t(key);
  for (const [k, part] of Object.entries(p.partVars ?? {})) vars[k] = renderPart(part, t);
  return t(p.key, vars);
}

export function renderFinding(s: FindingSpec, t: T, picked = false): Finding {
  const title = renderPart(s.title, t);
  return {
    id: s.id,
    kind: s.kind,
    title: picked ? `${t('measure.f.picked')}${title}` : title,
    body: s.body.map((b) => renderPart(b, t)).join(' '),
    value: s.value,
    reference: s.reference,
    confidence: s.confidence,
  };
}

/** Largest brightness difference between well-measured visits (>= 5 channels), relative to the mean, with its error. */
export function lightCurveSwing(lc: { mjd: number; rel: number; relErr: number; nChannels: number }[]): { swing: number; err: number; n: number; dateLo: string; dateHi: string } | null {
  const pts = lc.filter((p) => p.nChannels >= 5 && Number.isFinite(p.rel) && Number.isFinite(p.relErr));
  if (pts.length < 2) return null;
  const lo = pts.reduce((a, b) => (b.rel < a.rel ? b : a));
  const hi = pts.reduce((a, b) => (b.rel > a.rel ? b : a));
  const mean = pts.reduce((a, p) => a + p.rel, 0) / pts.length;
  return { swing: (hi.rel - lo.rel) / mean, err: Math.hypot(hi.relErr, lo.relErr) / mean, n: pts.length, dateLo: mjdToIsoDate(lo.mjd), dateHi: mjdToIsoDate(hi.mjd) };
}

const asec = (masyr: number, d = 2) => (masyr / 1000).toFixed(d);

function pctText(x: number): string {
  const p = Math.abs(x) * 100;
  return p >= 10 ? p.toFixed(0) : p.toFixed(1);
}

const signed = (x: number) => `${x < 0 ? '−' : '+'}${pctText(x)}\u00a0%`;
const um = (range: [number, number]) => `${range[0]}–${range[1]}`;

/** "about half as bright", "35 % brighter", "about as bright as before" for a ratio. */
export function changePhrase(ratio: number, floor: number): FindingPart {
  const c = ratio - 1;
  if (Math.abs(c) <= Math.max(0.05, 2 * floor)) return { key: 'measure.chg.same' };
  if (ratio >= 0.4 && ratio <= 0.6) return { key: 'measure.chg.half' };
  if (ratio >= 1.8 && ratio <= 2.25) return { key: 'measure.chg.twice' };
  return { key: c < 0 ? 'measure.chg.fainter' : 'measure.chg.brighter', vars: { pct: pctText(c) } };
}

/** The brightness finding: one number, a colour-dependent change, no change, or too noisy to tell. */
function brightnessFinding(r: MeasureResult): FindingSpec | null {
  const ratio = r.ratio;
  if (!ratio) return null;
  const ctrlRatios = r.controls.map((c) => c.ratio?.ratio).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const bv = brightnessVerdict(ratio.combined.ratio, ratio.combined.ratioErr, ctrlRatios);
  const k = Number.isFinite(bv.controlMedianChange) ? pctText(bv.controlMedianChange) : '–';
  const base = { dateA: ratio.labelA, dateB: ratio.labelB, m: ratio.rows.length, k };
  const caveats = (ctrlRatios.length < 2 ? 1 : 0) + (ratio.rows.length < 3 ? 1 : 0) + (r.neighbours.length ? 1 : 0);

  // Saturated targets: how much the band numbers move with a ring 2 px further from the core.
  const rings = r.relative ? ratio.rings : undefined;
  const spread = (a: CombinedRatio | undefined, b: CombinedRatio | undefined) =>
    a && b && Number.isFinite(a.ratio) && Number.isFinite(b.ratio) && b.n >= 3 ? Math.abs(a.ratio - b.ratio) : 0;
  const ringSpread = rings && ratio.bands ? { short: spread(ratio.bands.short, rings.altBands.short), long: spread(ratio.bands.long, rings.altBands.long) } : undefined;
  // The short-wavelength wing number depends on the ring when the two rings disagree beyond their errors.
  const ringDependent =
    !!rings && !!ratio.bands && !!ringSpread && ringSpread.short > 2 * Math.hypot(ratio.bands.short.ratioErr, rings.altBands.short.ratioErr) && ringSpread.short > 0.03;
  // Saturated targets always say how the short-wavelength number moves with the ring (both values).
  const ringPart = (): FindingPart | null =>
    rings && ratio.bands && Number.isFinite(rings.altBands.short.ratio) && rings.altBands.short.n >= 3 && Number.isFinite(ratio.bands.short.ratio)
      ? {
          key: 'measure.f.bright.ring',
          vars: {
            a: signed(ratio.bands.short.ratio - 1),
            b: signed(rings.altBands.short.ratio - 1),
            r1: `${rings.phot.rin}–${rings.phot.rout}`,
            r2: `${rings.alt.rin}–${rings.alt.rout}`,
          },
        }
      : null;

  // Colour-dependent change: short and long wavelengths disagree.
  const ctrlBand = (key: 'short' | 'long') =>
    r.controls.map((c) => c.bands?.[key]?.ratio).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const split = ratio.bands ? colourSplit(ratio.bands.short, ratio.bands.long, ctrlBand('short'), ctrlBand('long'), ringSpread) : null;
  if (split && split.colourDependent) {
    const ext = ratio.perDetector ? colourExtremes(ratio.perDetector) : null;
    const body: FindingPart[] = [];
    if (ext) {
      // "but" when one range brightened and the other faded; "and" when both went the same way.
      const opposite = (ext.lo.ratio - 1) * (ext.hi.ratio - 1) < 0;
      body.push({
        key: opposite ? 'measure.f.bright.colour.lead' : 'measure.f.bright.colour.leadSame',
        vars: { dateA: ratio.labelA, dateB: ratio.labelB, loBand: um(ext.lo.range), hiBand: um(ext.hi.range) },
        partVars: { lo: changePhrase(ext.lo.ratio, split.vLong.floor), hi: changePhrase(ext.hi.ratio, split.vShort.floor) },
      });
    }
    body.push({
      key: ext ? 'measure.f.bright.colour' : 'measure.f.bright.colourDated',
      vars: { ...base, pctS: pctText(split.vShort.change), pctL: pctText(split.vLong.change) },
      keyVars: { dirS: split.vShort.change < 0 ? 'measure.fainter' : 'measure.brighter', dirL: split.vLong.change < 0 ? 'measure.fainter' : 'measure.brighter' },
    });
    body.push(ctrlRatios.length ? { key: 'measure.f.bright.ctrl', vars: { k } } : { key: 'measure.f.bright.ctrlNone' });
    const rp = ringPart();
    if (rp) body.push(rp);
    else if (r.relative) body.push({ key: 'measure.f.bright.relNote' });
    const sig = Math.abs(split.diff) / split.diffErr;
    let confidence: Finding['confidence'] = sig > 5 && caveats === 0 ? 'high' : caveats >= 2 ? 'low' : 'medium';
    if (r.relative && confidence === 'high') confidence = 'medium';
    // Without any comparison star nothing checks the method on constant stars.
    if (ringDependent || ctrlRatios.length === 0) confidence = 'low';
    return {
      id: 'measure:brightness',
      kind: 'brightness',
      title: { key: 'measure.f.bright.colour.title' },
      body,
      value: `${signed(split.vLong.change)} (2.4–5\u00a0µm) · ${signed(split.vShort.change)} (0.75–2.4\u00a0µm)${r.relative ? ' (relative)' : ''}`,
      confidence,
    };
  }

  if (bv.significant) {
    let confidence: Finding['confidence'] = bv.sigma > 5 && caveats === 0 ? 'high' : caveats >= 2 ? 'low' : 'medium';
    if (r.relative && confidence === 'high') confidence = 'medium';
    const body: FindingPart[] = [
      {
        key: r.relative ? 'measure.f.bright.bodyRel' : 'measure.f.bright.body',
        vars: { ...base, pct: pctText(bv.change) },
        keyVars: { dir: bv.change < 0 ? 'measure.fainter' : 'measure.brighter' },
      },
    ];
    const rp = ringPart();
    if (rp) body.push(rp);
    if (ringDependent || ctrlRatios.length === 0) confidence = 'low';
    return {
      id: 'measure:brightness',
      kind: 'brightness',
      title: { key: 'measure.f.bright.title' },
      body,
      value: `${bv.change < 0 ? '−' : '+'}${pctText(bv.change)}\u00a0%${r.relative ? ' (relative)' : ''}`,
      confidence,
    };
  }

  if (bv.tooNoisy) {
    const e = Number.isFinite(ratio.combined.ratioErr) ? ratio.combined.ratioErr : NaN;
    return {
      id: 'measure:brightness',
      kind: 'brightness',
      title: { key: 'measure.f.bright.noisy.title' },
      body: [{ key: 'measure.f.bright.noisy.body', vars: { ...base, ratio: ratio.combined.ratio.toFixed(2), err: Number.isFinite(e) ? e.toFixed(2) : '–' } }],
      confidence: 'low',
    };
  }
  return {
    id: 'measure:brightness',
    kind: 'brightness',
    title: { key: 'measure.f.bright.none.title' },
    body: [{ key: 'measure.f.bright.none.body', vars: { ...base, lim: pctText(3 * bv.floor) } }],
    confidence: ctrlRatios.length >= 2 ? 'medium' : 'low',
  };
}

/** Build the Explore-mode findings for one measurement result. */
export function buildFindings(r: MeasureResult, visitLabel: (v: number) => string): FindingSpec[] {
  const out: FindingSpec[] = [];
  const nGood = r.points.filter((p) => p.good).length;
  if (r.points.length === 0) {
    return [{ id: 'measure:empty', kind: 'note', title: { key: 'measure.f.empty.title' }, body: [{ key: 'measure.f.empty.body' }], confidence: 'low' }];
  }

  // ---------------------------------------------------------------- motion
  const m = r.motion;
  const ctrlFits = r.controls.filter((c) => c.fit && Number.isFinite(c.fit.total)).map((c) => ({ total: c.fit!.total }));
  if (m && m.fit && m.epochs.length >= 2) {
    const fit = m.fit;
    const first = visitLabel(m.epochs[0].visit);
    const last = visitLabel(m.epochs[m.epochs.length - 1].visit);
    const dates = `${first} – ${last}`;
    const v = motionSignificant(fit.total, fit.totalErr, ctrlFits);
    const cat = m.catalogue;
    const ctrl = Number.isFinite(v.controlMedian) ? asec(v.controlMedian) : '–';
    const extra: FindingPart[] = fit.twoPoint ? [{ key: 'measure.f.motion.twoVisits' }] : [];
    const disagree =
      cat && cat.total > 0 && v.significant && Math.abs(fit.total - cat.total) > Math.max(4 * fit.totalErr, 0.35 * cat.total);
    if (disagree && cat) {
      out.push({
        id: 'measure:motion',
        kind: 'motion',
        title: { key: 'measure.f.motion.unreliable.title' },
        body: [{ key: 'measure.f.motion.unreliable.body', vars: { cat: asec(cat.total) }, keyVars: { catDir: `measure.dir.${compassDirection(cat.pmRa, cat.pmDec)}` } }],
        confidence: 'low',
      });
    } else if (v.significant) {
      // Agreement with the catalogue (within 2 sigma) is independent support: it offsets one caveat.
      const agrees = !!cat && cat.total > 0 && Math.abs(fit.total - cat.total) < 2 * fit.totalErr;
      const caveats = Math.max(0, (r.relative ? 1 : 0) + (r.neighbours.length ? 1 : 0) + (ctrlFits.length < 2 ? 1 : 0) - (agrees ? 1 : 0));
      const confidence: Finding['confidence'] = v.ratio >= 5 && caveats === 0 ? 'high' : caveats >= 2 ? 'low' : 'medium';
      const vars = { value: asec(fit.total), err: asec(fit.totalErr), nv: m.epochs.length, dates, ctrl };
      const dir = `measure.dir.${compassDirection(fit.pmRa, fit.pmDec)}`;
      out.push({
        id: 'measure:motion',
        kind: 'motion',
        title: { key: 'measure.f.motion.title' },
        body: [
          cat && cat.total > 0
            ? { key: 'measure.f.motion.body', vars: { ...vars, cat: asec(cat.total) }, keyVars: { dir, catDir: `measure.dir.${compassDirection(cat.pmRa, cat.pmDec)}` } }
            : { key: 'measure.f.motion.bodyNoCat', vars, keyVars: { dir } },
          ...extra,
        ],
        value: `${asec(fit.total)} ± ${asec(fit.totalErr)} arcsec/yr`,
        reference: cat && cat.total > 0 ? `${asec(cat.total)} arcsec/yr (catalogue)` : undefined,
        confidence,
      });
    } else {
      const limit = asec(v.threshold > 0 ? v.threshold : 3 * fit.totalErr);
      const shouldSee = cat && cat.total > v.threshold;
      out.push({
        id: 'measure:motion',
        kind: 'motion',
        title: { key: 'measure.f.motion.none.title' },
        body: [shouldSee && cat ? { key: 'measure.f.motion.noneCat.body', vars: { dates, limit, cat: asec(cat.total) } } : { key: 'measure.f.motion.none.body', vars: { dates, limit } }],
        value: `< ${limit} arcsec/yr`,
        confidence: shouldSee ? 'low' : ctrlFits.length >= 2 ? 'medium' : 'low',
      });
    }
  }

  // ---------------------------------------------------------------- brightness
  if (r.ratio && Number.isFinite(r.ratio.combined.ratio) && r.ratio.rows.length > 0) {
    const f = brightnessFinding(r);
    if (f) out.push(f);
  }

  // ---------------------------------------------------------------- visit-to-visit variability
  // The first/last ratio can miss a periodic variable (a Mira can be back at the same brightness).
  const lcv = lightCurveSwing(r.lightCurve);
  if (lcv && !out.some((f) => f.id === 'measure:brightness' && (f.title.key === 'measure.f.bright.title' || f.title.key === 'measure.f.bright.colour.title'))) {
    // What the method fakes on constant stars: the part of each comparison star's swing that its own
    // noise does not explain (swing - 2 x error), median over stars seen in at least 3 visits.
    const ctrl = r.controls
      .map((c) => lightCurveSwing(c.lightCurve))
      .filter((x): x is NonNullable<typeof x> => !!x && x.n >= Math.min(lcv.n, 3));
    const ctrlSwings = ctrl.map((x) => x.swing);
    const ctrlMed = median(ctrlSwings);
    const ctrlSys = median(ctrl.map((x) => Math.max(0, x.swing - 2 * x.err)));
    const floor = Math.max(lcv.err, Number.isFinite(ctrlSys) ? ctrlSys : 0, 0.02);
    if (lcv.swing > 3 * floor && lcv.n >= 3) {
      out.push({
        id: 'measure:variability',
        kind: 'brightness',
        title: { key: 'measure.f.var.title' },
        body: [
          {
            key: r.relative ? 'measure.f.var.bodyRel' : 'measure.f.var.body',
            vars: { pct: pctText(lcv.swing), n: lcv.n, dateLo: lcv.dateLo, dateHi: lcv.dateHi, k: Number.isFinite(ctrlMed) ? pctText(ctrlMed) : '–' },
          },
        ],
        value: `±${pctText(lcv.swing / 2)} %${r.relative ? ' (relative)' : ''}`,
        confidence: lcv.swing > 5 * floor && ctrlSwings.length >= 2 && !r.relative ? 'high' : 'medium',
      });
      // The first/last comparison said "no change"; the visit-to-visit finding supersedes it.
      const k = out.findIndex((f) => f.id === 'measure:brightness');
      if (k >= 0) out.splice(k, 1);
    }
  }

  // ---------------------------------------------------------------- spectrum
  // A cold object next to a star: below 3.8 um the light at its position is mostly the star's.
  const coldBlend = r.cold && r.neighbours.length > 0;
  const bins = coldBlend ? r.binned.filter((b) => b.wavelength >= 3.8) : r.binned;
  const det = bins.filter((b) => b.fluxErr > 0 && b.flux / b.fluxErr >= 3);
  if (bins.length > 0 && det.length === 0 && !r.relative) {
    out.push({ id: 'measure:spectrum', kind: 'spectrum', title: { key: 'measure.f.spec.none.title' }, body: [{ key: 'measure.f.spec.none.body', vars: { n: bins.length } }], confidence: 'medium' });
  } else if (det.length > 0) {
    const best = det.reduce((a, b) => (b.flux > a.flux ? b : a));
    const short = bins.filter((b) => b.wavelength < 3.8);
    const shortDet = det.filter((b) => b.wavelength < 3.8);
    const long = bins.filter((b) => b.wavelength >= 3.8);
    const longDet = det.filter((b) => b.wavelength >= 3.8);
    const longOnly = short.length >= 3 && shortDet.length <= 0.2 * short.length && long.length > 0 && longDet.length >= 0.5 * long.length;
    const body: FindingPart[] = [
      r.relative
        ? { key: 'measure.f.spec.bodyRel', vars: { wl: best.wavelength.toFixed(2), n: det.length } }
        : { key: 'measure.f.spec.body', vars: { wl: best.wavelength.toFixed(2), n: det.length, wmin: det[0].wavelength.toFixed(2), wmax: det[det.length - 1].wavelength.toFixed(2) } },
    ];
    if (longOnly) body.push({ key: 'measure.f.spec.long' });
    if (coldBlend) body.push({ key: 'measure.f.spec.blendShort' });
    out.push({ id: 'measure:spectrum', kind: 'spectrum', title: { key: 'measure.f.spec.title' }, body, confidence: r.relative || coldBlend ? 'low' : det.length >= 10 ? 'high' : 'medium' });
  }

  // ---------------------------------------------------------------- notes
  if (r.relative) {
    out.push({ id: 'measure:saturated', kind: 'note', title: { key: 'measure.f.sat.title' }, body: [{ key: 'measure.f.sat.body', vars: { n: r.saturatedCount, m: r.points.length } }], confidence: 'high' });
  }
  if (r.cold) {
    out.push({ id: 'measure:cold', kind: 'note', title: { key: 'measure.f.cold.title' }, body: [{ key: 'measure.f.cold.body' }], confidence: 'high' });
  }
  if (r.neighbours.length) {
    const nb = r.neighbours[0];
    out.push({
      id: 'measure:blend',
      kind: 'note',
      title: { key: 'measure.f.blend.title' },
      body: [{ key: 'measure.f.blend.body', vars: { mag: nb.mag !== undefined ? `G ${nb.mag.toFixed(1)}` : nb.id, sep: nb.sepArcsec.toFixed(1), date: nb.date } }],
      confidence: 'high',
    });
  }
  const goodVisits = new Set(r.points.filter((p) => p.good && p.visit !== undefined).map((p) => p.visit)).size;
  if (goodVisits < 2 || nGood < 6) {
    out.push({ id: 'measure:few', kind: 'note', title: { key: 'measure.f.few.title' }, body: [{ key: 'measure.f.few.body', vars: { n: goodVisits } }], confidence: 'high' });
  }
  return out;
}
