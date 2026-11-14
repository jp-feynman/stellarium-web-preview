// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// GLSL for the blink stage. three.js compiles ShaderMaterial as GLSL ES 3.00 on WebGL2, so texelFetch
// and asinh are available. The arithmetic mirrors stretch.ts (CPU thumbnails) line for line.
//
// Frames are float textures of surface brightness. NaN ("no data") is replaced on upload by -1e30
// because NaN comparisons are not reliable on all GPUs; any value below -1e29 is drawn as a hatch.

export const VIEW_SINGLE = 0;
export const VIEW_BLEND = 1;
export const VIEW_DIFFERENCE = 2;
export const VIEW_RGB = 3;

export const STRETCH_MODE_CODE: Record<'linear' | 'sqrt' | 'log' | 'asinh', number> = {
  linear: 0,
  sqrt: 1,
  log: 2,
  asinh: 3,
};

export const BLINK_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const BLINK_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;

varying vec2 vUv;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uTexC;
uniform sampler2D uLut;      // 256 x 1 colour map of the current stretch
uniform sampler2D uDivLut;   // 256 x 1 diverging map for difference mode
uniform float uN;            // grid pixels per side
uniform float uLo;
uniform float uHi;
uniform int uStretchMode;    // 0 linear, 1 sqrt, 2 log, 3 asinh
uniform float uQ;
uniform bool uInvert;
uniform int uView;           // 0 single, 1 blend, 2 difference, 3 rgb
uniform float uMix;
uniform bool uLinear;        // bilinear sampling (otherwise nearest: one grid pixel = one square)
uniform float uDpr;
uniform vec3 uHatchDark;
uniform vec3 uHatchLight;

const float NO_DATA = -1.0e29;
const float LOG_A = 1000.0;

bool missing(float v) { return v < NO_DATA; }

float fetchAt(sampler2D t, ivec2 p) {
  ivec2 q = clamp(p, ivec2(0), ivec2(int(uN) - 1));
  return texelFetch(t, q, 0).r;
}

// Sample one frame. Nearest by default. The bilinear option is done by hand so that "no data"
// neighbours are skipped instead of being averaged in as -1e30.
float sampleFrame(sampler2D t) {
  vec2 g = vUv * uN;
  ivec2 nearest = ivec2(floor(g));
  float v0 = fetchAt(t, nearest);
  if (!uLinear || missing(v0)) return v0;
  vec2 c = g - 0.5;
  ivec2 b = ivec2(floor(c));
  vec2 f = c - vec2(b);
  float sum = 0.0;
  float wsum = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      float v = fetchAt(t, b + ivec2(dx, dy));
      float w = (dx == 0 ? 1.0 - f.x : f.x) * (dy == 0 ? 1.0 - f.y : f.y);
      if (!missing(v)) { sum += w * v; wsum += w; }
    }
  }
  return wsum > 0.0 ? sum / wsum : v0;
}

float curve(float u) {
  float x = clamp(u, 0.0, 1.0);
  if (uStretchMode == 0) return x;
  if (uStretchMode == 1) return sqrt(x);
  if (uStretchMode == 2) return log(1.0 + LOG_A * x) / log(1.0 + LOG_A);
  return uQ > 1.0e-6 ? asinh(uQ * x) / asinh(uQ) : x;
}

float level(float v) {
  float span = uHi - uLo;
  float u = span != 0.0 ? (v - uLo) / span : (v >= uHi ? 1.0 : 0.0);
  float t = curve(u);
  return uInvert ? 1.0 - t : t;
}

vec3 lut(sampler2D m, float t) {
  return texture(m, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
}

vec3 hatch() {
  // Diagonal stripes in screen space: stays the same size at every zoom level.
  float s = mod(gl_FragCoord.x + gl_FragCoord.y, 8.0 * uDpr);
  return s < 3.0 * uDpr ? uHatchLight : uHatchDark;
}

vec3 colourOf(float v) {
  return missing(v) ? hatch() : lut(uLut, level(v));
}

void main() {
  vec3 col;
  if (uView == 1) {
    // Cross-fade the displayed colours of frames a and b.
    col = mix(colourOf(sampleFrame(uTexA)), colourOf(sampleFrame(uTexB)), clamp(uMix, 0.0, 1.0));
  } else if (uView == 2) {
    float a = sampleFrame(uTexA);
    float b = sampleFrame(uTexB);
    if (missing(a) || missing(b)) {
      col = hatch();
    } else {
      float r = abs(uHi) > 0.0 ? abs(uHi) : 1.0;
      float x = (a - b) / r;
      float t = 0.5 + 0.5 * sign(x) * curve(abs(x));
      col = lut(uDivLut, t);
    }
  } else if (uView == 3) {
    float r = sampleFrame(uTexA);
    float g = sampleFrame(uTexB);
    float b = sampleFrame(uTexC);
    if (missing(r) || missing(g) || missing(b)) {
      col = hatch();
    } else {
      // Lupton et al. (2004): one asinh of the mean intensity scales all three channels, so colours survive.
      float span = uHi - uLo != 0.0 ? uHi - uLo : 1.0;
      vec3 x = max(vec3(r, g, b) - uLo, 0.0) / span;
      float I = (x.r + x.g + x.b) / 3.0;
      if (I <= 0.0) {
        col = vec3(0.0);
      } else {
        float f = uQ > 1.0e-6 ? asinh(uQ * I) / (asinh(uQ) * I) : 1.0;
        vec3 c = x * f;
        float m = max(c.r, max(c.g, c.b));
        if (m > 1.0) c /= m;
        col = uInvert ? 1.0 - c : c;
      }
    }
  } else {
    col = colourOf(sampleFrame(uTexA));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
