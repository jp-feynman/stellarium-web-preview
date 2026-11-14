// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The app's single zustand store. Pipelines write data into it; components read from it.
import { create } from 'zustand';
import type { Exposure, Overlay, PhotPoint, SkyFrame, SkyPos, Stretch, TargetInfo, Visit } from '../core/types';
import { DEFAULT_FOV_ARCSEC, DEFAULT_SPEED_MS, MAX_FOV_ARCSEC, MAX_SPEED_MS, MIN_FOV_ARCSEC, MIN_SPEED_MS } from './config';

export type Lang = 'en' | 'ko';
export type UiMode = 'explore' | 'research';
export type EmbedMode = boolean | 'panel';
export type Phase = 'idle' | 'resolving' | 'searching' | 'loading' | 'ready' | 'error';
/**
 * epochs:     one frame per visit, every frame built from the same spectral channels (the honest blink)
 * pairs:      the same wavelength channel seen at each visit
 * sweep:      one visit stepped through wavelength (a colour movie, not a time movie)
 * difference: each visit minus the reference visit
 * thenNow:    first and last visit only
 * coldFilter: per visit, stack(4.2-4.8 um) minus a scaled stack(3.82-4.05 um): ordinary stars cancel,
 *             objects that shine only beyond 4.2 um (cold brown dwarfs) remain
 */
export type SequenceKind = 'epochs' | 'pairs' | 'sweep' | 'difference' | 'thenNow' | 'coldFilter';
export const SEQUENCES: SequenceKind[] = ['epochs', 'pairs', 'sweep', 'difference', 'thenNow', 'coldFilter'];

export interface Status {
  phase: Phase;
  message?: string;
  loaded: number;
  total: number;
  /** Exposures that cover the field but were left out by the per-field cap ("load more"). */
  remaining?: number;
}

/** A plain-language message shown under the status bar, optionally with one action button. */
export interface Notice {
  id: string;
  /** i18n key (or plain English text). */
  text: string;
  vars?: Record<string, string | number>;
  level?: 'info' | 'warn';
  action?: { label: string; vars?: Record<string, string | number>; run: () => void };
}

/** What the main viewer area shows. */
export type ViewKind = 'blink' | 'cube' | 'sky';

export interface Finding {
  id: string;
  kind: 'motion' | 'brightness' | 'spectrum' | 'note';
  title: string;
  body: string;
  /** Our measurement, already formatted for display, e.g. "10.7 ± 0.6 arcsec/yr". */
  value?: string;
  /** The catalogue / literature value it is compared with, e.g. "10.39 arcsec/yr (Gaia DR3)". */
  reference?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface OverlayToggles {
  gaia: boolean;
  track: boolean;
  flags: boolean;
  solarSystem: boolean;
}

export interface AppState {
  lang: Lang;
  uiMode: UiMode;
  /** Text in the search box. */
  query: string;
  /** Display-only name supplied by the planetarium; never used for name resolution. */
  sourceLabel: string;
  target: TargetInfo | null;
  center: SkyPos | null;
  fovArcsec: number;
  status: Status;
  exposures: Exposure[];
  visits: Visit[];
  /** The current sequence, in display order. All frames share one SkyGrid. */
  frames: SkyFrame[];
  frameIndex: number;
  playing: boolean;
  speedMs: number;
  sequence: SequenceKind;
  bandGroupId: string;
  /** Use only the spectral channels present in every visit (like with like). */
  balanced: boolean;
  /** Visit index used as the reference for difference images (null = first visit). */
  referenceVisit: number | null;
  stretch: Stretch;
  overlaysOn: OverlayToggles;
  /** All overlays. Ids are prefixed by layer: "gaia:", "track:", "flags:", "sso:" (anything else is always shown). */
  overlays: Overlay[];
  picked: { ra: number; dec: number } | null;
  spectrum: PhotPoint[];
  findings: Finding[];
  warnings: string[];
  /** Viewer zoom factor (1 = whole field). */
  zoom: number;
  /** True while showing synthetic demo data instead of the archive. */
  demo: boolean;
  /** embed=1 is a minimal viewer; embed=panel retains all analysis controls. */
  embed: EmbedMode;
  aboutOpen: boolean;
  researchTab: string;
  notices: Notice[];
  view: ViewKind;
}

export interface AppActions {
  setLang(lang: Lang): void;
  setUiMode(mode: UiMode): void;
  setQuery(q: string): void;
  setSourceLabel(label: string): void;
  setTarget(t: TargetInfo | null): void;
  setCenter(p: SkyPos | null): void;
  setFov(arcsec: number): void;
  setStatus(s: Partial<Status>): void;
  setExposures(e: Exposure[]): void;
  setVisits(v: Visit[]): void;
  /** Replace the sequence; keeps the frame index when still valid. */
  setFrames(f: SkyFrame[]): void;
  selectFrame(i: number): void;
  stepFrame(delta: number): void;
  setPlaying(p: boolean): void;
  togglePlay(): void;
  setSpeed(ms: number): void;
  setSequence(s: SequenceKind): void;
  setBandGroup(id: string): void;
  setBalanced(b: boolean): void;
  setReferenceVisit(v: number | null): void;
  setStretch(s: Partial<Stretch>): void;
  setOverlayOn(layer: keyof OverlayToggles, on: boolean): void;
  setOverlays(o: Overlay[]): void;
  pick(p: { ra: number; dec: number } | null): void;
  setSpectrum(p: PhotPoint[]): void;
  setFindings(f: Finding[]): void;
  setWarnings(w: string[]): void;
  setZoom(z: number): void;
  setDemo(d: boolean): void;
  setEmbed(e: EmbedMode): void;
  setAboutOpen(o: boolean): void;
  setResearchTab(id: string): void;
  /** Add or replace (by id) a notice. */
  addNotice(n: Notice): void;
  removeNotice(id: string): void;
  setView(v: ViewKind): void;
  /** Forget the current target and data (keeps language, mode, speed and layout). */
  reset(): void;
}

export type AppStore = AppState & AppActions;

export const DEFAULT_STRETCH: Stretch = { lo: -0.05, hi: 5, mode: 'asinh', q: 8, invert: false, colormap: 'gray' };

const LANG_KEY = 'trueblink.lang';

/** Language from localStorage (the URL is applied later and wins). */
export function readStoredLang(): Lang {
  try {
    const v = (typeof window === 'undefined' ? null : window.localStorage.getItem(LANG_KEY));
    if (v === 'en' || v === 'ko') return v;
  } catch {
    /* storage blocked: fall back to English */
  }
  return 'en';
}

function storeLang(lang: Lang): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function dataDefaults(): Pick<
  AppState,
  'target' | 'center' | 'sourceLabel' | 'status' | 'exposures' | 'visits' | 'frames' | 'frameIndex' | 'playing' | 'overlays' | 'picked' | 'spectrum' | 'findings' | 'warnings' | 'referenceVisit' | 'notices'
> {
  return {
    target: null,
    center: null,
    sourceLabel: '',
    status: { phase: 'idle', loaded: 0, total: 0 },
    exposures: [],
    visits: [],
    frames: [],
    frameIndex: 0,
    playing: false,
    overlays: [],
    picked: null,
    spectrum: [],
    findings: [],
    warnings: [],
    referenceVisit: null,
    notices: [],
  };
}

export const useApp = create<AppStore>()((set, get) => ({
  lang: readStoredLang(),
  uiMode: 'explore',
  query: '',
  fovArcsec: DEFAULT_FOV_ARCSEC,
  speedMs: DEFAULT_SPEED_MS,
  sequence: 'epochs',
  bandGroupId: 'all',
  balanced: true,
  stretch: { ...DEFAULT_STRETCH },
  overlaysOn: { gaia: false, track: false, flags: false, solarSystem: false },
  zoom: 1,
  demo: false,
  embed: false,
  aboutOpen: false,
  researchTab: 'frames',
  view: 'blink',
  ...dataDefaults(),

  setLang: (lang) => {
    storeLang(lang);
    set({ lang });
  },
  setUiMode: (uiMode) => set({ uiMode }),
  setQuery: (query) => set({ query }),
  setSourceLabel: (sourceLabel) => set({ sourceLabel: sourceLabel.trim().slice(0, 120) }),
  setTarget: (target) => set({ target }),
  setCenter: (center) => set({ center }),
  setFov: (arcsec) => set({ fovArcsec: clamp(Math.round(arcsec), MIN_FOV_ARCSEC, MAX_FOV_ARCSEC) }),
  setStatus: (s) => set({ status: { ...get().status, ...s } }),
  setExposures: (exposures) => set({ exposures }),
  setVisits: (visits) => set({ visits }),
  setFrames: (frames) => {
    const i = get().frameIndex;
    set({ frames, frameIndex: i < frames.length ? i : 0 });
  },
  selectFrame: (i) => {
    const n = get().frames.length;
    if (n === 0) return;
    set({ frameIndex: clamp(Math.round(i), 0, n - 1) });
  },
  stepFrame: (delta) => {
    const n = get().frames.length;
    if (n === 0) return;
    set({ frameIndex: (((get().frameIndex + delta) % n) + n) % n });
  },
  setPlaying: (playing) => set({ playing: playing && get().frames.length > 1 }),
  togglePlay: () => set({ playing: !get().playing && get().frames.length > 1 }),
  setSpeed: (ms) => set({ speedMs: clamp(Math.round(ms), MIN_SPEED_MS, MAX_SPEED_MS) }),
  setSequence: (sequence) => set({ sequence, frameIndex: 0 }),
  setBandGroup: (bandGroupId) => set({ bandGroupId, frameIndex: 0 }),
  setBalanced: (balanced) => set({ balanced }),
  setReferenceVisit: (referenceVisit) => set({ referenceVisit }),
  setStretch: (s) => set({ stretch: { ...get().stretch, ...s } }),
  setOverlayOn: (layer, on) => set({ overlaysOn: { ...get().overlaysOn, [layer]: on } }),
  setOverlays: (overlays) => set({ overlays }),
  pick: (picked) => set({ picked }),
  setSpectrum: (spectrum) => set({ spectrum }),
  setFindings: (findings) => set({ findings }),
  setWarnings: (warnings) => set({ warnings }),
  setZoom: (z) => set({ zoom: clamp(z, 1, 16) }),
  setDemo: (demo) => set({ demo }),
  setEmbed: (embed) => set({ embed }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setResearchTab: (researchTab) => set({ researchTab }),
  addNotice: (n) => set({ notices: [...get().notices.filter((o) => o.id !== n.id), n] }),
  removeNotice: (id) => set({ notices: get().notices.filter((o) => o.id !== id) }),
  setView: (view) => set({ view }),
  reset: () => set({ ...dataDefaults(), query: '', zoom: 1 }),
}));

/** Overlays visible under the current toggles. */
export function visibleOverlays(overlays: Overlay[], on: OverlayToggles): Overlay[] {
  return overlays.filter((o) => {
    const layer = o.id.split(':')[0];
    if (layer === 'gaia') return on.gaia;
    if (layer === 'track') return on.track;
    if (layer === 'flags') return on.flags;
    if (layer === 'sso') return on.solarSystem;
    return true;
  });
}
