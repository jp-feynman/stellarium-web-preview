// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Stretch arithmetic and GPU packing for the cube view. The curve is the same as the blink stage's
// (asinh / linear / sqrt / log with DS9's log exponent), so a source looks equally bright in both views.
// The cube adds one thing: an opacity curve. Dark sky becomes transparent and only pixels that the
// stretch lifts well above the sky stay visible, so sources read as glowing dots inside the volume.

import type { SkyFrame, Stretch } from '../../core/types';

/** Written in place of NaN on upload: shaders cannot test NaN reliably. Rendered fully transparent. */
export const CUBE_NO_DATA = -1e30;
export const CUBE_NO_DATA_THRESHOLD = -1e29;
/** DS9 log stretch exponent: level = log10(1 + a u) / log10(1 + a). */
export const CUBE_LOG_A = 1000;
/** Display level where pixels start to become visible, and where they are fully opaque. */
export const ALPHA_START = 0.12;
export const ALPHA_FULL = 0.7;

export const STRETCH_MODE_INDEX: Record<Stretch['mode'], number> = { linear: 0, sqrt: 1, log: 2, asinh: 3 };

/** Display level 0..1 of a value (before invert), or NaN for no data. Mirrors `level()` in the shader. */
export function cubeLevel(v: number, s: Stretch): number {
  if (!Number.isFinite(v) || v < CUBE_NO_DATA_THRESHOLD) return NaN;
  const span = s.hi - s.lo;
  const u = Math.min(1, Math.max(0, span !== 0 ? (v - s.lo) / span : v >= s.hi ? 1 : 0));
  switch (s.mode) {
    case 'linear':
      return u;
    case 'sqrt':
      return Math.sqrt(u);
    case 'log':
      return Math.log10(1 + CUBE_LOG_A * u) / Math.log10(1 + CUBE_LOG_A);
    case 'asinh':
    default:
      return s.q > 1e-6 ? Math.asinh(s.q * u) / Math.asinh(s.q) : u;
  }
}

/** Opacity of a pixel with display level t: 0 for sky, rising smoothly to 1 for sources. */
export function cubeAlpha(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const x = Math.min(1, Math.max(0, (t - ALPHA_START) / (ALPHA_FULL - ALPHA_START)));
  return x * x * (3 - 2 * x);
}

/**
 * Pack slices into one layer-major Float32Array for a DataArrayTexture: layer L holds the frame
 * order[first + L], texel (i, j) at L*n*n + j*n + i (row 0 = south, column 0 = east, exactly the
 * SkyFrame layout). NaN becomes CUBE_NO_DATA; frames of the wrong size become all no-data.
 */
export function packLayers(frames: SkyFrame[], order: number[], first: number, count: number, n: number): Float32Array<ArrayBuffer> {
  const plane = n * n;
  const out = new Float32Array(plane * count);
  for (let L = 0; L < count; L++) {
    const f = frames[order[first + L]];
    const base = L * plane;
    if (!f || f.data.length !== plane) {
      out.fill(CUBE_NO_DATA, base, base + plane);
      continue;
    }
    const d = f.data;
    for (let k = 0; k < plane; k++) {
      const v = d[k];
      out[base + k] = Number.isFinite(v) ? v : CUBE_NO_DATA;
    }
  }
  return out;
}

export const CUBE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
flat varying float vLayer;
void main() {
  vUv = uv;
  // One instance per slice: the instance number is the layer in the array texture.
  vLayer = float(gl_InstanceID);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const CUBE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2DArray uTex;
uniform float uLo;
uniform float uHi;
uniform float uQ;
uniform int uMode;
uniform bool uInvert;
uniform float uGain;
uniform float uOffset;
uniform float uHighlight;
uniform vec3 uHighlightColor;
varying vec2 vUv;
flat varying float vLayer;

float level(float v) {
  float span = uHi - uLo;
  float u = span != 0.0 ? (v - uLo) / span : (v >= uHi ? 1.0 : 0.0);
  u = clamp(u, 0.0, 1.0);
  if (uMode == 0) return u;
  if (uMode == 1) return sqrt(u);
  if (uMode == 2) return log(1.0 + ${CUBE_LOG_A.toFixed(1)} * u) / log(1.0 + ${CUBE_LOG_A.toFixed(1)});
  return uQ > 1e-6 ? asinh(uQ * u) / asinh(uQ) : u;
}

void main() {
  float raw = texture(uTex, vec3(vUv, vLayer)).r;
  bool hl = abs(vLayer + uOffset - uHighlight) < 0.5;
  // No data: fully transparent, even on the highlighted slice.
  if (raw < ${CUBE_NO_DATA_THRESHOLD.toExponential()}) discard;
  float t = level(raw);
  float a = smoothstep(${ALPHA_START.toFixed(3)}, ${ALPHA_FULL.toFixed(3)}, t) * uGain;
  if (uInvert) {
    // Light background, dark sources: black ink whose opacity follows the source brightness.
    vec3 c = vec3(0.0);
    if (hl) { c = mix(uHighlightColor * 0.45, vec3(0.0), a); a = max(a, 0.22); }
    if (a <= 0.002) discard;
    gl_FragColor = vec4(c, a);
  } else {
    // Additive glow: order-independent, so the slices never need sorting.
    vec3 c = vec3(t);
    if (hl) { c = vec3(t) + uHighlightColor * 0.22; a = max(a, 1.0); }
    if (a <= 0.002) discard;
    gl_FragColor = vec4(c, a);
  }
}
`;
