// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// CubeView: the SPHEREx data as a 3D stack. Every SkyFrame becomes one square slice (north up, east
// left when seen from the front), and the slices are piled up along a third axis: time (one visit
// after another, with a visible gap for the six months between visits) or wavelength (blue to red).
//
// Dark sky is transparent and sources glow, so the stack reads like a block of glass with light inside:
//  - a fixed star is a straight line parallel to the stack axis,
//  - a moving object (asteroid, nearby brown dwarf, "Planet X") is a slanted or kinked line,
//  - a variable star is a line whose brightness changes along its length,
//  - in wavelength mode a cold object only lights up at the red (long-wavelength) end.
//
// Coordinates inside the scene: a slice spans x, y in [-0.5, 0.5]; grid column 0 (east) is at x = -0.5,
// grid row 0 (south) at y = -0.5; the stack runs along +z, latest / reddest slice nearest the default
// front camera. Rendering is on demand (only when something changes), not a continuous loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FrameMeta, SkyFrame, SkyGrid, Stretch } from '../core/types';
import { mjdToIsoDate } from '../core/types';
import { gridPixToSky, skyToGridPix } from '../core/wcs';
import { computeLayout, mjdToStackPos, type CubeAxis, type CubeLayout } from './cube/layout';
import { CUBE_FRAGMENT_SHADER, CUBE_VERTEX_SHADER, cubeAlpha, cubeLevel, packLayers, STRETCH_MODE_INDEX } from './cube/stretch';
import { LabelLayer } from './cube/labels';

export type { CubeAxis } from './cube/layout';

export interface CubeTrack {
  /** Polyline points [ra, dec, mjd] (degrees, degrees, MJD UTC). */
  path: [number, number, number][];
  color?: string;
  label?: string;
}

/** Payload of the 'hover' event; null when the pointer leaves the stack. */
export interface CubeHoverInfo {
  /** Position of the slice along the stack (0 = first / earliest / bluest). */
  slice: number;
  /** Index of the frame in the array given to setFrames. */
  frameIndex: number;
  label: string;
  meta: FrameMeta;
  /** Grid pixel under the pointer (column 0 = east, row 0 = south) and its value (MJy/sr, NaN = no data). */
  i: number;
  j: number;
  value: number;
  ra: number;
  dec: number;
}

export type CubeViewPreset = 'oblique' | 'front' | 'side' | 'top';

type HoverCallback = (payload: CubeHoverInfo | null) => void;

/** Camera directions (from the stack centre) of the view presets. */
const PRESET_DIRS: Record<CubeViewPreset, [number, number, number]> = {
  // From the east side, slightly above and in front: the stack recedes to the upper right.
  oblique: [-1.15, 0.55, 1.0],
  // Looking straight down the stack axis: north up, east left, as on a sky chart.
  front: [0, 0, 1],
  // Mostly from the east side (time or wavelength runs left to right, north up), turned a little
  // towards the front so the slices are not seen exactly edge-on (they have no thickness).
  side: [-1, 0.1, 0.42],
  top: [0, 1, 0.02],
};

/** Field of view per preset (degrees). Narrow = almost no perspective, so the front view is a true sky chart. */
const PRESET_FOV: Record<CubeViewPreset, number> = { oblique: 30, front: 4, side: 12, top: 8 };

const DEFAULT_STRETCH: Stretch = { lo: 0, hi: 1, mode: 'asinh', q: 10, invert: false, colormap: 'gray' };

interface Palette {
  bg: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  time: string;
  wave: string;
  font: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#080c16'),
    text: v('--text', '#e8edf7'),
    muted: v('--muted', '#93a0b8'),
    border: v('--border', '#26324a'),
    accent: v('--accent', '#7aa2ff'),
    time: v('--accent-time', '#ffb454'),
    wave: v('--accent-wave', '#5ad1e6'),
    font: v('--font', 'system-ui, sans-serif'),
  };
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2');
    if (!ctx) return false;
    ctx.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface SliceChunk {
  first: number;
  count: number;
  texture: THREE.DataArrayTexture;
  material: THREE.ShaderMaterial;
  mesh: THREE.InstancedMesh;
}

interface GlState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  volume: THREE.Group;
  tracks: THREE.Group;
  plane: THREE.PlaneGeometry;
  highlight: THREE.LineLoop;
  gizmoScene: THREE.Scene;
  gizmoCamera: THREE.OrthographicCamera;
  maxLayers: number;
}

const GIZMO_PX = 116;
const GIZMO_MARGIN = 6;

export class CubeView {
  private readonly container: HTMLElement;
  private readonly palette: Palette;
  private g: GlState | null = null;
  private labels: LabelLayer | null = null;
  private gizmoLabels: LabelLayer | null = null;
  private tooltip: HTMLDivElement | null = null;
  private message: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private raf = 0;
  private width = 1;
  private height = 1;

  private frames: SkyFrame[] = [];
  private axis: CubeAxis = 'time';
  private layout: CubeLayout = computeLayout([], 'time');
  private grid: SkyGrid | null = null;
  private depth = 1;
  private chunks: SliceChunk[] = [];
  private tracksSpec: CubeTrack[] = [];
  private stretch: Stretch = { ...DEFAULT_STRETCH };
  private preset: CubeViewPreset = 'oblique';
  private fittedDepth = -1;
  private hoverSlice = -1;
  private hoverCbs = new Set<HoverCallback>();
  private dragging = false;

  /** Uniforms shared by every slice material (one stretch for the whole stack). */
  private readonly shared = {
    uLo: { value: 0 },
    uHi: { value: 1 },
    uQ: { value: 10 },
    uMode: { value: 3 },
    uInvert: { value: false },
    uGain: { value: 0.6 },
    uHighlight: { value: -1 },
    uHighlightColor: { value: new THREE.Color('#7aa2ff') },
  };

  constructor(container: HTMLElement) {
    this.container = container;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.palette = readPalette(container);
    this.shared.uHighlightColor.value.set(this.palette.accent);

    if (!hasWebGL2()) {
      this.showMessage('The 3D cube view needs WebGL 2, which this browser does not offer. The blink view still works.');
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      this.showMessage('The 3D cube view could not start WebGL. The blink view still works.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.autoClear = false;
    renderer.setClearColor(new THREE.Color(this.palette.bg), 1);
    const canvas = renderer.domElement;
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', this.requestRender);
    controls.addEventListener('start', this.onControlStart);
    controls.addEventListener('end', this.onControlEnd);

    const volume = new THREE.Group();
    const tracks = new THREE.Group();
    scene.add(volume, tracks);

    const highlight = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.5, -0.5, 0),
        new THREE.Vector3(0.5, -0.5, 0),
        new THREE.Vector3(0.5, 0.5, 0),
        new THREE.Vector3(-0.5, 0.5, 0),
      ]),
      new THREE.LineBasicMaterial({ color: this.palette.accent, transparent: true, opacity: 0.95 }),
    );
    highlight.visible = false;
    scene.add(highlight);

    const gizmoScene = new THREE.Scene();
    const gizmoCamera = new THREE.OrthographicCamera(-1.55, 1.55, 1.55, -1.55, 0.1, 20);

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const maxLayers = Math.max(1, Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) || 256);

    this.g = { renderer, scene, camera, controls, volume, tracks, plane: new THREE.PlaneGeometry(1, 1), highlight, gizmoScene, gizmoCamera, maxLayers };
    this.labels = new LabelLayer(container, 'cube-view-labels');
    this.gizmoLabels = new LabelLayer(container, 'cube-view-gizmo-labels');
    this.buildGizmo();

    this.tooltip = document.createElement('div');
    Object.assign(this.tooltip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
      maxWidth: '340px',
      padding: '6px 8px',
      borderRadius: 'var(--radius-sm, 6px)',
      background: 'var(--panel, #111827)',
      border: '1px solid var(--border, #26324a)',
      color: 'var(--text, #e8edf7)',
      font: '12px var(--font, system-ui, sans-serif)',
      lineHeight: '1.4',
      boxShadow: 'var(--shadow, 0 6px 24px rgba(0,0,0,0.35))',
      zIndex: '2',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.tooltip);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.setStretch(this.stretch);
    this.resize();
    this.fit(this.preset);
  }

  /** True when WebGL is running (false: a plain-text notice is shown instead and every call is a no-op). */
  get available(): boolean {
    return this.g !== null;
  }

  setFrames(frames: SkyFrame[], axis: 'time' | 'wavelength'): void {
    this.axis = axis;
    this.clearSlices();
    const g = this.g;
    if (!g) return;
    const n = frames[0]?.grid.n ?? 0;
    // All slices must share one grid; anything else cannot be stacked pixel for pixel.
    const usable = frames.filter((f) => f.grid.n === n && f.data.length === n * n);
    if (usable.length < frames.length) {
      console.warn(`CubeView: ${frames.length - usable.length} frame(s) skipped because their grid differs from the first frame's.`);
    }
    this.frames = usable;
    this.grid = usable[0]?.grid ?? null;
    this.layout = computeLayout(usable, axis);
    const count = usable.length;
    this.hideMessage();
    if (count === 0) {
      this.showMessage('No frames to show in the cube yet.');
      this.requestRender();
      return;
    }

    // Depth of the stack in slice widths: deep enough to separate slices, never a long thin rod.
    this.depth = Math.min(2.2, Math.max(0.9, 0.05 * count));
    const zOf = (k: number) => (this.layout.pos[k] - 0.5) * this.depth;

    const m = new THREE.Matrix4();
    for (let first = 0; first < count; first += g.maxLayers) {
      const c = Math.min(g.maxLayers, count - first);
      const texture = new THREE.DataArrayTexture(packLayers(usable, this.layout.order, first, c, n), n, n, c);
      texture.format = THREE.RedFormat;
      texture.type = THREE.FloatType;
      // Nearest: one texel per native grid pixel, no blurring of faint sources.
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      const material = new THREE.ShaderMaterial({
        uniforms: { ...this.shared, uTex: { value: texture }, uOffset: { value: first } },
        vertexShader: CUBE_VERTEX_SHADER,
        fragmentShader: CUBE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.applyBlending(material);
      const mesh = new THREE.InstancedMesh(g.plane, material, c);
      for (let L = 0; L < c; L++) {
        m.makeTranslation(0, 0, zOf(first + L));
        mesh.setMatrixAt(L, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.computeBoundingSphere();
      mesh.userData.first = first;
      g.volume.add(mesh);
      this.chunks.push({ first, count: c, texture, material, mesh });
    }

    this.buildFrameLines(zOf);
    this.buildAxisLabels();
    this.rebuildTracks();
    if (Math.abs(this.fittedDepth - this.depth) > 1e-6) this.fit(this.preset);
    this.requestRender();
  }

  setStretch(s: Stretch): void {
    this.stretch = { ...s };
    const u = this.shared;
    u.uLo.value = s.lo;
    u.uHi.value = s.hi;
    u.uQ.value = s.q;
    u.uMode.value = STRETCH_MODE_INDEX[s.mode] ?? 3;
    u.uInvert.value = !!s.invert;
    for (const c of this.chunks) this.applyBlending(c.material);
    if (this.g) {
      this.g.renderer.setClearColor(new THREE.Color(s.invert ? this.palette.text : this.palette.bg), 1);
      this.buildGizmo();
    }
    this.requestRender();
  }

  setTracks(tracks: { path: [number, number, number][]; color?: string; label?: string }[]): void {
    this.tracksSpec = tracks.map((t) => ({ ...t, path: t.path.map((p) => [p[0], p[1], p[2]] as [number, number, number]) }));
    this.rebuildTracks();
    this.requestRender();
  }

  /** Subscribe to hover: the slice and pixel under the pointer, or null. Returns an unsubscribe function. */
  on(event: 'hover', cb: HoverCallback): () => void {
    if (event !== 'hover') return () => undefined;
    this.hoverCbs.add(cb);
    return () => this.hoverCbs.delete(cb);
  }

  /** Move the camera to a preset view and fit the stack. */
  setView(preset: CubeViewPreset): void {
    this.preset = preset;
    this.fit(preset);
  }

  resetView(): void {
    this.fit(this.preset);
  }

  resize(): void {
    const g = this.g;
    if (!g) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    g.renderer.setSize(w, h, false);
    g.camera.aspect = w / h;
    g.camera.updateProjectionMatrix();
    this.requestRender();
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.hoverCbs.clear();
    this.clearSlices();
    this.clearTracks();
    const g = this.g;
    if (g) {
      const canvas = g.renderer.domElement;
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      g.controls.removeEventListener('change', this.requestRender);
      g.controls.removeEventListener('start', this.onControlStart);
      g.controls.removeEventListener('end', this.onControlEnd);
      g.controls.dispose();
      g.plane.dispose();
      disposeObject(g.highlight);
      disposeObject(g.gizmoScene);
      g.renderer.dispose();
      canvas.remove();
      this.g = null;
    }
    this.labels?.dispose();
    this.gizmoLabels?.dispose();
    this.labels = this.gizmoLabels = null;
    this.tooltip?.remove();
    this.tooltip = null;
    this.message?.remove();
    this.message = null;
    this.frames = [];
  }

  // ---------------------------------------------------------------- internals

  private requestRender = (): void => {
    if (!this.g || this.raf) return;
    this.raf = requestAnimationFrame(this.render);
  };

  private render = (): void => {
    this.raf = 0;
    const g = this.g;
    if (!g) return;
    const { renderer, camera } = g;
    const w = this.width;
    const h = this.height;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(g.scene, camera);

    // Axis gizmo in the lower-left corner, turning with the main camera.
    const dir = new THREE.Vector3().subVectors(camera.position, g.controls.target).normalize();
    g.gizmoCamera.position.copy(dir.multiplyScalar(5));
    g.gizmoCamera.quaternion.copy(camera.quaternion);
    g.gizmoCamera.updateMatrixWorld();
    renderer.setScissorTest(true);
    renderer.setScissor(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_PX, GIZMO_PX);
    renderer.setViewport(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_PX, GIZMO_PX);
    renderer.clearDepth();
    renderer.render(g.gizmoScene, g.gizmoCamera);
    renderer.setScissorTest(false);

    this.labels?.update(camera, 0, 0, w, h);
    this.gizmoLabels?.update(g.gizmoCamera, GIZMO_MARGIN, h - GIZMO_MARGIN - GIZMO_PX, GIZMO_PX, GIZMO_PX);
  };

  private axisColor(): string {
    return this.axis === 'time' ? this.palette.time : this.palette.wave;
  }

  private applyBlending(material: THREE.ShaderMaterial): void {
    if (this.stretch.invert) {
      // Black ink on a light background: dst * (1 - a) is order-independent too.
      material.blending = THREE.NormalBlending;
    } else {
      // Additive glow: dst += colour * alpha, independent of drawing order.
      material.blending = THREE.CustomBlending;
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = THREE.SrcAlphaFactor;
      material.blendDst = THREE.OneFactor;
    }
    material.needsUpdate = true;
  }

  private fit(preset: CubeViewPreset): void {
    const g = this.g;
    if (!g) return;
    const d = PRESET_DIRS[preset];
    const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    // Bounding sphere of the stack (slices are 1 x 1), with a little room for labels.
    const r = Math.sqrt(0.5 + (this.depth / 2) ** 2);
    const vfov = (PRESET_FOV[preset] * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * g.camera.aspect);
    // Narrow containers need extra room for the axis labels beside the stack.
    const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * (g.camera.aspect < 1.4 ? 1.12 : 0.92);
    g.camera.fov = PRESET_FOV[preset];
    g.camera.up.set(0, 1, 0);
    g.camera.position.copy(dir.multiplyScalar(dist));
    g.camera.near = dist / 50;
    g.camera.far = dist * 20;
    g.camera.updateProjectionMatrix();
    g.controls.target.set(0, 0, 0);
    g.controls.update();
    this.fittedDepth = this.depth;
    this.requestRender();
  }

  private buildGizmo(): void {
    const g = this.g;
    if (!g || !this.gizmoLabels) return;
    disposeObject(g.gizmoScene);
    g.gizmoScene.clear();
    this.gizmoLabels.clear();
    const ink = this.stretch.invert ? this.palette.bg : this.palette.text;
    const axes: { dir: [number, number, number]; color: string; text: string }[] = [
      // East is towards grid column 0, which sits on the left (-x) when seen from the front.
      { dir: [-1, 0, 0], color: ink, text: 'East' },
      { dir: [0, 1, 0], color: ink, text: 'North' },
      { dir: [0, 0, 1], color: this.axisColor(), text: this.axis === 'time' ? 'Time' : 'Wavelength' },
    ];
    for (const a of axes) {
      const v = new THREE.Vector3(...a.dir);
      g.gizmoScene.add(new THREE.ArrowHelper(v, new THREE.Vector3(0, 0, 0), 0.95, new THREE.Color(a.color), 0.28, 0.14));
      // Labels sit on a dark pill, so they keep the light text colour even when the arrows turn dark.
      const labelColor = a.color === ink ? this.palette.text : a.color;
      this.gizmoLabels.add(a.text, v.clone().multiplyScalar(1.3), { color: labelColor, size: 11, weight: 600 });
    }
  }

  private buildFrameLines(zOf: (k: number) => number): void {
    const g = this.g;
    if (!g) return;
    const count = this.layout.order.length;
    const h = 0.5;
    const D = this.depth / 2;

    // Faint outline of every slice: shows the sampling of the axis (and the gaps between visits).
    const pts: number[] = [];
    for (let k = 0; k < count; k++) {
      const z = zOf(k);
      pts.push(-h, -h, z, h, -h, z, h, -h, z, h, h, z, h, h, z, -h, h, z, -h, h, z, -h, -h, z);
    }
    const outline = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: this.axisColor(), transparent: true, opacity: count > 80 ? 0.08 : 0.16, depthWrite: false }),
    );
    outline.name = 'slice-outlines';
    g.volume.add(outline);

    // Edges of the whole stack along the axis.
    const e: number[] = [];
    for (const [x, y] of [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ]) {
      e.push(x, y, -D, x, y, D);
    }
    const edges = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(e, 3)),
      new THREE.LineBasicMaterial({ color: this.palette.border, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    edges.name = 'stack-edges';
    g.volume.add(edges);

    // Tick marks for the labelled positions, on the lower east edge.
    const t: number[] = [];
    for (const tick of this.layout.ticks) {
      const z = (tick.pos - 0.5) * this.depth;
      t.push(-h, -h, z, -h - 0.06, -h, z);
    }
    if (this.axis === 'time') {
      // Bracket each visit along the lower east edge so the eye groups its slices.
      for (const gr of this.layout.groups) {
        t.push(-h - 0.03, -h, zOf(gr.first), -h - 0.03, -h, zOf(gr.last));
      }
    }
    const ticks = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(t, 3)),
      new THREE.LineBasicMaterial({ color: this.axisColor() }),
    );
    ticks.name = 'axis-ticks';
    g.volume.add(ticks);
  }

  private buildAxisLabels(): void {
    const L = this.labels;
    if (!L) return;
    L.clear();
    const color = this.axisColor();
    for (const tick of this.layout.ticks) {
      const z = (tick.pos - 0.5) * this.depth;
      L.add(tick.text, new THREE.Vector3(-0.56, -0.5, z), { color, align: 'left', dx: -4, weight: 600 });
    }
    // Name the axis ends so the direction of the stack is never ambiguous.
    const first = this.axis === 'time' ? 'earliest' : 'bluest';
    const last = this.axis === 'time' ? 'latest' : 'reddest';
    L.add(first, new THREE.Vector3(-0.5, 0.5, -this.depth / 2), { color, align: 'left', dx: -6, dy: -8, size: 11 });
    L.add(last, new THREE.Vector3(-0.5, 0.5, this.depth / 2), { color, align: 'left', dx: -6, dy: -8, size: 11 });
    this.buildGizmo();
  }

  private clearSlices(): void {
    const g = this.g;
    for (const c of this.chunks) {
      c.texture.dispose();
      c.material.dispose();
      c.mesh.dispose();
      c.mesh.removeFromParent();
    }
    this.chunks = [];
    if (g) {
      for (const child of [...g.volume.children]) {
        disposeObject(child);
        child.removeFromParent();
      }
      g.highlight.visible = false;
    }
    this.shared.uHighlight.value = -1;
    this.hoverSlice = -1;
    this.labels?.clear();
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  private clearTracks(): void {
    const g = this.g;
    if (!g) return;
    for (const child of [...g.tracks.children]) {
      disposeObject(child);
      child.removeFromParent();
    }
  }

  private trackLabels: ReturnType<LabelLayer['add']>[] = [];

  private rebuildTracks(): void {
    this.clearTracks();
    for (const l of this.trackLabels) l.el.remove();
    this.trackLabels = [];
    const g = this.g;
    const grid = this.grid;
    // Tracks are (ra, dec, time) paths: they have no meaning on a wavelength axis.
    if (!g || !grid || this.axis !== 'time' || this.frames.length === 0) return;
    const n = grid.n;
    for (const tr of this.tracksSpec) {
      const pts: THREE.Vector3[] = [];
      for (const [ra, dec, mjd] of tr.path) {
        if (![ra, dec, mjd].every(Number.isFinite)) continue;
        const [i, j] = skyToGridPix(grid, ra, dec);
        if (!Number.isFinite(i) || !Number.isFinite(j)) continue;
        const z = (mjdToStackPos(this.layout, this.frames, mjd) - 0.5) * this.depth;
        pts.push(new THREE.Vector3((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5, z));
      }
      if (pts.length < 2) continue;
      const color = tr.color ?? this.palette.accent;
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let k = 1; k < pts.length; k++) path.add(new THREE.LineCurve3(pts[k - 1], pts[k]));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(path, Math.min(2000, 12 * (pts.length - 1)), 0.0045, 6, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
      );
      tube.name = 'track';
      g.tracks.add(tube);
      if (tr.label && this.labels) {
        this.trackLabels.push(this.labels.add(tr.label, pts[pts.length - 1], { color, align: 'right', dx: 8, dy: -8, weight: 600 }));
      }
    }
  }

  private onControlStart = (): void => {
    this.dragging = true;
    this.setHover(null, 0, 0);
  };

  private onControlEnd = (): void => {
    this.dragging = false;
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.showMessage('The graphics context was lost. Reload the page to restore the 3D view.');
  };

  private raycaster = new THREE.Raycaster();

  private onPointerMove = (ev: PointerEvent): void => {
    const g = this.g;
    if (!g || this.dragging || this.chunks.length === 0 || !this.grid) return;
    const rect = g.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, g.camera);
    const hits = this.raycaster.intersectObjects(
      this.chunks.map((c) => c.mesh),
      false,
    );
    const n = this.grid.n;
    // Prefer the nearest slice where the pointer is on a visible (glowing) pixel; else the nearest slice.
    let best: { slice: number; i: number; j: number } | null = null;
    for (const h of hits) {
      if (h.instanceId === undefined || !h.uv) continue;
      const slice = (h.object.userData.first as number) + h.instanceId;
      const i = Math.min(n - 1, Math.max(0, Math.floor(h.uv.x * n)));
      const j = Math.min(n - 1, Math.max(0, Math.floor(h.uv.y * n)));
      const cand = { slice, i, j };
      if (!best) best = cand;
      const v = this.frames[this.layout.order[slice]].data[j * n + i];
      if (cubeAlpha(cubeLevel(v, this.stretch)) > 0.3) {
        best = cand;
        break;
      }
    }
    if (!best) this.setHover(null, 0, 0);
    else this.setHover(best, ev.clientX - rect.left, ev.clientY - rect.top);
  };

  private onPointerLeave = (): void => {
    this.setHover(null, 0, 0);
  };

  private setHover(hit: { slice: number; i: number; j: number } | null, px: number, py: number): void {
    const g = this.g;
    if (!g) return;
    if (!hit) {
      if (this.hoverSlice !== -1) {
        this.hoverSlice = -1;
        this.shared.uHighlight.value = -1;
        g.highlight.visible = false;
        if (this.tooltip) this.tooltip.style.display = 'none';
        for (const cb of this.hoverCbs) cb(null);
        this.requestRender();
      }
      return;
    }
    const grid = this.grid!;
    const frameIndex = this.layout.order[hit.slice];
    const frame = this.frames[frameIndex];
    const value = frame.data[hit.j * grid.n + hit.i];
    const [ra, dec] = gridPixToSky(grid, hit.i, hit.j);
    if (hit.slice !== this.hoverSlice) {
      this.hoverSlice = hit.slice;
      this.shared.uHighlight.value = hit.slice;
      g.highlight.position.set(0, 0, (this.layout.pos[hit.slice] - 0.5) * this.depth);
      g.highlight.visible = true;
      this.requestRender();
    }
    if (this.tooltip) {
      const m = frame.meta;
      const tt = this.tooltip;
      tt.replaceChildren();
      const line = (text: string, color?: string, bold = false) => {
        const d = document.createElement('div');
        d.textContent = text;
        if (color) d.style.color = color;
        if (bold) d.style.fontWeight = '600';
        tt.appendChild(d);
      };
      line(m.label || `Frame ${frameIndex + 1}`, undefined, true);
      line(`${mjdToIsoDate(m.mjd)}  (MJD ${m.mjd.toFixed(3)})`, this.palette.time);
      line(`${m.wavelength.toFixed(3)} µm`, this.palette.wave);
      line(Number.isFinite(value) ? `pixel (${hit.i}, ${hit.j}): ${value.toPrecision(3)} MJy/sr` : `pixel (${hit.i}, ${hit.j}): no data`, this.palette.muted);
      tt.style.display = 'block';
      const left = Math.min(px + 14, this.width - 250);
      const top = py + 14 + 80 > this.height ? py - 90 : py + 14;
      tt.style.left = `${Math.max(4, left)}px`;
      tt.style.top = `${Math.max(4, top)}px`;
    }
    const payload: CubeHoverInfo = { slice: hit.slice, frameIndex, label: frame.meta.label, meta: frame.meta, i: hit.i, j: hit.j, value, ra, dec };
    for (const cb of this.hoverCbs) cb(payload);
  }

  private showMessage(text: string): void {
    if (!this.message) {
      this.message = document.createElement('div');
      Object.assign(this.message.style, {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px',
        color: 'var(--muted, #93a0b8)',
        font: '14px var(--font, system-ui, sans-serif)',
        pointerEvents: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      this.container.appendChild(this.message);
    }
    this.message.textContent = text;
    this.message.style.display = 'flex';
  }

  private hideMessage(): void {
    if (this.message) this.message.style.display = 'none';
  }
}

/** Free GPU memory held by an object tree (geometries and materials; textures of our slices are freed separately). */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const anyObj = o as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    if (anyObj.geometry && !(o instanceof THREE.InstancedMesh)) anyObj.geometry.dispose();
    const mat = anyObj.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
