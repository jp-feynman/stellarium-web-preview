// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// BlinkStage: the blink viewer. One square sky image at a time, drawn with three.js, plus a 2D canvas
// layer for markers. Every frame lives on one shared north-up, east-left SkyGrid, so blinking between
// frames shows only what changed on the sky (and, because SPHEREx sees each frame at its own
// wavelength, every frame carries a label with its date and wavelength).
//
// Rendering happens on demand: a frame is drawn only when something changed (data, stretch, view,
// overlays) or while the app has asked it to play.

import * as THREE from 'three';
import type { FrameMeta, Overlay, SkyFrame, SkyGrid, Stretch } from '../core/types';
import { gridPixToSky, skyToGridPix } from '../core/wcs';
import { BLINK_FRAGMENT, BLINK_VERTEX, STRETCH_MODE_CODE, VIEW_BLEND, VIEW_DIFFERENCE, VIEW_RGB, VIEW_SINGLE } from './blink/shaders';
import { colormapLut, frameToImageData, HATCH_DARK, HATCH_LIGHT, NO_DATA_SENTINEL, type ColormapName } from './blink/stretch';
import { drawCompass, drawOverlay, haloText, overlayVisible, pickOverlay, projectOverlay, type ProjectedOverlay } from './blink/overlays';
import {
  cameraBounds,
  clampView,
  defaultView,
  gridToScreen,
  panBy,
  pixelScale,
  screenToGrid,
  zoomAbout,
  type ViewState,
  type Viewport,
} from './blink/view';

export { COLOR_MAPS, frameToImageData, frameToRGBA, percentileStretch, colormapLookup, stretchValue } from './blink/stretch';

export type BlinkMode = 'single' | 'blend' | 'difference' | 'rgb';

export interface BlinkModeOptions {
  /** Frame shown (single), first frame (blend), minuend (difference: a - b). Default: current frame. */
  a?: number;
  /** Second frame (blend; default the next frame) or reference (difference; default frame 0). */
  b?: number;
  /** Frames mapped to red, green, blue. Default: longest, middle, shortest wavelength. */
  rgb?: [number, number, number];
}

export interface BlinkStageOptions {
  /** Nearest-neighbour sampling: each grid pixel is a crisp square (default true). */
  pixelated?: boolean;
  /** Draw the frame label (date, wavelength) in the corner of the image (default true). */
  caption?: boolean;
  /** Draw N / E arrows (default true). */
  compass?: boolean;
}

/** 'pick' and 'hover' payload. Hover sends null when the pointer leaves the image. */
export interface BlinkPickPayload {
  ra: number;
  dec: number;
  /** Grid pixel under the pointer (integers, column 0 = east, row 0 = south). */
  i: number;
  j: number;
  /** Value of the current frame at (i, j) in its units (MJy/sr); NaN = no data. */
  value: number;
  frameIndex: number;
  overlay?: Overlay;
}

export interface BlinkFramePayload {
  frameIndex: number;
  count: number;
  meta?: FrameMeta;
}

export interface BlinkViewPayload {
  zoom: number;
  centerRa: number;
  centerDec: number;
  /** View centre in grid pixels. */
  cx: number;
  cy: number;
}

type EventName = 'frame' | 'pick' | 'hover' | 'view';
type Listener = (payload: never) => void;

const DEFAULT_STRETCH: Stretch = { lo: 0, hi: 1, mode: 'asinh', q: 10, invert: false, colormap: 'gray' };

function cssVar(el: Element, name: string, fallback: string): string {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function lutTexture(name: ColormapName): THREE.DataTexture {
  const t = new THREE.DataTexture(colormapLut(name), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Copy a frame for the GPU, replacing every non-finite value by the no-data sentinel. */
function gpuData(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) {
    const v = data[k];
    out[k] = Number.isFinite(v) ? v : NO_DATA_SENTINEL;
  }
  return out;
}

function floatTexture(data: Float32Array, n: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  // Always fetch exact texels; bilinear sampling (when wanted) is done in the shader so that
  // no-data neighbours can be skipped.
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export class BlinkStage {
  private readonly container: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D | null;
  private readonly msgEl: HTMLDivElement;
  private readonly opts: Required<BlinkStageOptions>;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private emptyTex: THREE.DataTexture | null = null;
  private luts = new Map<ColormapName, THREE.DataTexture>();
  private textures: THREE.DataTexture[] = [];
  private contextLost = false;

  private frames: SkyFrame[] = [];
  private grid: SkyGrid | null = null;
  private frameIndex = 0;
  private mode: BlinkMode = 'single';
  private modeOpts: BlinkModeOptions = {};
  private stretch: Stretch = { ...DEFAULT_STRETCH };
  private overlays: Overlay[] = [];
  private projected: ProjectedOverlay[] = [];
  private blendMix = 0.5;
  private pixelated: boolean;

  private view: ViewState = defaultView(1);
  private vp: Viewport = { width: 1, height: 1, n: 1 };
  private dpr = 1;

  private listeners = new Map<EventName, Set<Listener>>();
  private playing = false;
  private msPerFrame = 500;
  private playRaf = 0;
  private lastStep = 0;
  private renderRaf = 0;
  private cleanups: (() => void)[] = [];
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackKey = '';

  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  constructor(container: HTMLElement, opts?: BlinkStageOptions) {
    this.container = container;
    this.opts = { pixelated: opts?.pixelated ?? true, caption: opts?.caption ?? true, compass: opts?.compass ?? true };
    this.pixelated = this.opts.pixelated;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.root = document.createElement('div');
    this.root.className = 'blink-stage';
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      background: cssVar(container, '--bg', '#080c16'),
      touchAction: 'none',
      cursor: 'crosshair',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.root);

    try {
      // Fail early and quietly when WebGL 2 is missing; three.js would log an error and throw.
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) throw new Error('WebGL 2 is not available');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      this.initGL();
    } catch (err) {
      this.renderer = null;
      console.warn('BlinkStage: WebGL unavailable, using the basic 2D view.', err);
    }

    this.overlayCanvas = document.createElement('canvas');
    Object.assign(this.overlayCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.msgEl = document.createElement('div');
    this.msgEl.setAttribute('role', 'status');
    Object.assign(this.msgEl.style, {
      position: 'absolute',
      left: '50%',
      top: '12px',
      transform: 'translateX(-50%)',
      maxWidth: 'calc(100% - 24px)',
      padding: '8px 12px',
      borderRadius: cssVar(container, '--radius-sm', '6px'),
      background: cssVar(container, '--panel', '#111827'),
      border: `1px solid ${cssVar(container, '--border', '#26324a')}`,
      color: cssVar(container, '--text', '#e8edf7'),
      font: '13px/1.4 system-ui, sans-serif',
      textAlign: 'center',
      pointerEvents: 'none',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.msgEl);
    if (!this.renderer) {
      this.showMessage('WebGL 2 is not available in this browser, so a basic 2D view is shown (single frames only).');
    }

    this.bindEvents();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    this.resize();
  }

  // ---------------------------------------------------------------- public API (docs/ARCHITECTURE.md)

  setFrames(frames: SkyFrame[]): void {
    if (this.disposed) return;
    const first = frames[0];
    if (first) {
      const n = first.grid.n;
      frames.forEach((f, k) => {
        if (f.grid.n !== n || f.data.length !== n * n) {
          throw new Error(
            `BlinkStage.setFrames: frame ${k} does not match the shared grid (expected ${n} x ${n} = ${n * n} pixels, got grid ${f.grid.n} and ${f.data.length} values).`,
          );
        }
      });
    }
    for (const t of this.textures) t.dispose();
    this.textures = [];
    const oldN = this.grid?.n;
    this.frames = frames.slice();
    this.grid = first ? first.grid : null;
    this.fallbackKey = '';
    if (this.renderer && first) {
      this.textures = this.frames.map((f) => floatTexture(gpuData(f.data), f.grid.n));
    }
    if (first && first.grid.n !== oldN) {
      this.vp = { ...this.vp, n: first.grid.n };
      this.mesh?.geometry.dispose();
      if (this.mesh) {
        const n = first.grid.n;
        this.mesh.geometry = new THREE.PlaneGeometry(n, n);
        this.mesh.position.set((n - 1) / 2, (n - 1) / 2, 0);
      }
      this.view = defaultView(first.grid.n);
    }
    this.frameIndex = Math.min(Math.max(0, this.frameIndex), Math.max(0, this.frames.length - 1));
    this.reproject();
    this.requestRender();
    this.emitFrame();
  }

  setFrameIndex(i: number): void {
    if (this.disposed || !this.frames.length) return;
    const n = this.frames.length;
    const k = ((Math.round(i) % n) + n) % n;
    if (k === this.frameIndex) return;
    this.frameIndex = k;
    this.lastStep = performance.now();
    this.requestRender();
    this.emitFrame();
  }

  getFrameIndex(): number {
    return this.frameIndex;
  }

  /** Step through the frames every `msPerFrame` ms. Only the app calls this (never automatic). */
  play(msPerFrame: number): void {
    if (this.disposed) return;
    this.msPerFrame = Math.max(16, Number.isFinite(msPerFrame) ? msPerFrame : 500);
    if (this.playing) return;
    this.playing = true;
    this.lastStep = performance.now();
    const tick = (now: number) => {
      if (!this.playing || this.disposed) return;
      const n = this.frames.length;
      if (n > 1 && now - this.lastStep >= this.msPerFrame) {
        // Catch up without bursting after the tab was in the background.
        this.lastStep = now - this.msPerFrame > this.lastStep + this.msPerFrame ? now : this.lastStep + this.msPerFrame;
        this.frameIndex = (this.frameIndex + 1) % n;
        this.emitFrame();
        this.renderNow();
      } else if (this.mode === 'blend' && n > 1 && !this.reducedMotion()) {
        this.renderNow(); // the cross-fade needs every animation frame
      }
      this.playRaf = requestAnimationFrame(tick);
    };
    this.playRaf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    if (this.playRaf) cancelAnimationFrame(this.playRaf);
    this.playRaf = 0;
    this.requestRender();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setStretch(s: Stretch): void {
    if (this.disposed) return;
    this.stretch = { ...s };
    this.fallbackKey = '';
    this.requestRender();
  }

  setMode(mode: BlinkMode, opts?: BlinkModeOptions): void {
    if (this.disposed) return;
    this.mode = mode;
    this.modeOpts = { ...(opts ?? {}) };
    if (mode === 'single' && opts?.a !== undefined) {
      this.setFrameIndex(opts.a);
    }
    this.requestRender();
  }

  /** Cross-fade position for 'blend' when not playing: 0 = frame a, 1 = frame b. (Extension.) */
  setBlend(mix: number): void {
    this.blendMix = Math.min(1, Math.max(0, mix));
    this.requestRender();
  }

  /** Switch between crisp pixels (true) and smooth bilinear sampling (false). (Extension.) */
  setPixelated(pixelated: boolean): void {
    this.pixelated = pixelated;
    this.fallbackKey = '';
    this.requestRender();
  }

  setOverlays(overlays: Overlay[]): void {
    if (this.disposed) return;
    this.overlays = overlays.slice();
    this.reproject();
    this.requestRender();
  }

  setView(v: { zoom?: number; centerRa?: number; centerDec?: number }): void {
    if (this.disposed) return;
    let { cx, cy } = this.view;
    if (this.grid && v.centerRa !== undefined && v.centerDec !== undefined) {
      [cx, cy] = skyToGridPix(this.grid, v.centerRa, v.centerDec);
    }
    this.applyView({ zoom: v.zoom ?? this.view.zoom, cx, cy });
  }

  resetView(): void {
    if (this.disposed) return;
    this.applyView(defaultView(this.vp.n));
  }

  on(event: 'frame', cb: (payload: BlinkFramePayload) => void): () => void;
  on(event: 'pick', cb: (payload: BlinkPickPayload) => void): () => void;
  on(event: 'hover', cb: (payload: BlinkPickPayload | null) => void): () => void;
  on(event: 'view', cb: (payload: BlinkViewPayload) => void): () => void;
  on(event: EventName, cb: (payload: never) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as Listener);
    return () => {
      set.delete(cb as Listener);
    };
  }

  /** PNG of what is on screen: the image plus overlays, at device resolution. */
  screenshot(): Promise<Blob> {
    if (this.disposed) return Promise.reject(new Error('BlinkStage was disposed.'));
    this.renderNow();
    const out = document.createElement('canvas');
    out.width = this.overlayCanvas.width;
    out.height = this.overlayCanvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Could not create a 2D canvas for the screenshot.'));
    ctx.fillStyle = cssVar(this.container, '--bg', '#080c16');
    ctx.fillRect(0, 0, out.width, out.height);
    // The WebGL buffer is still valid here because we drew it in this same task.
    if (this.renderer && !this.contextLost) ctx.drawImage(this.renderer.domElement, 0, 0, out.width, out.height);
    ctx.drawImage(this.overlayCanvas, 0, 0);
    return new Promise((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the screenshot as PNG.'))), 'image/png');
    });
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.round(this.root.clientWidth || this.container.clientWidth));
    const h = Math.max(1, Math.round(this.root.clientHeight || this.container.clientHeight));
    const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
    if (w === this.vp.width && h === this.vp.height && dpr === this.dpr && this.overlayCanvas.width > 0) {
      return;
    }
    this.dpr = dpr;
    this.vp = { width: w, height: h, n: this.vp.n };
    this.overlayCanvas.width = Math.round(w * dpr);
    this.overlayCanvas.height = Math.round(h * dpr);
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    this.view = clampView(this.vp, this.view);
    this.reproject();
    this.renderNow();
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    if (this.renderRaf) cancelAnimationFrame(this.renderRaf);
    this.ro?.disconnect();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    for (const t of this.textures) t.dispose();
    this.textures = [];
    for (const t of this.luts.values()) t.dispose();
    this.luts.clear();
    this.emptyTex?.dispose();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer = null;
    this.listeners.clear();
    this.root.remove();
  }

  // ---------------------------------------------------------------- internals

  private initGL(): void {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(new THREE.Color(cssVar(this.container, '--bg', '#080c16')), 1);
    const canvas = renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    this.root.appendChild(canvas);

    const onLost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      this.showMessage('The graphics context was lost (GPU reset or too many tabs). Trying to restore it...');
    };
    const onRestored = () => {
      this.contextLost = false;
      for (const t of this.textures) t.needsUpdate = true;
      for (const t of this.luts.values()) t.needsUpdate = true;
      if (this.emptyTex) this.emptyTex.needsUpdate = true;
      this.hideMessage();
      this.requestRender();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    this.emptyTex = floatTexture(new Float32Array([NO_DATA_SENTINEL]), 1);
    const hatch = (c: number[]) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
    this.material = new THREE.ShaderMaterial({
      vertexShader: BLINK_VERTEX,
      fragmentShader: BLINK_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexA: { value: this.emptyTex },
        uTexB: { value: this.emptyTex },
        uTexC: { value: this.emptyTex },
        uLut: { value: this.lut('gray') },
        uDivLut: { value: this.lut('diverging') },
        uN: { value: 1 },
        uLo: { value: 0 },
        uHi: { value: 1 },
        uStretchMode: { value: 3 },
        uQ: { value: 10 },
        uInvert: { value: false },
        uView: { value: VIEW_SINGLE },
        uMix: { value: 0 },
        uLinear: { value: false },
        uDpr: { value: 1 },
        uHatchDark: { value: hatch(HATCH_DARK) },
        uHatchLight: { value: hatch(HATCH_LIGHT) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.visible = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.set(0, 0, 1);
    this.renderer = renderer;
  }

  private lut(name: ColormapName): THREE.DataTexture {
    let t = this.luts.get(name);
    if (!t) {
      t = lutTexture(name);
      this.luts.set(name, t);
    }
    return t;
  }

  private reducedMotion(): boolean {
    try {
      return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /** Frame indices used by the current mode. */
  private resolveFrames(): { a: number; b: number; c: number } {
    const n = this.frames.length;
    const cl = (k: number | undefined, d: number) => (k === undefined || !Number.isFinite(k) ? d : Math.min(n - 1, Math.max(0, Math.round(k))));
    const cur = this.frameIndex;
    switch (this.mode) {
      case 'blend':
        if (this.playing) return { a: cur, b: (cur + 1) % n, c: cur };
        return { a: cl(this.modeOpts.a, cur), b: cl(this.modeOpts.b, (cur + 1) % n), c: cur };
      case 'difference':
        return { a: cl(this.modeOpts.a, cur), b: cl(this.modeOpts.b, 0), c: cur };
      case 'rgb': {
        const [r, g, b] = this.modeOpts.rgb ?? this.defaultRgb();
        return { a: cl(r, 0), b: cl(g, 0), c: cl(b, 0) };
      }
      default:
        return { a: cur, b: cur, c: cur };
    }
  }

  /** Red = longest wavelength, blue = shortest (ties keep frame order: red = earliest). */
  private defaultRgb(): [number, number, number] {
    const idx = this.frames.map((_, k) => k);
    idx.sort((p, q) => (this.frames[q].meta.wavelength - this.frames[p].meta.wavelength) || p - q);
    const n = idx.length;
    return [idx[0] ?? 0, idx[Math.floor((n - 1) / 2)] ?? 0, idx[n - 1] ?? 0];
  }

  private blendPhase(): number {
    if (!this.playing) return this.blendMix;
    if (this.reducedMotion()) return 0;
    // Hold frame a for 60 % of the interval, then fade smoothly into frame b.
    const t = (performance.now() - this.lastStep) / this.msPerFrame;
    const x = Math.min(1, Math.max(0, (t - 0.6) / 0.4));
    return x * x * (3 - 2 * x);
  }

  private requestRender(): void {
    if (this.disposed || this.renderRaf) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.renderNow();
      return;
    }
    this.renderRaf = requestAnimationFrame(() => {
      this.renderRaf = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.disposed) return;
    const hasFrames = this.frames.length > 0 && this.grid !== null;
    if (this.renderer && this.scene && this.camera && this.material && this.mesh && !this.contextLost) {
      const u = this.material.uniforms;
      if (hasFrames) {
        const { a, b, c } = this.resolveFrames();
        const s = this.stretch;
        u.uTexA.value = this.textures[a] ?? this.emptyTex;
        u.uTexB.value = this.textures[b] ?? this.emptyTex;
        u.uTexC.value = this.textures[c] ?? this.emptyTex;
        u.uLut.value = this.lut(s.colormap);
        u.uN.value = this.vp.n;
        u.uLo.value = s.lo;
        u.uHi.value = s.hi;
        u.uStretchMode.value = STRETCH_MODE_CODE[s.mode] ?? 3;
        u.uQ.value = s.q;
        u.uInvert.value = s.invert;
        u.uView.value =
          this.mode === 'blend' ? VIEW_BLEND : this.mode === 'difference' ? VIEW_DIFFERENCE : this.mode === 'rgb' ? VIEW_RGB : VIEW_SINGLE;
        u.uMix.value = this.blendPhase();
        u.uLinear.value = !this.pixelated;
        u.uDpr.value = this.dpr;
      }
      this.mesh.visible = hasFrames;
      const cb = cameraBounds(this.vp, this.view);
      this.camera.left = cb.left;
      this.camera.right = cb.right;
      this.camera.top = cb.top;
      this.camera.bottom = cb.bottom;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    }
    this.drawOverlayLayer();
  }

  /** CPU picture of the current frame for browsers without WebGL 2. */
  private drawFallback(ctx: CanvasRenderingContext2D): void {
    const f = this.frames[this.frameIndex];
    if (!f || typeof document === 'undefined') return;
    const n = f.grid.n;
    const key = `${this.frameIndex}|${JSON.stringify(this.stretch)}`;
    if (!this.fallbackCanvas) this.fallbackCanvas = document.createElement('canvas');
    if (key !== this.fallbackKey) {
      this.fallbackCanvas.width = n;
      this.fallbackCanvas.height = n;
      this.fallbackCanvas.getContext('2d')?.putImageData(frameToImageData(f, this.stretch), 0, 0);
      this.fallbackKey = key;
    }
    const [x0, y0] = gridToScreen(this.vp, this.view, -0.5, n - 0.5);
    const side = n * pixelScale(this.vp, this.view);
    ctx.imageSmoothingEnabled = !this.pixelated;
    ctx.drawImage(this.fallbackCanvas, x0, y0, side, side);
  }

  private drawOverlayLayer(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const { width, height } = this.vp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.renderer) this.drawFallback(ctx);
    if (!this.grid || !this.frames.length) return;

    const accent = cssVar(this.container, '--accent', '#7aa2ff');
    for (const po of this.projected) {
      if (overlayVisible(po.overlay, this.frameIndex)) drawOverlay(ctx, po, accent);
    }

    // Image square on screen, clipped to the container, for placing the caption and compass.
    const n = this.vp.n;
    const [l, t] = gridToScreen(this.vp, this.view, -0.5, n - 0.5);
    const [r, b] = gridToScreen(this.vp, this.view, n - 0.5, -0.5);
    const left = Math.max(0, l);
    const right = Math.min(width, r);
    const top = Math.max(0, t);
    const bottom = Math.min(height, b);
    const text = cssVar(this.container, '--text', '#e8edf7');
    if (this.opts.compass) {
      ctx.save();
      ctx.translate(right - width, top);
      drawCompass(ctx, width, text);
      ctx.restore();
    }
    if (this.opts.caption) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const lines = this.captionLines();
      let y = bottom - 10 - (lines.length - 1) * 16;
      for (const line of lines) {
        haloText(ctx, line.text, left + 10, y, line.color ?? text);
        y += 16;
      }
      ctx.restore();
    }
  }

  private captionLines(): { text: string; color?: string }[] {
    const label = (k: number) => this.frames[k]?.meta.label || `Frame ${k + 1}`;
    const { a, b, c } = this.resolveFrames();
    const count = this.frames.length;
    switch (this.mode) {
      case 'difference':
        return [{ text: `Difference: ${label(a)}` }, { text: `minus ${label(b)}` }];
      case 'rgb':
        return [
          { text: `R: ${label(a)}`, color: '#ff8a80' },
          { text: `G: ${label(b)}`, color: '#8cf0a0' },
          { text: `B: ${label(c)}`, color: '#8cb8ff' },
        ];
      case 'blend':
        return [{ text: `${label(a)}  ->  ${label(b)}` }];
      default:
        return [{ text: `${this.frameIndex + 1}/${count}  ${label(this.frameIndex)}` }];
    }
  }

  private reproject(): void {
    const g = this.grid;
    this.projected = g ? this.overlays.map((o) => projectOverlay(o, g, this.vp, this.view)) : [];
  }

  private applyView(v: ViewState): void {
    const next = clampView(this.vp, v);
    if (next.zoom === this.view.zoom && next.cx === this.view.cx && next.cy === this.view.cy) return;
    this.view = next;
    this.reproject();
    this.requestRender();
    this.emit('view', this.viewPayload());
  }

  private viewPayload(): BlinkViewPayload {
    const [centerRa, centerDec] = this.grid ? gridPixToSky(this.grid, this.view.cx, this.view.cy) : [NaN, NaN];
    return { zoom: this.view.zoom, centerRa, centerDec, cx: this.view.cx, cy: this.view.cy };
  }

  private emit(event: EventName, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (p: unknown) => void)(payload);
      } catch (err) {
        console.error(`BlinkStage '${event}' listener failed`, err);
      }
    }
  }

  private emitFrame(): void {
    const payload: BlinkFramePayload = {
      frameIndex: this.frameIndex,
      count: this.frames.length,
      meta: this.frames[this.frameIndex]?.meta,
    };
    this.emit('frame', payload);
  }

  private pointAt(clientX: number, clientY: number): BlinkPickPayload | null {
    if (!this.grid || !this.frames.length) return null;
    const rect = this.root.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const [gi, gj] = screenToGrid(this.vp, this.view, x, y);
    const i = Math.round(gi);
    const j = Math.round(gj);
    const n = this.grid.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    const [ra, dec] = gridPixToSky(this.grid, gi, gj);
    const visible = this.projected.filter((po) => overlayVisible(po.overlay, this.frameIndex));
    const v = this.frames[this.frameIndex].data[j * n + i];
    return {
      ra,
      dec,
      i,
      j,
      value: Number.isFinite(v) ? v : NaN,
      frameIndex: this.frameIndex,
      overlay: pickOverlay(visible, x, y),
    };
  }

  private bindEvents(): void {
    const el = this.root;
    const listen = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, o);
      this.cleanups.push(() => el.removeEventListener(type, fn, o));
    };
    listen(
      'wheel',
      (e) => {
        if (!this.grid) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        // Normalise line / page deltas to pixels; one wheel notch (about 100 px) zooms by about 1.2x.
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        const factor = Math.exp(-dy * 0.0018);
        this.applyView(zoomAbout(this.vp, this.view, factor, e.clientX - rect.left, e.clientY - rect.top));
      },
      { passive: false },
    );
    listen('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
    });
    listen('pointermove', (e) => {
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (d.moved || Math.hypot(dx, dy) > 3) {
          d.moved = true;
          el.style.cursor = 'grabbing';
          this.applyView(panBy(this.vp, this.view, dx, dy));
          d.x = e.clientX;
          d.y = e.clientY;
        }
      }
      this.emit('hover', this.pointAt(e.clientX, e.clientY));
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      el.style.cursor = 'crosshair';
      if (e.type === 'pointerup' && !d.moved) {
        const p = this.pointAt(e.clientX, e.clientY);
        if (p) this.emit('pick', p);
      }
    };
    listen('pointerup', end);
    listen('pointercancel', end);
    listen('pointerleave', () => {
      if (!this.drag) this.emit('hover', null);
    });
    listen('dblclick', (e) => {
      e.preventDefault();
      this.resetView();
    });
  }

  private showMessage(text: string): void {
    this.msgEl.textContent = text;
    this.msgEl.style.display = 'block';
  }

  private hideMessage(): void {
    this.msgEl.style.display = 'none';
  }
}
