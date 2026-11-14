// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// A small 2D-canvas stand-in for gl/BlinkStage, so the UI shows real pixels before three.js is wired in.
// Same contract (StageLike). Draws north up, east left, with nearest-neighbour pixels.
import type { Overlay, SkyFrame, Stretch } from '../core/types';
import { gridPixToSky, skyToGridPix } from '../core/wcs';
import { frameToRgba } from './render2d';
import type { StageEvent, StageLike, StageMode, StagePick } from './seams';

export class CanvasStage implements StageLike {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frames: SkyFrame[] = [];
  private bitmaps: (HTMLCanvasElement | null)[] = [];
  private index = 0;
  private stretch: Stretch = { lo: 0, hi: 1, mode: 'asinh', q: 8, invert: false, colormap: 'gray' };
  private overlays: Overlay[] = [];
  private zoom = 1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Map<StageEvent, Set<(p: unknown) => void>>();
  private ro: ResizeObserver | undefined;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage2d-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw on a canvas.');
    this.ctx = ctx;
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointermove', this.onMove);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    this.resize();
  }

  setFrames(frames: SkyFrame[]): void {
    this.frames = frames;
    this.bitmaps = frames.map(() => null);
    if (this.index >= frames.length) this.index = 0;
    this.draw();
  }

  setFrameIndex(i: number): void {
    if (i === this.index || i < 0 || i >= this.frames.length) return;
    this.index = i;
    this.draw();
  }

  getFrameIndex(): number {
    return this.index;
  }

  setStretch(s: Stretch): void {
    this.stretch = { ...s };
    this.bitmaps = this.frames.map(() => null);
    this.draw();
  }

  setMode(_mode: StageMode): void {
    // The fallback shows one frame at a time; difference frames arrive precomputed from the pipeline.
  }

  setOverlays(overlays: Overlay[]): void {
    this.overlays = overlays;
    this.draw();
  }

  setView(v: { zoom?: number }): void {
    if (v.zoom !== undefined) this.zoom = Math.max(1, Math.min(16, v.zoom));
    this.draw();
  }

  resetView(): void {
    this.zoom = 1;
    this.draw();
  }

  play(msPerFrame: number): void {
    this.pause();
    if (this.frames.length < 2) return;
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.index = (this.index + 1) % this.frames.length;
      this.draw();
      this.emit('frame', this.index);
    }, Math.max(100, msPerFrame));
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isPlaying(): boolean {
    return this.timer !== undefined;
  }

  on(event: StageEvent, cb: (payload: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  resize(): void {
    if (this.disposed) return;
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.ro?.disconnect();
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------ internals

  private emit(event: StageEvent, payload: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(payload));
  }

  /** Square drawing box: size in device px, top-left corner, and device px per grid pixel. */
  private layout(n: number) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const size = Math.min(W, H) * this.zoom;
    const px = size / n;
    return { x0: (W - size) / 2, y0: (H - size) / 2, px };
  }

  private bitmap(k: number): HTMLCanvasElement | null {
    const f = this.frames[k];
    if (!f) return null;
    let b = this.bitmaps[k];
    if (!b) {
      const n = f.grid.n;
      b = document.createElement('canvas');
      b.width = n;
      b.height = n;
      const c = b.getContext('2d');
      if (!c) return null;
      c.putImageData(new ImageData(frameToRgba(f, this.stretch) as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0);
      this.bitmaps[k] = b;
    }
    return b;
  }

  private draw(): void {
    if (this.disposed) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = this.frames[this.index];
    if (!f) return;
    const n = f.grid.n;
    const { x0, y0, px } = this.layout(n);
    const bmp = this.bitmap(this.index);
    if (bmp) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bmp, x0, y0, n * px, n * px);
    }
    this.drawOverlays(f, x0, y0, px);
  }

  private toScreen(f: SkyFrame, ra: number, dec: number, x0: number, y0: number, px: number): [number, number] {
    const [i, j] = skyToGridPix(f.grid, ra, dec);
    const n = f.grid.n;
    return [x0 + (i + 0.5) * px, y0 + (n - 1 - j + 0.5) * px];
  }

  private drawOverlays(f: SkyFrame, x0: number, y0: number, px: number): void {
    const ctx = this.ctx;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const css = getComputedStyle(this.container);
    const fallback = css.getPropertyValue('--accent').trim() || '#7aa2ff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    for (const o of this.overlays) {
      if (o.frameIndex !== undefined && o.frameIndex !== this.index) continue;
      const color = o.color ?? fallback;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const [x, y] = this.toScreen(f, o.ra, o.dec, x0, y0, px);
      const r = Math.max(4 * dpr, ((o.sizeArcsec ?? 8) / f.grid.scaleArcsec) * px);
      ctx.beginPath();
      if (o.kind === 'circle') {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.kind === 'cross') {
        ctx.moveTo(x - r, y);
        ctx.lineTo(x - r * 0.35, y);
        ctx.moveTo(x + r * 0.35, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y - r * 0.35);
        ctx.moveTo(x, y + r * 0.35);
        ctx.lineTo(x, y + r);
        ctx.stroke();
      } else if (o.kind === 'box') {
        ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      } else if ((o.kind === 'track' || o.kind === 'arrow') && o.path && o.path.length > 1) {
        ctx.setLineDash(o.kind === 'track' ? [4 * dpr, 4 * dpr] : []);
        const pts = o.path.map(([ra, dec]) => this.toScreen(f, ra, dec, x0, y0, px));
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 2.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (o.text) {
        ctx.fillText(o.text, x + r + 3 * dpr, y - r);
      }
    }
  }

  private eventToPick(ev: MouseEvent): StagePick | null {
    const f = this.frames[this.index];
    if (!f) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * this.canvas.width;
    const sy = ((ev.clientY - rect.top) / rect.height) * this.canvas.height;
    const n = f.grid.n;
    const { x0, y0, px } = this.layout(n);
    const i = (sx - x0) / px - 0.5;
    const j = n - 1 - ((sy - y0) / px - 0.5);
    if (i < -0.5 || j < -0.5 || i > n - 0.5 || j > n - 0.5) return null;
    const [ra, dec] = gridPixToSky(f.grid, i, j);
    const ii = Math.round(i);
    const jj = Math.round(j);
    const value = f.data[jj * n + ii];
    return { ra, dec, i, j, value, frameIndex: this.index };
  }

  private onClick = (ev: MouseEvent) => {
    const p = this.eventToPick(ev);
    if (p) this.emit('pick', p);
  };

  private onMove = (ev: PointerEvent) => {
    const p = this.eventToPick(ev);
    if (p) this.emit('hover', p);
  };
}
