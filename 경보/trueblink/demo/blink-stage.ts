// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Demo of BlinkStage with synthetic frames (no network). Used by e2e/blink-stage.mjs for screenshots.
// Add ?nowebgl=1 to the URL to see the fallback used when WebGL 2 is missing.

import { BlinkStage, type BlinkMode, type BlinkPickPayload } from '../src/gl/BlinkStage';
import { percentileStretch } from '../src/gl/blink/stretch';
import { syntheticScene } from '../src/gl/blink/synthetic';
import type { Stretch } from '../src/core/types';

if (new URLSearchParams(location.search).has('nowebgl')) {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
    return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

const scene = syntheticScene();
const container = document.getElementById('stage') as HTMLElement;
const controls = document.getElementById('controls') as HTMLElement;
const stage = new BlinkStage(container, { pixelated: true });
let stretch: Stretch = percentileStretch(scene.frames, { loPct: 30, hiPct: 99.8, q: 10 });
let mode: BlinkMode = 'single';
let lastHover: BlinkPickPayload | null = null;
let lastPick: BlinkPickPayload | null = null;

stage.setFrames(scene.frames);
stage.setStretch(stretch);
stage.setOverlays(scene.overlays);

const readout = document.createElement('pre');
const status = () => {
  const h = lastHover;
  const p = lastPick;
  readout.textContent = [
    `mode ${mode}  frame ${stage.getFrameIndex() + 1}/${scene.frames.length}  ${stage.isPlaying() ? 'playing' : 'paused'}`,
    `stretch ${stretch.mode} q=${stretch.q} lo=${stretch.lo.toFixed(3)} hi=${stretch.hi.toFixed(3)} ${stretch.colormap}${stretch.invert ? ' inverted' : ''}`,
    h ? `hover i=${h.i} j=${h.j} RA ${h.ra.toFixed(5)} Dec ${h.dec.toFixed(5)} value ${Number.isNaN(h.value) ? 'no data' : h.value.toFixed(3) + ' MJy/sr'}${h.overlay ? ' [' + h.overlay.id + ']' : ''}` : 'hover: -',
    p ? `pick i=${p.i} j=${p.j}${p.overlay ? ' overlay ' + p.overlay.id : ''}` : 'pick: -',
  ].join('\n');
};

function group(title: string, items: [string, () => void, () => boolean][]): void {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('span');
  label.textContent = title;
  row.appendChild(label);
  const buttons: [HTMLButtonElement, () => boolean][] = [];
  for (const [text, act, active] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => {
      act();
      refresh();
    });
    row.appendChild(b);
    buttons.push([b, active]);
  }
  refreshers.push(() => buttons.forEach(([b, active]) => b.setAttribute('aria-pressed', String(active()))));
  controls.appendChild(row);
}
const refreshers: (() => void)[] = [];
function refresh(): void {
  refreshers.forEach((r) => r());
  status();
}

const setStretch = (s: Partial<Stretch>) => {
  stretch = { ...stretch, ...s };
  stage.setStretch(stretch);
};
const setMode = (m: BlinkMode) => {
  mode = m;
  stage.setMode(m);
};

group('Mode', (['single', 'blend', 'difference', 'rgb'] as BlinkMode[]).map((m) => [m, () => setMode(m), () => mode === m]));
group('Stretch', (['asinh', 'linear', 'sqrt', 'log'] as Stretch['mode'][]).map((m) => [m, () => setStretch({ mode: m }), () => stretch.mode === m]));
group('Colours', [
  ...(['gray', 'heat', 'viridis'] as Stretch['colormap'][]).map((c): [string, () => void, () => boolean] => [c, () => setStretch({ colormap: c }), () => stretch.colormap === c]),
  ['invert', () => setStretch({ invert: !stretch.invert }), () => stretch.invert],
]);
group('Frames', [
  ['prev', () => stage.setFrameIndex(stage.getFrameIndex() - 1), () => false],
  ['next', () => stage.setFrameIndex(stage.getFrameIndex() + 1), () => false],
  ['play', () => (stage.isPlaying() ? stage.pause() : stage.play(600)), () => stage.isPlaying()],
]);
let pixelated = true;
group('View', [
  ['pixelated', () => { pixelated = !pixelated; stage.setPixelated(pixelated); }, () => pixelated],
  ['reset', () => stage.resetView(), () => false],
  ['screenshot', () => void stage.screenshot().then((b) => window.open(URL.createObjectURL(b), '_blank')), () => false],
]);
controls.appendChild(readout);

stage.on('frame', () => refresh());
stage.on('hover', (p) => { lastHover = p; status(); });
stage.on('pick', (p) => { lastPick = p; status(); });
refresh();

declare global {
  interface Window {
    __blink?: {
      stage: BlinkStage;
      scene: ReturnType<typeof syntheticScene>;
      setMode: (m: BlinkMode) => void;
      setStretch: (s: Partial<Stretch>) => void;
      last: () => { hover: BlinkPickPayload | null; pick: BlinkPickPayload | null };
    };
    __blinkReady?: boolean;
  }
}
window.__blink = { stage, scene, setMode: (m) => { setMode(m); refresh(); }, setStretch: (s) => { setStretch(s); refresh(); }, last: () => ({ hover: lastHover, pick: lastPick }) };
requestAnimationFrame(() => requestAnimationFrame(() => { window.__blinkReady = true; }));
