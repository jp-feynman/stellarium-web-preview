// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Asteroid taxonomy from a SPHEREx reflectance spectrum. Bus and DeMeo (2009) sorted 371 asteroids into
// 24 classes by the shape of their 0.45-2.45 um reflectance; the 1 um and 2 um absorption bands of the
// minerals olivine and pyroxene are what separate most classes. SPHEREx bands 1-3 only see 0.75-2.4 um,
// which is the paper's "near-infrared only" case: the S-complex is recognisable only as a group and C- and
// X-complex classes cannot be told apart at all. So we compare the spectrum with every class mean, but
// only ever report one of six broad groups (or O / R when they win clearly), never a sub-class.
//
// Method: resample each class mean to the data wavelengths (0.85-2.45 um), give it one free scale factor
// per SPHEREx detector band (D1 < 1.11 um, D2 1.11-1.64 um, D3 > 1.64 um; this absorbs calibration
// offsets and rotation between visits) and compute chi-square with the measurement errors.

import classMeansJson from '../../../public/data/busdemeo_class_means.json';

interface ClassMeans {
  wave_um: number[];
  classes: Record<string, { complex: string; mean: number[] }>;
}

const MEANS = classMeansJson as unknown as ClassMeans;

/** Bus-DeMeo class -> reported group. Xn (added later by the SMASS site, not in the 2009 paper) is not used. */
export const BUS_DEMEO_GROUPS: Readonly<Record<string, string>> = {
  S: 'S-like', Sa: 'S-like', Sq: 'S-like', Sr: 'S-like', Sv: 'S-like', Q: 'S-like',
  V: 'V',
  A: 'A',
  B: 'C/X-like', C: 'C/X-like', Cb: 'C/X-like', Cg: 'C/X-like', Cgh: 'C/X-like', Ch: 'C/X-like',
  X: 'C/X-like', Xc: 'C/X-like', Xe: 'C/X-like', Xk: 'C/X-like', T: 'C/X-like',
  D: 'D',
  K: 'K/L', L: 'K/L',
  O: 'O',
  R: 'R',
};

/** Thresholds of the refusal gates. */
export const TAXONOMY_LIMITS = {
  minWavelength: 0.85,
  maxWavelength: 2.45,
  d1Max: 1.11,
  d2Max: 1.64,
  minPoints: 12,
  minPointsD1: 5,
  minMedianSnr: 10,
  maxReducedChi2: 2,
  minGap: 9,
} as const;

function interpTemplate(mean: number[], wl: number): number {
  const w = MEANS.wave_um;
  if (wl < w[0] || wl > w[w.length - 1]) return NaN;
  let i = 0;
  while (i < w.length - 2 && w[i + 1] < wl) i++;
  const t = (wl - w[i]) / (w[i + 1] - w[i]);
  return mean[i] + t * (mean[i + 1] - mean[i]);
}

const bandOf = (wl: number) => (wl < TAXONOMY_LIMITS.d1Max ? 0 : wl <= TAXONOMY_LIMITS.d2Max ? 1 : 2);

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

export interface TaxonomyResult {
  /** Reported group ('S-like', 'V', 'A', 'C/X-like', 'D', 'K/L', 'O', 'R'), or '' when refused. */
  group: string;
  /** Total chi-square of the best template. */
  chi2: number;
  /** Chi-square of the best template of any other group minus the best chi-square. */
  gapToNext: number;
  /** Every class, best first. `cls` is for diagnostics only: never show it as the answer. */
  ranked: { group: string; cls: string; chi2: number }[];
  /** Plain-language reason when no group is named. */
  refused?: string;
}

/**
 * Classify a reflectance spectrum (any normalisation) into a broad Bus-DeMeo group by chi-square template
 * matching with one free scale per detector band. Points outside 0.85-2.45 um or without a finite value
 * and positive error are ignored.
 *
 * `opts.errorFloor` (fraction of the reflectance, default 0) is added in quadrature to each error. The
 * archive errors are formal and leave out rotation and calibration scatter of a few per cent; without a
 * floor real spectra usually fail the reduced chi-square gate.
 */
export function classifyBusDemeo(
  spec: { wavelength: number; reflectance: number; err: number }[],
  opts?: { errorFloor?: number },
): TaxonomyResult {
  const L = TAXONOMY_LIMITS;
  const floor = opts?.errorFloor ?? 0;
  const pts = spec
    .filter((p) => Number.isFinite(p.wavelength) && Number.isFinite(p.reflectance) && p.err > 0)
    .filter((p) => p.wavelength >= L.minWavelength && p.wavelength <= L.maxWavelength)
    .map((p) => ({ wl: p.wavelength, r: p.reflectance, s: Math.hypot(p.err, floor * p.reflectance), band: bandOf(p.wavelength) }));

  const ranked: TaxonomyResult['ranked'] = [];
  const bandsUsed = new Set(pts.map((p) => p.band)).size;
  if (pts.length > 0) {
    for (const [cls, group] of Object.entries(BUS_DEMEO_GROUPS)) {
      const mean = MEANS.classes[cls]?.mean;
      if (!mean) continue;
      const m = pts.map((p) => interpTemplate(mean, p.wl));
      // Best scale per band: s_b = sum(r m / sigma^2) / sum(m^2 / sigma^2).
      const num = [0, 0, 0];
      const den = [0, 0, 0];
      pts.forEach((p, i) => {
        num[p.band] += (p.r * m[i]) / (p.s * p.s);
        den[p.band] += (m[i] * m[i]) / (p.s * p.s);
      });
      let chi2 = 0;
      pts.forEach((p, i) => {
        const scale = den[p.band] > 0 ? num[p.band] / den[p.band] : 0;
        chi2 += ((p.r - scale * m[i]) / p.s) ** 2;
      });
      ranked.push({ group, cls, chi2 });
    }
    ranked.sort((a, b) => a.chi2 - b.chi2);
  }

  const best = ranked[0];
  const other = best ? ranked.find((r) => r.group !== best.group) : undefined;
  const chi2 = best ? best.chi2 : NaN;
  const gapToNext = best && other ? other.chi2 - best.chi2 : NaN;
  const refuse = (reason: string): TaxonomyResult => ({ group: '', chi2, gapToNext, ranked, refused: reason });

  const nD1 = pts.filter((p) => p.band === 0).length;
  if (pts.length < L.minPoints) {
    return refuse(`Too few points: ${pts.length} usable points between 0.85 and 2.45 um, at least ${L.minPoints} are needed.`);
  }
  if (nD1 < L.minPointsD1) {
    return refuse(`Too few points below 1.11 um (${nD1}, at least ${L.minPointsD1}): the 1 um absorption band is not covered.`);
  }
  const snr = median(pts.map((p) => p.r / p.s));
  if (!(snr >= L.minMedianSnr)) {
    return refuse(`Signal-to-noise too low: median ${snr.toFixed(1)} per point, at least ${L.minMedianSnr} is needed.`);
  }
  const dof = Math.max(pts.length - bandsUsed, 1);
  if (best.chi2 / dof > L.maxReducedChi2) {
    return refuse(
      `No class mean fits well: the best template (${best.group}) has reduced chi-square ${(best.chi2 / dof).toFixed(2)}, above ${L.maxReducedChi2}. ` +
        'The spectrum may be contaminated, or rotation and calibration scatter is larger than the stated errors.',
    );
  }
  if (!(gapToNext >= L.minGap)) {
    return refuse(
      `Ambiguous: ${best.group} and ${other?.group ?? 'another group'} fit almost equally well (chi-square gap ${gapToNext.toFixed(1)}, at least ${L.minGap} is needed).`,
    );
  }
  return { group: best.group, chi2, gapToNext, ranked };
}

const GROUP_TEXT: Record<string, string> = {
  'S-like':
    'This asteroid reflects light like stony asteroids made of the minerals olivine and pyroxene, the most common type in the inner asteroid belt. Its spectrum shows a dip near 1 micron from these silicate minerals, and many meteorites that fall on Earth come from bodies like this.',
  V: 'This asteroid looks like Vesta: its surface is basaltic rock, cooled lava rich in pyroxene, which makes deep dips near 1 and 2 microns. Such asteroids are chips of a world that once melted inside, and some meteorites found on Earth come from them.',
  A: 'This asteroid shows the very red colour and broad 1 micron dip of the mineral olivine. Olivine-rich asteroids are rare and may be pieces of the mantle of a broken-up, once-melted body.',
  'C/X-like':
    'This asteroid has a fairly flat, featureless spectrum, typical of dark carbon-rich asteroids and of the metal-or-rock X types. With infrared light alone these two families look the same; telling them apart needs visible colours or the reflectivity (albedo).',
  D: 'This asteroid is dark and very red without clear mineral bands, like the asteroids in the outer belt and among Jupiter\'s Trojans. Such bodies are thought to be rich in organic material and ices and to have formed far from the Sun.',
  'K/L':
    'This asteroid sits between the stony and the carbon-rich types, with only a shallow 1 micron dip. Some of these are linked to the meteorites that carry the oldest minerals of the solar system.',
  O: 'This spectrum matches the rare O type, which has a very broad and deep 1 micron dip. Only a handful of asteroids are known like it, so the match should be checked with other data.',
  R: 'This spectrum matches the rare R type, with strong 1 and 2 micron dips from olivine and pyroxene. Very few asteroids are known like it; the best-known one is (349) Dembowska.',
};

/** Two plain-language sentences about a group, for the public mode. Unknown or empty group: why there is no answer. */
export function describeGroup(group: string): string {
  return (
    GROUP_TEXT[group] ??
    'The data do not decide what kind of asteroid this is. More points, better signal or a cleaner spectrum would be needed before naming a type.'
  );
}
