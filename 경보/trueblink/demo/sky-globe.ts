// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Demo for SkyGlobe: the five challenge targets as markers, a channel slider and a pick readout.
// URL parameters (used by e2e/sky-globe.mjs): ra, dec, fov, ch, base (HiPS base URL override).
import '../src/app/styles/tokens.css';
import { SkyGlobe, type GlobeMarker } from '../src/gl/SkyGlobe';
import { CHANNELS } from '../src/core/wave';

const TARGETS: GlobeMarker[] = [
  { id: 'barnard', label: "Barnard's Star", ra: 269.45, dec: 4.74 },
  { id: 'eps-indi-b', label: 'Epsilon Indi B', ra: 331.04, dec: -56.79 },
  { id: 'wise0855', label: 'WISE 0855-0714', ra: 133.78, dec: -7.24 },
  { id: 'rw-aur', label: 'RW Aurigae', ra: 76.96, dec: 30.4 },
  { id: 'r-dra', label: 'R Draconis', ra: 248.17, dec: 66.75 },
];

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return q.has(k) && Number.isFinite(v) ? v : d;
};

const el = (id: string) => document.getElementById(id)!;
const globe = new SkyGlobe(el('globe'), {
  baseUrl: q.get('base') ?? undefined,
  view: { ra: num('ra', 83.8), dec: num('dec', -1.2), fovDeg: num('fov', 60) },
  channel: num('ch', 21),
});
globe.setMarkers(TARGETS);

const fmt = (ra: number, dec: number) => `RA ${ra.toFixed(4)}°  Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(4)}°`;

globe.on('pick', (p) => {
  const name = p.markerId ? TARGETS.find((t) => t.id === p.markerId)?.label : undefined;
  el('pick').textContent = `Picked ${fmt(p.ra, p.dec)}${name ? `  (${name})` : ''}`;
});
globe.on('view', (v) => {
  el('view').textContent = `View ${fmt(v.ra, v.dec)}  FOV ${v.fovDeg.toFixed(1)}°`;
});

const slider = el('channel') as HTMLInputElement;
slider.value = String(num('ch', 21));
const showChannel = () => {
  const ch = Number(slider.value);
  const c = CHANNELS.find((x) => x.cubeChannel === ch);
  el('chanText').textContent = `${ch} · ${c ? c.wavelength.toFixed(3) : '?'} µm`;
  globe.setChannel(ch);
};
slider.addEventListener('input', showChannel);
showChannel();

for (const t of TARGETS) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.addEventListener('click', () => globe.lookAt({ ra: t.ra, dec: t.dec }, 5));
  el('targets').appendChild(b);
}

// For the headless check.
(window as unknown as { __globe: SkyGlobe }).__globe = globe;
