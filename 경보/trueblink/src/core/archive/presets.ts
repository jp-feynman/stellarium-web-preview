// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The five challenge targets plus three comparison fields. Astrometry comes from our research table
// (research_notes/data/targets.json, Gaia DR3 or SIMBAD, positions given at epoch J2000.0) and was
// checked against CDS Sesame on 2026-11-14: Barnard's Star, eps Ind B, WISE 0855-0714 and R Dra agree
// to better than 0.02 arcsec and 0.001 mas/yr; for RW Aur Sesame still returns the Hipparcos-era
// solution (1.4 arcsec away, pm 7.2/-20.3 mas/yr), so we keep the Gaia DR3 values of RW Aur A.

import type { SkyPos, TargetInfo } from '../types';

export interface PresetTarget extends TargetInfo {
  /** True for the five targets named by the challenge. */
  challenge: boolean;
  /** One plain-language sentence for the Explore mode. */
  blurb: string;
  /** Name that CDS Sesame resolves for this object (absent for plain sky fields). */
  sesameName?: string;
  /** Position quoted in the challenge brief, when it differs from the object's real position. */
  briefPos?: SkyPos;
  /** True when the field lies in a SPHEREx deep field (spherex_*_deep collections cover it). */
  deepField?: boolean;
}

export const PRESETS: PresetTarget[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    ra: 269.45207342777144,
    dec: 4.6934104643651775,
    epoch: 2000.0,
    pmRa: -801.551,
    pmDec: 10362.3942,
    parallax: 546.9759,
    objectType: 'BY* (variable star of BY Dra type)',
    spectralType: 'M4V',
    mags: { J: 5.244, H: 4.83, K: 4.524, W1: 4.358, W2: 3.658 },
    aliases: ["Barnard's Star", 'Barnards Star', 'Barnard', 'GJ 699', 'Gliese 699', 'V2500 Oph', 'Gaia DR3 4472832130942575872'],
    challenge: true,
    blurb: 'The star with the largest proper motion on the sky: it crosses about 10 arcseconds a year, so it visibly shifts between SPHEREx visits.',
    sesameName: "Barnard's Star",
  },
  {
    id: 'epsIndB',
    name: 'Epsilon Indi B (Ba+Bb)',
    ra: 331.04415237031895,
    dec: -56.78284615935495,
    epoch: 2000.0,
    pmRa: 3981.977,
    pmDec: -2466.832,
    parallax: 270.658,
    objectType: 'BD* (brown dwarf binary)',
    spectralType: 'T1V+T6V',
    mags: { J: 11.908, H: 11.306, K: 11.208, W1: 10.718, W2: 9.492 },
    aliases: ['Epsilon Indi B', 'eps Ind B', 'eps Indi B', 'Eps Indi Ba', 'Epsilon Indi Ba', 'Epsilon Indi Bb', 'Gaia DR3 6412596012146801152'],
    challenge: true,
    blurb: 'A pair of nearby brown dwarfs moving about 4.7 arcseconds a year; the bright star Epsilon Indi A sits 6.7 arcminutes away.',
    sesameName: 'eps Ind B',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    ra: 133.81890824537345,
    dec: -7.247047999619669,
    epoch: 2000.0,
    pmRa: -8123.7,
    pmDec: 673.2,
    parallax: 439.0,
    objectType: 'BD* (brown dwarf)',
    spectralType: 'Y2',
    mags: { J: 25.0, H: 23.83, W1: 16.231, W2: 13.704 },
    aliases: ['WISE 0855-0714', 'WISE 0855', 'WISE J0855-0714', 'WISE J085510.83-071442.5', 'WISEA J085510.74-071442.5'],
    challenge: true,
    blurb: 'The coldest brown dwarf known. It is faint except at the longest SPHEREx wavelengths and moves 8 arcseconds a year, so the position in the challenge brief is now 2 arcminutes off.',
    sesameName: 'WISE J085510.83-071442.5',
    briefPos: { ra: 133.795129, dec: -7.245147 },
  },
  {
    id: 'rwaur',
    name: 'RW Aurigae',
    ra: 76.95606758652298,
    dec: 30.401326358161402,
    epoch: 2000.0,
    pmRa: 2.641,
    pmDec: -27.398,
    parallax: 6.4062,
    objectType: 'TT* (T Tauri star)',
    spectralType: 'K1/5e+K5e',
    mags: { J: 8.378, H: 7.621, K: 7.02, W1: 6.246, W2: 5.228 },
    aliases: ['RW Aurigae', 'RW Aur', 'RW Aur A', 'Gaia DR3 156430822114424576'],
    challenge: true,
    blurb: 'A young star still wrapped in dust; its brightness changes by several magnitudes as clouds of dust pass in front of it.',
    sesameName: 'RW Aur',
  },
  {
    id: 'rdra',
    name: 'R Draconis',
    ra: 248.16761083441128,
    dec: 66.75497941649003,
    epoch: 2000.0,
    pmRa: -20.643,
    pmDec: 6.149,
    parallax: 1.2509,
    objectType: 'Mi* (Mira variable)',
    spectralType: 'M4.5-6+e',
    mags: { J: 3.863, H: 3.125, K: 2.438, W1: 0.393, W2: 0.129 },
    aliases: ['R Draconis', 'R Dra', 'Gaia DR3 1648328016354496384'],
    challenge: true,
    blurb: 'A pulsating red giant that brightens and fades every 246 days. It lies near the north ecliptic pole, where SPHEREx looks almost every day.',
    sesameName: 'R Dra',
    deepField: true,
  },
  {
    id: 'nep',
    name: 'North ecliptic pole deep field',
    ra: 270.0,
    dec: 66.5607,
    epoch: 2000.0,
    pmRa: 0,
    pmDec: 0,
    parallax: 0,
    objectType: 'Sky field',
    aliases: ['NEP', 'North ecliptic pole', 'SPHEREx north deep field'],
    challenge: false,
    blurb: 'The centre of the SPHEREx northern deep field, imaged on every day of the survey: the best place to see faint changes build up.',
    deepField: true,
  },
  {
    id: 'ecliptic',
    name: 'Ecliptic field: (24) Themis passage',
    ra: 249.8816,
    dec: -22.3683,
    epoch: 2000.0,
    pmRa: 0,
    pmDec: 0,
    parallax: 0,
    objectType: 'Sky field',
    aliases: ['Themis field', 'Ecliptic field'],
    challenge: false,
    blurb: 'A patch of the ecliptic where the main-belt asteroid (24) Themis passed on 2026-02-27: asteroids move many pixels within one visit.',
  },
  {
    id: 'coma',
    name: 'Coma cluster (NGC 4889)',
    ra: 195.0338,
    dec: 27.977,
    epoch: 2000.0,
    pmRa: 0,
    pmDec: 0,
    parallax: 0,
    objectType: 'Sky field (galaxy cluster)',
    aliases: ['Coma cluster', 'NGC 4889', 'Abell 1656'],
    challenge: false,
    blurb: 'Distant galaxies far from the Milky Way plane: almost nothing here should move or change, which makes it a good control field.',
  },
];

/** Look a preset up by id or by any alias (case and punctuation insensitive). */
export function findPreset(idOrName: string): PresetTarget | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9+-]/g, '');
  const q = norm(idOrName);
  if (!q) return undefined;
  return PRESETS.find((p) => norm(p.id) === q || norm(p.name) === q || (p.aliases ?? []).some((a) => norm(a) === q));
}
