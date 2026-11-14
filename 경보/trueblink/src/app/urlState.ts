// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// The view lives in the URL hash so any view can be shared or embedded:
//   #ra=..&dec=..&fov=..&name=..&seq=..&band=..&mode=explore|research&lang=en|ko&embed=1&frame=..&speed=..
// encodeHash / decodeHash are pure (unit-tested); startUrlSync wires them to the store and the browser.
import { BAND_GROUPS } from '../core/types';
import { MAX_FOV_ARCSEC, MAX_SPEED_MS, MIN_FOV_ARCSEC, MIN_SPEED_MS } from './config';
import { SEQUENCES, useApp, type AppState, type EmbedMode, type Lang, type SequenceKind, type UiMode } from './store';

export interface UrlState {
  ra?: number;
  dec?: number;
  fov?: number;
  name?: string;
  /** Display only; coordinates remain the search target. */
  label?: string;
  seq?: SequenceKind;
  band?: string;
  mode?: UiMode;
  lang?: Lang;
  embed?: EmbedMode;
  frame?: number;
  speed?: number;
  /** Synthetic DEMO data instead of the archive (#mock=1). */
  mock?: boolean;
}

const KEY_ORDER: (keyof UrlState)[] = ['name', 'ra', 'dec', 'label', 'fov', 'seq', 'band', 'mode', 'lang', 'frame', 'speed', 'embed', 'mock'];

function num(s: string | null): number | undefined {
  if (s === null || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** Trim a number to at most `digits` decimals without trailing zeros. */
function fmt(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

/** Parse a location hash (with or without the leading '#'). Invalid or out-of-range values are dropped. */
export function decodeHash(hash: string): UrlState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: UrlState = {};
  const ra = num(p.get('ra'));
  const dec = num(p.get('dec'));
  // Coordinates only make sense as a pair.
  if (ra !== undefined && dec !== undefined && dec >= -90 && dec <= 90) {
    out.ra = ((ra % 360) + 360) % 360;
    out.dec = dec;
  }
  const fov = num(p.get('fov'));
  if (fov !== undefined && fov >= MIN_FOV_ARCSEC && fov <= MAX_FOV_ARCSEC) out.fov = Math.round(fov);
  const name = p.get('name');
  if (name && name.trim()) out.name = name.trim().slice(0, 120);
  const label = p.get('label');
  if (label && label.trim()) out.label = label.trim().slice(0, 120);
  const seq = p.get('seq');
  if (seq && (SEQUENCES as string[]).includes(seq)) out.seq = seq as SequenceKind;
  const band = p.get('band');
  if (band && BAND_GROUPS.some((g) => g.id === band)) out.band = band;
  const mode = p.get('mode');
  if (mode === 'explore' || mode === 'research') out.mode = mode;
  const lang = p.get('lang');
  if (lang === 'en' || lang === 'ko') out.lang = lang;
  if (p.get('embed') === '1' || p.get('embed') === 'true') out.embed = true;
  else if (p.get('embed') === 'panel') out.embed = 'panel';
  if (p.get('mock') === '1' || p.get('mock') === 'true') out.mock = true;
  const frame = num(p.get('frame'));
  if (frame !== undefined && frame >= 0 && Number.isInteger(frame)) out.frame = frame;
  const speed = num(p.get('speed'));
  if (speed !== undefined && speed >= MIN_SPEED_MS && speed <= MAX_SPEED_MS) out.speed = Math.round(speed);
  return out;
}

/** Build a hash string (starting with '#', or '' when empty). Keys come out in a stable order. */
export function encodeHash(s: UrlState): string {
  const p = new URLSearchParams();
  for (const k of KEY_ORDER) {
    const v = s[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'ra' || k === 'dec') {
      if (s.ra === undefined || s.dec === undefined) continue;
      p.set(k, fmt(v as number, 6));
    } else if (k === 'embed' && v === 'panel') {
      p.set(k, 'panel');
    } else if (k === 'embed' || k === 'mock') {
      p.set(k, '1');
    } else if (typeof v === 'number') {
      p.set(k, fmt(v, 0));
    } else {
      p.set(k, String(v));
    }
  }
  const q = p.toString();
  return q ? `#${q}` : '';
}

/** The URL-worthy part of the app state. Defaults are left out to keep links short. */
export function urlStateFromApp(
  s: Pick<AppState, 'target' | 'center' | 'fovArcsec' | 'sequence' | 'bandGroupId' | 'uiMode' | 'lang' | 'embed' | 'frameIndex' | 'speedMs'> & { demo?: boolean; sourceLabel?: string },
): UrlState {
  const out: UrlState = {};
  if (s.target) out.name = s.target.name;
  if (s.sourceLabel) out.label = s.sourceLabel;
  if (s.center) {
    out.ra = s.center.ra;
    out.dec = s.center.dec;
  }
  if (s.fovArcsec !== 180) out.fov = s.fovArcsec;
  if (s.sequence !== 'epochs') out.seq = s.sequence;
  if (s.bandGroupId !== 'all') out.band = s.bandGroupId;
  if (s.uiMode !== 'explore') out.mode = s.uiMode;
  if (s.lang !== 'en') out.lang = s.lang;
  if (s.embed) out.embed = s.embed;
  if (s.frameIndex > 0) out.frame = s.frameIndex;
  if (s.speedMs !== 600) out.speed = s.speedMs;
  if (s.demo) out.mock = true;
  return out;
}

/** Apply the view settings of a decoded hash to the store (not the target: the caller opens it). */
export function applyUrlState(u: UrlState): void {
  const st = useApp.getState();
  if (u.lang) st.setLang(u.lang);
  if (u.mode) st.setUiMode(u.mode);
  if (u.fov) st.setFov(u.fov);
  if (u.seq) st.setSequence(u.seq);
  if (u.band) st.setBandGroup(u.band);
  if (u.speed) st.setSpeed(u.speed);
  st.setEmbed(u.embed ?? false);
}

/**
 * Keep the hash in sync with the store (debounced, replaceState so the back button is not flooded).
 * Returns a function that stops syncing.
 */
export function startUrlSync(debounceMs = 300): () => void {
  if (typeof window === 'undefined') return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = window.location.hash;
  const write = () => {
    const h = encodeHash(urlStateFromApp(useApp.getState()));
    if (h === last) return;
    last = h;
    const url = `${window.location.pathname}${window.location.search}${h}`;
    window.history.replaceState(window.history.state, '', url);
  };
  const unsub = useApp.subscribe((s, prev) => {
    // Playing advances frameIndex many times a second; only write it once the blink stops.
    if (s.playing && s.frameIndex !== prev.frameIndex && s.target === prev.target) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
