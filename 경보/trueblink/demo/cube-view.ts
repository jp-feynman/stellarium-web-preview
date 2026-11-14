// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Demo of CubeView with a synthetic sky. Like SPHEREx, every exposure has its own wavelength, so even
// fixed stars change brightness from slice to slice in time order (their colour, not real change).

import { CubeView, type CubeViewPreset } from '../src/gl/CubeView';
import type { SkyFrame, SkyGrid, Stretch } from '../src/core/types';
import { DETECTOR_BANDS, mjdToIsoDate } from '../src/core/types';
import { gridPixToSky, tanDeproject, skyToGridPix } from '../src/core/wcs';

const grid: SkyGrid = { ra0: 133.786, dec0: -7.245, n: 61, scaleArcsec: 6.15 };
const n = grid.n;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261004);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

function detectorOf(wl: number): number {
  for (const [d, b] of Object.entries(DETECTOR_BANDS)) if (wl >= b.min && wl <= b.max) return Number(d);
  return 6;
}

interface Star {
  i: number;
  j: number;
  flux: number;
  slope: number;
}

const stars: Star[] = [];
for (let k = 0; k < 22; k++) {
  stars.push({ i: 4 + rand() * (n - 8), j: 4 + rand() * (n - 8), flux: 0.6 + 5 * rand() ** 2, slope: -0.4 - 0.8 * rand() });
}
// Orientation check star, 2 arcmin east and 2 arcmin north of centre: must appear upper LEFT from the front.
const [neRa, neDec] = tanDeproject(grid.ra0, grid.dec0, 120, 120);
const [neI, neJ] = skyToGridPix(grid, neRa, neDec);
stars.push({ i: neI, j: neJ, flux: 7, slope: -0.3 });

const VISITS = [60800, 60983, 61166];
const PER_VISIT = 12;
const SIGMA_PSF = 0.95;
const NOISE = 0.04;

// The variable (a Mira-like star) and the mover (cold, so brightest at long wavelengths).
const variable = { i: 47, j: 47, fluxByVisit: [1.0, 4.5, 0.35], slope: -0.5 };
function moverPix(visit: number, dayInVisit: number): [number, number] {
  return [14 + 12 * visit + 0.3 * dayInVisit, 40 - 9 * visit - 0.25 * dayInVisit];
}
function moverFlux(wl: number): number {
  const x = Math.min(1, Math.max(0, (wl - 1.6) / 2.2));
  return 0.35 + 4.5 * x * x * (3 - 2 * x);
}

function addPsf(img: Float32Array, ci: number, cj: number, flux: number): void {
  const r = Math.ceil(4 * SIGMA_PSF);
  for (let j = Math.max(0, Math.floor(cj) - r); j <= Math.min(n - 1, Math.ceil(cj) + r); j++) {
    for (let i = Math.max(0, Math.floor(ci) - r); i <= Math.min(n - 1, Math.ceil(ci) + r); i++) {
      const d2 = (i - ci) ** 2 + (j - cj) ** 2;
      img[j * n + i] += flux * Math.exp(-d2 / (2 * SIGMA_PSF * SIGMA_PSF));
    }
  }
}

const frames: SkyFrame[] = [];
const moverPath: [number, number, number][] = [];
VISITS.forEach((t0, v) => {
  for (let k = 0; k < PER_VISIT; k++) {
    const day = k * 0.9;
    const mjd = t0 + day;
    // Linear variable filter: the wavelength at this position differs in every exposure.
    const step = (k * 5 + v * 2) % PER_VISIT;
    const wl = 0.75 * (5.0 / 0.75) ** (step / (PER_VISIT - 1));
    const img = new Float32Array(n * n);
    for (let p = 0; p < img.length; p++) img[p] = NOISE * gauss();
    for (const s of stars) addPsf(img, s.i, s.j, s.flux * (wl / 1.5) ** s.slope);
    addPsf(img, variable.i, variable.j, variable.fluxByVisit[v] * (wl / 1.5) ** variable.slope);
    const [mi, mj] = moverPix(v, day);
    addPsf(img, mi, mj, moverFlux(wl));
    const [mra, mdec] = gridPixToSky(grid, mi, mj);
    moverPath.push([mra, mdec, mjd]);
    // No-data regions: a detector edge in the first exposures of visit 2, and scattered bad pixels.
    if (v === 1 && k < 3) for (let j = 0; j < n; j++) for (let i = 0; i < 7; i++) img[j * n + i] = NaN;
    for (let b = 0; b < 6; b++) img[Math.floor(rand() * img.length)] = NaN;
    const det = detectorOf(wl);
    frames.push({
      grid,
      data: img,
      meta: {
        kind: 'exposure',
        label: `${mjdToIsoDate(mjd)} · D${det} · ${wl.toFixed(2)} µm · synthetic`,
        mjd,
        mjdMin: mjd - 0.0007,
        mjdMax: mjd + 0.0007,
        wavelength: wl,
        waveMin: wl * (1 - 1 / 80),
        waveMax: wl * (1 + 1 / 80),
        detectors: [det],
        nExposures: 1,
        exposureIds: [`synthetic-${v}-${k}`],
        visit: v,
      },
    });
  }
});

const el = document.getElementById('cube')!;
const view = new CubeView(el);
let axis: 'time' | 'wavelength' = 'time';
let showTracks = true;
const stretch: Stretch = { lo: 0, hi: 3, mode: 'asinh', q: 10, invert: false, colormap: 'gray' };

function applyTracks(): void {
  view.setTracks(showTracks ? [{ path: moverPath, color: '#ff7a66', label: 'mover' }] : []);
}

function setAxis(a: 'time' | 'wavelength'): void {
  axis = a;
  view.setFrames(frames, a);
  applyTracks();
  document.getElementById('axis-time')!.setAttribute('aria-pressed', String(a === 'time'));
  document.getElementById('axis-wave')!.setAttribute('aria-pressed', String(a === 'wavelength'));
}

function setPreset(p: CubeViewPreset): void {
  view.setView(p);
  document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === p)));
}

const hiInput = document.getElementById('hi') as HTMLInputElement;
const hiVal = document.getElementById('hi-val')!;
function updateStretch(): void {
  // Slider spans 0.3 .. 30 MJy/sr logarithmically.
  stretch.hi = 0.3 * 100 ** (Number(hiInput.value) / 100);
  stretch.mode = (document.getElementById('mode') as HTMLSelectElement).value as Stretch['mode'];
  stretch.invert = (document.getElementById('invert') as HTMLInputElement).checked;
  hiVal.textContent = `${stretch.hi.toFixed(2)} MJy/sr`;
  view.setStretch(stretch);
}

document.getElementById('axis-time')!.addEventListener('click', () => setAxis('time'));
document.getElementById('axis-wave')!.addEventListener('click', () => setAxis('wavelength'));
document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.view as CubeViewPreset)));
hiInput.addEventListener('input', updateStretch);
document.getElementById('mode')!.addEventListener('change', updateStretch);
document.getElementById('invert')!.addEventListener('change', updateStretch);
document.getElementById('tracks')!.addEventListener('change', (e) => {
  showTracks = (e.target as HTMLInputElement).checked;
  applyTracks();
});

const readout = document.getElementById('readout')!;
view.on('hover', (h) => {
  readout.textContent = h
    ? `slice ${h.slice + 1}/${frames.length}  ${h.label}  pixel (${h.i}, ${h.j})  RA ${h.ra.toFixed(5)}  Dec ${h.dec.toFixed(5)}  ${Number.isFinite(h.value) ? h.value.toFixed(3) + ' MJy/sr' : 'no data'}`
    : 'Hover the stack.';
});

hiInput.value = String(Math.round((100 * Math.log(3 / 0.3)) / Math.log(100)));
updateStretch();
setAxis('time');

declare global {
  interface Window {
    __cube?: { view: CubeView; setAxis: typeof setAxis; setPreset: typeof setPreset; ready: boolean; axis: () => string; neCheck: [number, number] };
  }
}
window.__cube = { view, setAxis, setPreset, ready: true, axis: () => axis, neCheck: [neI, neJ] };
