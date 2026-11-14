// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Pure view geometry of the blink stage: which grid pixel lands on which screen (CSS) pixel.
//
// Grid convention (core/types.ts): column i = 0 is the EAST edge, row j = 0 is the SOUTH edge. On the
// screen we put column 0 on the left and row 0 at the bottom, so north is up and east is left, the way
// the sky looks when you face south and look up (and the way astronomers draw finder charts).

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 32;

export interface ViewState {
  /** Magnification over "whole image fits the square". */
  zoom: number;
  /** Grid pixel (fractional) shown at the centre of the container. */
  cx: number;
  cy: number;
}

export interface Viewport {
  /** Container size in CSS pixels. */
  width: number;
  height: number;
  /** Grid pixels per side. */
  n: number;
}

export function defaultView(n: number): ViewState {
  const c = (n - 1) / 2;
  return { zoom: 1, cx: c, cy: c };
}

/** Side of the fitted square in CSS pixels at zoom 1 (the image is kept square and centred). */
export function fitSide(vp: Viewport): number {
  return Math.max(1, Math.min(vp.width, vp.height));
}

/** CSS pixels per grid pixel. */
export function pixelScale(vp: Viewport, v: ViewState): number {
  return (fitSide(vp) * v.zoom) / Math.max(1, vp.n);
}

/** Keep zoom in range and the visible window inside the image (no panning off into empty space). */
export function clampView(vp: Viewport, v: ViewState): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(v.zoom) ? v.zoom : 1));
  const n = vp.n;
  const half = n / (2 * zoom); // half of the visible square in grid pixels
  const lo = -0.5 + half;
  const hi = n - 0.5 - half;
  const c = (n - 1) / 2;
  const cl = (x: number) => (Number.isFinite(x) ? (lo > hi ? c : Math.min(hi, Math.max(lo, x))) : c);
  return { zoom, cx: cl(v.cx), cy: cl(v.cy) };
}

/** Grid pixel (i, j) -> screen CSS pixel (x right, y down). Pixel centres are at integer i, j. */
export function gridToScreen(vp: Viewport, v: ViewState, i: number, j: number): [number, number] {
  const p = pixelScale(vp, v);
  return [vp.width / 2 + (i - v.cx) * p, vp.height / 2 - (j - v.cy) * p];
}

/** Screen CSS pixel -> fractional grid pixel. */
export function screenToGrid(vp: Viewport, v: ViewState, x: number, y: number): [number, number] {
  const p = pixelScale(vp, v);
  return [v.cx + (x - vp.width / 2) / p, v.cy - (y - vp.height / 2) / p];
}

/** Zoom by `factor` keeping the grid point under screen point (x, y) fixed. */
export function zoomAbout(vp: Viewport, v: ViewState, factor: number, x: number, y: number): ViewState {
  const [gi, gj] = screenToGrid(vp, v, x, y);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const p = (fitSide(vp) * zoom) / Math.max(1, vp.n);
  return clampView(vp, { zoom, cx: gi - (x - vp.width / 2) / p, cy: gj + (y - vp.height / 2) / p });
}

/** Pan by a screen displacement (dx, dy) in CSS pixels (drag direction = image moves with the pointer). */
export function panBy(vp: Viewport, v: ViewState, dx: number, dy: number): ViewState {
  const p = pixelScale(vp, v);
  return clampView(vp, { zoom: v.zoom, cx: v.cx - dx / p, cy: v.cy + dy / p });
}

/** Orthographic camera bounds in grid-pixel world units (world x = i, world y = j). */
export function cameraBounds(vp: Viewport, v: ViewState): { left: number; right: number; top: number; bottom: number } {
  const p = pixelScale(vp, v);
  const hw = vp.width / (2 * p);
  const hh = vp.height / (2 * p);
  return { left: v.cx - hw, right: v.cx + hw, bottom: v.cy - hh, top: v.cy + hh };
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
