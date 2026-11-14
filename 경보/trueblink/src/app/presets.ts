// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The five challenge targets and their guided missions. Positions are Gaia/SIMBAD values propagated
// to epoch 2025.5 (tests/fixtures/targets.json); proper motions in mas/yr with pmRa including cos(dec).
import type { TargetInfo } from '../core/types';
import type { SequenceKind } from './store';

export type PresetId = 'barnard' | 'epsIndB' | 'wise0855' | 'rwaur' | 'rdra';

export interface MissionStep {
  /** i18n key of the step text. */
  key: string;
  sequence: SequenceKind;
  band: string;
  zoom: number;
}

export interface Preset {
  id: PresetId;
  target: TargetInfo;
  /** Mission steps; story / look / tag / name strings are i18n keys `mission.<id>.*`. */
  steps: [MissionStep, MissionStep, MissionStep, ...MissionStep[]];
  /** Step whose view (sequence, band group, zoom) a fresh visit opens on: the one that shows the point. */
  defaultStep?: 0 | 1 | 2 | 3;
}

/** The view a challenge target opens on without any clicks. */
export function defaultView(p: Preset): MissionStep {
  return p.steps[p.defaultStep ?? 0];
}

const step = (id: PresetId, n: number, sequence: SequenceKind, band: string, zoom: number): MissionStep => ({
  key: `mission.${id}.step${n}`,
  sequence,
  band,
  zoom,
});

export const PRESETS: Preset[] = [
  {
    id: 'barnard',
    target: {
      id: 'barnard',
      name: "Barnard's Star",
      ra: 269.4463787329022,
      dec: 4.766781321976461,
      epoch: 2025.5,
      pmRa: -801.551,
      pmDec: 10362.3942,
      parallax: 546.9759,
      objectType: 'Red dwarf (high proper motion)',
      spectralType: 'M4V',
      mags: { J: 5.244, H: 4.83, K: 4.524 },
      aliases: ["Barnard's Star", 'Barnards Star', 'Barnard', 'GJ 699', 'Gliese 699'],
    },
    steps: [step('barnard', 1, 'epochs', 'all', 1), step('barnard', 2, 'epochs', 'all', 3), step('barnard', 3, 'difference', 'mwir', 3)],
  },
  {
    id: 'epsIndB',
    target: {
      id: 'epsIndB',
      name: 'Epsilon Indi B',
      ra: 331.09564527281225,
      dec: -56.800320982728,
      epoch: 2025.5,
      pmRa: 3981.977,
      pmDec: -2466.832,
      parallax: 270.658,
      objectType: 'Binary brown dwarf (T1 + T6)',
      aliases: ['Epsilon Indi B', 'Epsilon Indi Ba', 'eps Ind B', 'eps Indi B', 'Eps Indi B'],
    },
    steps: [step('epsIndB', 1, 'epochs', 'all', 1), step('epsIndB', 2, 'epochs', 'all', 3), step('epsIndB', 3, 'difference', 'all', 3)],
  },
  {
    id: 'wise0855',
    target: {
      id: 'wise0855',
      name: 'WISE 0855-0714',
      ra: 133.76090261783116,
      dec: -7.242275827585608,
      epoch: 2025.5,
      pmRa: -8123.7,
      pmDec: 673.2,
      parallax: 439.0,
      objectType: 'Brown dwarf (Y type, about 250-285 K)',
      aliases: ['WISE 0855-0714', 'WISE 0855', 'WISE J085510.83-071442.5', 'WISEA J085510.74-071442.5'],
    },
    steps: [
      step('wise0855', 1, 'epochs', 'all', 1),
      step('wise0855', 2, 'epochs', 'cold', 2),
      step('wise0855', 3, 'coldFilter', 'cold', 2),
      step('wise0855', 4, 'thenNow', 'cold', 3),
    ],
    // A Y dwarf only shows at 3.8-5.0 um: open on the cold arrays.
    defaultStep: 1,
  },
  {
    id: 'rwaur',
    target: {
      id: 'rwaur',
      name: 'RW Aurigae',
      ra: 76.95608927584374,
      dec: 30.40113228887002,
      epoch: 2025.5,
      pmRa: 2.641,
      pmDec: -27.398,
      parallax: 6.4062,
      objectType: 'Young variable star (T Tauri)',
      aliases: ['RW Aurigae', 'RW Aur'],
    },
    steps: [step('rwaur', 1, 'epochs', 'all', 1), step('rwaur', 2, 'pairs', 'all', 2), step('rwaur', 3, 'thenNow', 'all', 2)],
  },
  {
    id: 'rdra',
    target: {
      id: 'rdra',
      name: 'R Draconis',
      ra: 248.16724033904336,
      dec: 66.75502297196961,
      epoch: 2025.5,
      pmRa: -20.643,
      pmDec: 6.149,
      parallax: 1.2509,
      objectType: 'Mira variable (period about 245 days)',
      aliases: ['R Draconis', 'R Dra'],
    },
    steps: [step('rdra', 1, 'sweep', 'all', 1), step('rdra', 2, 'epochs', 'd3', 1), step('rdra', 3, 'difference', 'd3', 2)],
    // Open on the dates (the pulsation); the colour-sweep lesson stays one click away as step 1.
    defaultStep: 1,
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find a preset by id, name or alias (case, spaces and punctuation ignored). */
export function findPreset(nameOrId: string): Preset | null {
  const q = norm(nameOrId);
  if (!q) return null;
  return PRESETS.find((p) => norm(p.id) === q || norm(p.target.name) === q || (p.target.aliases ?? []).some((a) => norm(a) === q)) ?? null;
}

export function presetForTarget(t: TargetInfo | null): Preset | null {
  if (!t) return null;
  return PRESETS.find((p) => p.id === t.id) ?? findPreset(t.name);
}
