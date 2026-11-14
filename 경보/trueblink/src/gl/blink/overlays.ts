// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Overlay markers (circles, crosses, boxes, labels, tracks, arrows) drawn on a 2D canvas above the
// WebGL image. Positions are sky coordinates; they are projected onto the shared SkyGrid with the same
// tangent-plane maths used to build the frames, then onto the screen with the current view.

import type { Overlay, SkyGrid } from '../../core/types';
import { skyToGridPix } from '../../core/wcs';
import { distToSegment, gridToScreen, pixelScale, type ViewState, type Viewport } from './view';

export const LABEL_FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const STROKE_PX = 1.5;
/** Pick radius around an overlay, in CSS pixels. */
export const PICK_RADIUS_PX = 10;

export interface ProjectedOverlay {
  overlay: Overlay;
  /** Anchor on screen (CSS px). */
  x: number;
  y: number;
  /** Radius / half-size on screen (CSS px). */
  r: number;
  /** Polyline on screen for track / arrow. */
  pts: [number, number][];
}

/** Does this overlay belong on the frame being shown? */
export function overlayVisible(o: Overlay, frameIndex: number): boolean {
  return o.frameIndex === undefined || o.frameIndex === frameIndex;
}

export function projectOverlay(o: Overlay, grid: SkyGrid, vp: Viewport, v: ViewState): ProjectedOverlay {
  const toScreen = (ra: number, dec: number): [number, number] => {
    const [i, j] = skyToGridPix(grid, ra, dec);
    return gridToScreen(vp, v, i, j);
  };
  const [x, y] = toScreen(o.ra, o.dec);
  const p = pixelScale(vp, v);
  const r = o.sizeArcsec !== undefined && o.sizeArcsec > 0 ? Math.max(3, (o.sizeArcsec / grid.scaleArcsec) * p) : 8;
  let pts: [number, number][] = (o.path ?? []).map(([ra, dec]) => toScreen(ra, dec));
  // An arrow with a single path point runs from (ra, dec) to that point.
  if (o.kind === 'arrow' && pts.length === 1) pts = [[x, y], pts[0]];
  return { overlay: o, x, y, r, pts };
}

/** Screen distance from (px, py) to a projected overlay (0 when inside a circle or box). */
export function overlayDistance(po: ProjectedOverlay, px: number, py: number): number {
  const k = po.overlay.kind;
  if ((k === 'track' || k === 'arrow') && po.pts.length >= 2) {
    let d = Infinity;
    for (let s = 0; s + 1 < po.pts.length; s++) {
      const [ax, ay] = po.pts[s];
      const [bx, by] = po.pts[s + 1];
      d = Math.min(d, distToSegment(px, py, ax, ay, bx, by));
    }
    return d;
  }
  if (k === 'circle') return Math.max(0, Math.hypot(px - po.x, py - po.y) - po.r);
  if (k === 'box') return Math.max(0, Math.max(Math.abs(px - po.x), Math.abs(py - po.y)) - po.r);
  return Math.hypot(px - po.x, py - po.y);
}

/** Nearest visible overlay within PICK_RADIUS_PX, or undefined. */
export function pickOverlay(list: ProjectedOverlay[], px: number, py: number, radius = PICK_RADIUS_PX): Overlay | undefined {
  let best: Overlay | undefined;
  let bestD = radius;
  for (const po of list) {
    const d = overlayDistance(po, px, py);
    if (d <= bestD) {
      bestD = d;
      best = po.overlay;
    }
  }
  return best;
}

/** Text with a dark halo so it reads on both dark sky and bright stars. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = LABEL_FONT;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Draw one projected overlay. The context must already be scaled to CSS pixels. */
export function drawOverlay(ctx: CanvasRenderingContext2D, po: ProjectedOverlay, defaultColor: string): void {
  const o = po.overlay;
  const color = o.color ?? defaultColor;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = STROKE_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A thin dark under-stroke keeps coloured lines visible on white star cores.
  const stroke = (path: () => void) => {
    ctx.beginPath();
    path();
    ctx.lineWidth = STROKE_PX + 1.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.stroke();
    ctx.lineWidth = STROKE_PX;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  const { x, y, r } = po;
  let labelX = x + r + 4;
  let labelY = y - r - 2;
  switch (o.kind) {
    case 'circle':
      stroke(() => ctx.arc(x, y, r, 0, Math.PI * 2));
      break;
    case 'box':
      stroke(() => ctx.rect(x - r, y - r, 2 * r, 2 * r));
      break;
    case 'cross': {
      // Open cross: a gap in the middle so the marked pixel stays visible.
      const g = Math.max(2, r * 0.35);
      stroke(() => {
        ctx.moveTo(x - r, y);
        ctx.lineTo(x - g, y);
        ctx.moveTo(x + g, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y - g);
        ctx.moveTo(x, y + g);
        ctx.lineTo(x, y + r);
      });
      break;
    }
    case 'track': {
      if (po.pts.length >= 2) {
        stroke(() => {
          ctx.moveTo(po.pts[0][0], po.pts[0][1]);
          for (const [px, py] of po.pts.slice(1)) ctx.lineTo(px, py);
        });
        for (const [px, py] of po.pts) {
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        const last = po.pts[po.pts.length - 1];
        labelX = last[0] + 6;
        labelY = last[1] - 6;
      }
      break;
    }
    case 'arrow': {
      if (po.pts.length >= 2) {
        const [ax, ay] = po.pts[po.pts.length - 2];
        const [bx, by] = po.pts[po.pts.length - 1];
        const ang = Math.atan2(by - ay, bx - ax);
        const h = 8;
        stroke(() => {
          ctx.moveTo(po.pts[0][0], po.pts[0][1]);
          for (const [px, py] of po.pts.slice(1)) ctx.lineTo(px, py);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - h * Math.cos(ang - 0.45), by - h * Math.sin(ang - 0.45));
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - h * Math.cos(ang + 0.45), by - h * Math.sin(ang + 0.45));
        });
        labelX = bx + 6;
        labelY = by - 6;
      }
      break;
    }
    case 'label':
      labelX = x;
      labelY = y;
      break;
  }
  if (o.text) {
    ctx.textBaseline = o.kind === 'label' ? 'middle' : 'alphabetic';
    ctx.textAlign = o.kind === 'label' ? 'center' : 'left';
    haloText(ctx, o.text, labelX, labelY, color);
  }
  ctx.restore();
}

/** North and east arrows in the top-right corner (east is left when north is up). */
export function drawCompass(ctx: CanvasRenderingContext2D, width: number, color: string): void {
  const x = width - 22;
  const y = 40;
  const L = 22;
  ctx.save();
  ctx.lineWidth = STROKE_PX;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - L);
  ctx.moveTo(x, y);
  ctx.lineTo(x - L, y);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  haloText(ctx, 'N', x, y - L - 8, color);
  haloText(ctx, 'E', x - L - 9, y, color);
  ctx.restore();
}
