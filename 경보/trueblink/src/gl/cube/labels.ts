// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// HTML labels pinned to 3D points. Text stays crisp at any zoom (WebGL text would need a font atlas),
// and the labels are ordinary DOM nodes that screen readers and screenshot checks can see.

import { Vector3, type Camera } from 'three';

export interface PinnedLabel {
  el: HTMLSpanElement;
  world: Vector3;
  /** Pixel offset of the label's anchor from the projected point. */
  dx: number;
  dy: number;
  /** 'left' puts the text's right edge at the point, 'right' its left edge, 'center' centres it. */
  align: 'left' | 'right' | 'center';
  /** Measured size in CSS pixels (cached: the text never changes). */
  w?: number;
  h?: number;
}

export class LabelLayer {
  readonly root: HTMLDivElement;
  private labels: PinnedLabel[] = [];
  private tmp = new Vector3();

  constructor(parent: HTMLElement, className: string) {
    this.root = document.createElement('div');
    this.root.className = className;
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
      font: '12px var(--font, system-ui, sans-serif)',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.root);
  }

  add(text: string, world: Vector3, opts: { color?: string; dx?: number; dy?: number; align?: PinnedLabel['align']; weight?: number; size?: number } = {}): PinnedLabel {
    const el = document.createElement('span');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      color: opts.color ?? 'var(--text, #e8edf7)',
      fontWeight: String(opts.weight ?? 500),
      fontSize: `${opts.size ?? 12}px`,
      // A dark pill keeps labels readable over glowing sources and on the light (inverted) background.
      background: 'rgba(8, 12, 22, 0.62)',
      padding: '1px 5px',
      borderRadius: '4px',
      lineHeight: '1.35',
      whiteSpace: 'pre',
      textAlign: opts.align === 'left' ? 'right' : 'left',
      willChange: 'transform',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.appendChild(el);
    const label: PinnedLabel = { el, world: world.clone(), dx: opts.dx ?? 0, dy: opts.dy ?? 0, align: opts.align ?? 'center' };
    this.labels.push(label);
    return label;
  }

  clear(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  /**
   * Re-project every label. (x0, y0, w, h) is the viewport in CSS pixels, y measured from the top.
   * Labels that would overlap one placed earlier are hidden (e.g. all visit dates seen end-on).
   */
  update(camera: Camera, x0: number, y0: number, w: number, h: number): void {
    const placed: [number, number, number, number][] = [];
    for (const l of this.labels) {
      const p = this.tmp.copy(l.world).project(camera);
      if (p.z > 1 || p.z < -1 || !Number.isFinite(p.x)) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      if (l.w === undefined || l.h === undefined || l.w === 0) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      const sx = x0 + ((p.x + 1) / 2) * w + l.dx;
      const sy = y0 + ((1 - p.y) / 2) * h + l.dy;
      const f = l.align === 'left' ? 1 : l.align === 'right' ? 0 : 0.5;
      // Keep the whole label inside the viewport horizontally (shifted, rather than cut off).
      const left = Math.min(Math.max(sx - f * l.w, x0 + 2), x0 + w - l.w - 2);
      const box: [number, number, number, number] = [left, sy - l.h / 2, left + l.w, sy + l.h / 2];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
        l.el.style.display = 'none';
        continue;
      }
      placed.push(box);
      l.el.style.transform = `translate(${box[0].toFixed(1)}px, ${box[1].toFixed(1)}px)`;
    }
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
