/* Stellarium Web Lab + SPHEREx v1.3.0 — SPDX-License-Identifier: AGPL-3.0-only */
/* Based on Stellarium Web Lab v1.2.0. Modified 2026-11-14 (AI-assisted, Claude): SPHEREx layer,
   TrueBlink link and ra/dec/spherex/name start parameters. See README.md, 변경 사항(AGPL 고지). */
import { capitals } from './capitals.js';
import { SpherexLayer, channelInfo, nearestUsableChannel } from './spherex.js';
import { BLANK_CHANNELS, USABLE_CHANNELS, formatWavelength, isUsableChannel } from './spherex-channels.js';

const $ = (selector) => document.querySelector(selector);
const rad = Math.PI / 180;
const base = new URL('../', import.meta.url);
const asset = (path) => new URL(path, base).href;
const presets = {
  seoul: { name: '서울', country: '대한민국', cityEnglish: 'Seoul', countryCode: 'KR', latitude: 37.5665, longitude: 126.9780, elevation: 38 },
  jinju: { name: '진주', country: '대한민국', cityEnglish: 'Jinju', countryCode: 'KR', latitude: 35.1806, longitude: 128.1076, elevation: 28 },
  busan: { name: '부산', country: '대한민국', cityEnglish: 'Busan', countryCode: 'KR', latitude: 35.1796, longitude: 129.0756, elevation: 30 },
};
for (const [id, place] of Object.entries(presets)) place.id = id;
const countryNamesEnglish = new Intl.DisplayNames(['en'], { type: 'region' });
const countryAliases = { AU: '호주', KR: '한국 South Korea', KP: '북한 North Korea', US: 'USA 미합중국', GB: 'UK', ZA: '남아공 남아프리카공화국', AE: 'UAE', SA: '사우디' };
const capitalLocations = capitals.map((capital) => ({ ...capital, name: `${capital.country} · ${capital.city}`, countryEnglish: countryNamesEnglish.of(capital.countryCode), aliases: countryAliases[capital.countryCode], elevation: capital.elevation ?? 0 }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const locations = new Map([...Object.values(presets), ...capitalLocations].map((place) => [place.id, place]));
const customStorageKey = 'stellarium-web-lab.custom-location';
let customLocation = { latitude: presets.seoul.latitude, longitude: presets.seoul.longitude };
try {
  const saved = JSON.parse(localStorage.getItem(customStorageKey));
  if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude) && Math.abs(saved.latitude) <= 90 && Math.abs(saved.longitude) <= 180) customLocation = saved;
} catch { /* Coordinates remain usable when browser storage is unavailable. */ }
const objects = [
  { name: '달', id: 'Moon', aliases: ['moon', '달'], type: '지구의 위성', fov: 6 },
  { name: '태양', id: 'Sun', aliases: ['sun', '태양', '해'], type: '항성', fov: 8 },
  { name: '수성', id: 'Mercury', aliases: ['mercury', '수성'], type: '행성', fov: 12 },
  { name: '금성', id: 'Venus', aliases: ['venus', '금성', '샛별'], type: '행성', fov: 12 },
  { name: '화성', id: 'Mars', aliases: ['mars', '화성'], type: '행성', fov: 12 },
  { name: '목성', id: 'Jupiter', aliases: ['jupiter', '목성'], type: '행성', fov: 8 },
  { name: '토성', id: 'Saturn', aliases: ['saturn', '토성'], type: '행성', fov: 8 },
  { name: '천왕성', id: 'Uranus', aliases: ['uranus', '천왕성'], type: '행성', fov: 12 },
  { name: '해왕성', id: 'Neptune', aliases: ['neptune', '해왕성'], type: '행성', fov: 12 },
  { name: '북극성', id: 'Polaris', aliases: ['polaris', '북극성'], type: '항성', fov: 24 },
  { name: '시리우스', id: 'Sirius', aliases: ['sirius', '시리우스'], type: '항성', fov: 24 },
  { name: '베가', id: 'Vega', aliases: ['vega', '베가', '직녀성'], type: '항성', fov: 24 },
  { name: '알타이르', id: 'Altair', aliases: ['altair', '알타이르', '견우성'], type: '항성', fov: 24 },
  { name: '베텔게우스', id: 'Betelgeuse', aliases: ['betelgeuse', '베텔게우스'], type: '항성', fov: 24 },
  { name: '안드로메다 은하', id: 'M 31', aliases: ['m31', 'm 31', 'andromeda', '안드로메다'], type: '은하 · M 31', fov: 8 },
  { name: '오리온 성운', id: 'M 42', aliases: ['m42', 'm 42', 'orion', '오리온 성운'], type: '성운 · M 42', fov: 5 },
  { name: '플레이아데스', id: 'M 45', aliases: ['m45', 'm 45', 'pleiades', '플레이아데스', '좀생이별'], type: '산개성단 · M 45', fov: 10 },
];
let stel;
let currentLocation = { ...presets.seoul };
const MAX_TIME_SPEED = 1_000_000;
const TIME_SPEED_HINT = '입력 후 Enter 또는 다른 칸 클릭 · 음수는 역방향';
let speedInputDirty = false;
let toastTimer;
let startupTimer;
let statusTimer;
let dssAdded = false;
let ready = false;
let timeInputDirty = false;
let coordinateMode = 'horizon';
let coordinateChangeId = 0;
let coordinateTransition = false;
let viewMode = 'sky';
let viewTransition = false;
let savedSkyView = null;
let spherex = null;
let spherexChannelTimer;
let trueBlinkRoot = document.querySelector('meta[name="trueblink-url"]')?.content || 'https://trueblink.pages.dev/';
let sharedTarget = null;
const MOLLWEIDE_PROJECTION = 5;
const normalize = (value) => value.toLocaleLowerCase().replace(/\s+/g, '').trim();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}

function toLocalInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fail(message, error) {
  ready = false;
  clearTimeout(startupTimer);
  clearInterval(statusTimer);
  for (const button of document.querySelectorAll('.view-controls button')) button.disabled = true;
  $('#loading-overlay').hidden = false;
  $('#loading-overlay').classList.add('error');
  $('#loading-message').textContent = message;
  $('#retry-button').hidden = false;
  $('#engine-status').textContent = '연결 확인 필요';
  $('#engine-status').dataset.state = 'error';
  $('#app-controls').disabled = true;
  if (error) console.error(error);
}

function changeLocation(location) {
  currentLocation = { ...location };
  stel.observer.latitude = location.latitude * rad;
  stel.observer.longitude = location.longitude * rad;
  stel.observer.elevation = location.elevation ?? 0;
  $('#latitude').value = String(location.latitude);
  $('#longitude').value = String(location.longitude);
  $('#location-status').textContent = `${location.name} · ${Math.abs(location.latitude).toFixed(2)}°${location.latitude >= 0 ? 'N' : 'S'} ${Math.abs(location.longitude).toFixed(2)}°${location.longitude >= 0 ? 'E' : 'W'}`;
}

function populateLocations(query = '') {
  const select = $('#location-preset');
  const previous = select.value || 'seoul';
  const match = (place) => !query || normalize([place.name, place.country, place.city, place.countryCode, place.cityEnglish, place.countryEnglish, place.aliases].filter(Boolean).join(' ')).includes(normalize(query));
  select.replaceChildren(new Option('사용자 위치 · 위도/경도 입력', 'custom'));
  const addGroup = (label, places) => {
    if (!places.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const place of places) group.append(new Option(place.name, place.id));
    select.append(group);
  };
  const nearby = Object.values(presets).filter(match);
  const matches = capitalLocations.filter(match);
  addGroup('빠른 위치 · 대한민국', nearby);
  addGroup('국가·지역별 수도', matches);
  const selected = locations.get(previous);
  if (selected && ![...nearby, ...matches].some((place) => place.id === previous)) addGroup('현재 선택한 위치', [selected]);
  select.value = previous;
  $('#location-search-status').textContent = query ? `${nearby.length + matches.length}개 위치 검색됨` : `국가·지역별 수도 ${capitalLocations.length}곳`;
}

function saveCustomLocation(latitude, longitude) {
  customLocation = { latitude, longitude };
  try { localStorage.setItem(customStorageKey, JSON.stringify(customLocation)); } catch { /* Storage is optional. */ }
}

function syncTime() {
  const date = stel.MJD2date(stel.observer.utc);
  $('#time-status').textContent = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZoneName: 'short',
  }).format(date);
  if (!timeInputDirty && document.activeElement !== $('#observation-time')) $('#observation-time').value = toLocalInput(date);
  $('#fov-status').textContent = `${(stel.core.fov / rad).toFixed(1)}°`;
  $('#map-fov').textContent = `${(stel.core.fov / rad).toFixed(1)}°`;
  syncCoordinates();
}

function centerDirection(frame) {
  return stel.convertFrame(stel.observer, 'VIEW', frame, [0, 0, -1, 0]);
}

function setFovImmediately(fov) {
  // The engine's duration=0 path leaves an older zoom animation active.
  // A near-instant target replaces it so startup/reset cannot snap back.
  stel.core.fov = fov;
  stel.zoomTo(fov, 0.001);
}

function formatRightAscension(angle) {
  // Round before splitting so a minute/second rollover never displays 60.
  const seconds = Math.round(stel.anp(angle) * 43200 / Math.PI) % 86400;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}h ${pad(Math.floor(seconds / 60) % 60)}m ${pad(seconds % 60)}s`;
}

function syncCoordinates() {
  const equatorial = coordinateMode === 'equatorial';
  const [longitude, latitude] = stel.c2s(centerDirection(equatorial ? 'ICRF' : 'OBSERVED'));
  $('#coordinate-longitude-label').textContent = equatorial ? '적경 RA' : '방위각 Az';
  $('#coordinate-latitude-label').textContent = equatorial ? '적위 Dec' : '고도 Alt';
  $('#coordinate-longitude').textContent = equatorial ? formatRightAscension(longitude) : `${(stel.anp(longitude) / rad).toFixed(3)}°`;
  $('#coordinate-latitude').textContent = `${latitude < 0 ? '−' : '+'}${Math.abs(latitude / rad).toFixed(3)}°`;
  $('#coordinate-reference').textContent = equatorial ? '화면 중심 · ICRF' : '화면 중심 · 지평 좌표';
}

async function setCoordinateMode(mode, { updateGrid = true } = {}) {
  if (coordinateTransition || !['horizon', 'equatorial'].includes(mode) || (viewMode === 'allsky' && mode !== 'equatorial')) return;
  coordinateTransition = true;
  syncViewControls();
  try {
    const changeId = ++coordinateChangeId;
    const direction = centerDirection('ICRF');
    // Stop a previous object-tracking animation before changing the mount axes.
    stel.core.lock = null;
    stel.lookAt(centerDirection('MOUNT'), 0);
    coordinateMode = mode;
    const equatorial = mode === 'equatorial';
    stel.core.mount_frame = equatorial ? stel.FRAME_ICRF : stel.FRAME_OBSERVED;
    $('#coordinate-system').value = mode;
    $('#equatorial-target').hidden = !equatorial;
    $('#center-marker').hidden = !equatorial;
    $('#toggle-coordinates').setAttribute('aria-pressed', String(equatorial));
    $('#toggle-coordinates').setAttribute('aria-label', equatorial ? '지평 좌표계로 전환' : '천구 좌표계로 전환');
    $('#coordinate-hint').textContent = equatorial
      ? '적경·적위 격자와 입력 좌표는 ICRF 기준입니다. 지평선 아래는 지표면을 끄고 보세요.'
      : '관측 위치의 지평선을 기준으로 방위각과 고도를 표시합니다.';
    if (updateGrid) {
      $('#layer-equatorial').checked = equatorial;
      $('#layer-azimuthal').checked = !equatorial;
      layer('equatorial', equatorial);
      layer('azimuthal', !equatorial);
    }
    // The engine refreshes its mount transform during the animation frame.
    // Keep the same celestial point centered after that transform is available.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (changeId !== coordinateChangeId) return;
    stel.lookAt(stel.convertFrame(stel.observer, 'ICRF', 'MOUNT', direction), 0);
    await new Promise(requestAnimationFrame);
    syncCoordinates();
  } finally {
    coordinateTransition = false;
    syncViewControls();
  }
}

function syncViewControls() {
  const allsky = viewMode === 'allsky';
  const busy = !ready || coordinateTransition || viewTransition;
  document.body.classList.toggle('allsky-view', allsky);
  $('#app-controls').disabled = busy;
  $('#sky-canvas').inert = busy;
  for (const button of document.querySelectorAll('.view-controls button, [data-view], #map-full-view')) button.disabled = busy;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === viewMode));
  $('#toggle-allsky').setAttribute('aria-pressed', String(allsky));
  $('#toggle-allsky').setAttribute('aria-label', allsky ? '하늘 보기로 돌아가기' : '전천 지도로 전환');
  $('#toggle-coordinates').disabled = busy || allsky;
  $('#toggle-ground').disabled = busy || allsky;
  $('#coordinate-system').disabled = allsky;
  $('#layer-landscape').disabled = allsky;
  $('#layer-atmosphere').disabled = allsky;
  $('#map-banner').hidden = !allsky;
  $('#reset-view').title = allsky ? '전천 지도 전체 보기' : '시야 초기화';
  $('#sky-hint').textContent = allsky ? '드래그로 지도 이동 · 스크롤로 확대 / 축소' : '드래그로 하늘 이동 · 스크롤로 확대 / 축소';
  if (allsky) $('#coordinate-hint').textContent = '360° 천구를 펼친 지도입니다. 적경·적위는 ICRF 기준이며, 지형과 대기는 숨깁니다.';
  fitSkyCanvas();
}

function fitSkyCanvas() {
  const canvas = $('#sky-canvas');
  const marker = $('#center-marker');
  const card = $('#spherex-panel');
  if (viewMode !== 'allsky') {
    for (const property of ['left', 'right', 'bottom']) card.style.removeProperty(property);
    for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height']) canvas.style.removeProperty(property);
    marker.style.removeProperty('left');
    marker.style.removeProperty('top');
    return;
  }
  const panelOpen = !document.body.classList.contains('panel-closed') && innerWidth > 760;
  const left = panelOpen ? $('#control-panel').getBoundingClientRect().right + 24 : 16;
  $('#map-banner').style.left = `${left}px`;
  const right = innerWidth < 760 ? 64 : 96;
  const top = $('.topbar').getBoundingClientRect().bottom + 96;
  let bottom = innerHeight - $('.observation-status').getBoundingClientRect().top + 24;
  // v1.3.0: the SPHEREx wavelength bar sits under the map instead of covering it.
  if (!card.hidden && getComputedStyle(card).display !== 'none') {
    Object.assign(card.style, { left: `${left}px`, right: `${right}px`, bottom: `${bottom - 12}px` });
    bottom += card.offsetHeight + 4;
  }
  const availableWidth = Math.max(80, innerWidth - left - right);
  const availableHeight = Math.max(40, innerHeight - top - bottom);
  // Mollweide's full-sky ellipse is 2:1. Fit it without cropping either pole.
  const width = Math.min(availableWidth, availableHeight * 2);
  const height = width / 2;
  const x = left + (availableWidth - width) / 2;
  const y = top + (availableHeight - height) / 2;
  Object.assign(canvas.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto', width: `${width}px`, height: `${height}px` });
  marker.style.left = `${x + width / 2}px`;
  marker.style.top = `${y + height / 2}px`;
}

async function setViewMode(mode) {
  if (viewTransition || coordinateTransition || !['sky', 'allsky'].includes(mode) || mode === viewMode) return;
  viewTransition = true;
  syncViewControls();
  try {
    if (mode === 'allsky') {
      savedSkyView = {
        coordinateMode, direction: centerDirection('ICRF'), fov: stel.core.fov, projection: stel.core.projection, cardinals: stel.core.cardinals.visible,
        layers: Object.fromEntries([...document.querySelectorAll('[data-layer]')].map((input) => [input.dataset.layer, input.checked])),
      };
      await setCoordinateMode('equatorial');
      viewMode = 'allsky';
      stel.core.projection = MOLLWEIDE_PROJECTION;
      stel.core.cardinals.visible = false;
      for (const name of ['landscape', 'atmosphere', 'azimuthal']) {
        $(`[data-layer="${name}"]`).checked = false;
        layer(name, false);
      }
      syncViewControls();
      resetView();
      if (innerWidth < 760) setPanel(false);
    } else {
      viewMode = 'sky';
      setFovImmediately(Math.min(savedSkyView.fov, 150 * rad));
      stel.core.projection = savedSkyView.projection;
      stel.core.cardinals.visible = savedSkyView.cardinals;
      await setCoordinateMode(savedSkyView.coordinateMode, { updateGrid: false });
      for (const [name, enabled] of Object.entries(savedSkyView.layers)) {
        $(`[data-layer="${name}"]`).checked = enabled;
        layer(name, enabled);
      }
      stel.lookAt(stel.convertFrame(stel.observer, 'ICRF', 'MOUNT', savedSkyView.direction), 0);
      setFovImmediately(Math.min(savedSkyView.fov, 150 * rad));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    syncTime();
  } finally {
    viewTransition = false;
    syncViewControls();
  }
}

function goToEquatorialCoordinates(event) {
  event.preventDefault();
  const ra = $('#target-ra').valueAsNumber;
  const dec = $('#target-dec').valueAsNumber;
  if (!Number.isFinite(ra) || ra < 0 || ra > 24 || !Number.isFinite(dec) || Math.abs(dec) > 90) {
    toast('적경은 0~24시간, 적위는 −90~+90°로 입력하세요.');
    return;
  }
  const direction = stel.s2c((ra % 24) * 15 * rad, dec * rad);
  stel.core.selection = null;
  stel.core.lock = null;
  // lookAt's direction follows the active mount, including equatorial mode.
  stel.lookAt(stel.convertFrame(stel.observer, 'ICRF', 'MOUNT', direction), 0.5);
  renderSelection();
  toast(`적경 ${ra % 24}h · 적위 ${dec}°로 이동합니다.`);
}

function setSpeed(speed) {
  if (!Number.isFinite(speed)) return;
  const limitedSpeed = Math.max(-MAX_TIME_SPEED, Math.min(MAX_TIME_SPEED, speed));
  speedInputDirty = false;
  $('#time-speed-input').value = String(limitedSpeed);
  $('#time-speed-input').removeAttribute('aria-invalid');
  $('#time-speed-hint').textContent = TIME_SPEED_HINT;
  stel.core.time_speed = limitedSpeed;
  syncSpeedControls();
}

function syncSpeedControls() {
  const speed = stel.core.time_speed;
  $('#time-backward').classList.toggle('is-active', speed < 0);
  $('#time-stop').setAttribute('aria-pressed', String(speed === 0));
  $('#time-forward').classList.toggle('is-active', speed > 0);
  $('#time-backward').disabled = speed <= -MAX_TIME_SPEED;
  $('#time-forward').disabled = speed >= MAX_TIME_SPEED;
  $('#time-state').textContent = speed === 0 ? '정지' : speed === 1 ? '실시간' : speed > 0 ? '정방향' : '역방향';
  const magnitude = Math.abs(speed);
  const multiplier = magnitude > 0 && magnitude < 0.001
    ? Number(magnitude.toPrecision(6)).toExponential()
    : magnitude.toLocaleString('ko-KR', { maximumSignificantDigits: 6 });
  $('#time-multiplier').textContent = `×${multiplier}`;
  $('#time-speed').title = `현재 시간 배속: ${speed}`;
  if (!speedInputDirty && document.activeElement !== $('#time-speed-input')) $('#time-speed-input').value = String(speed);
}

function applyTypedSpeed(reportError = true) {
  if (!ready) return;
  const input = $('#time-speed-input');
  const speed = input.valueAsNumber;
  if (!Number.isFinite(speed) || Math.abs(speed) > MAX_TIME_SPEED) {
    input.setAttribute('aria-invalid', 'true');
    $('#time-speed-hint').textContent = '배속은 −1,000,000~1,000,000 사이의 숫자로 입력하세요.';
    if (reportError) input.reportValidity();
    return;
  }
  setSpeed(speed);
}

function stepTimeSpeed(direction) {
  let speed = stel.core.time_speed;
  // Match Stellarium's 10-fold time-step controls through reverse, stop and +1.
  if (direction > 0) {
    if (speed >= 1) speed *= 10;
    else if (speed < -1) speed /= 10;
    else speed = speed >= 0 ? 1 : 0;
  } else {
    if (speed > 1) speed /= 10;
    else if (speed <= -1) speed *= 10;
    else speed = speed <= 0 ? -1 : 0;
  }
  setSpeed(speed);
}

function resetView() {
  ++coordinateChangeId;
  stel.core.selection = null;
  stel.core.lock = null;
  const direction = coordinateMode === 'equatorial'
    ? stel.convertFrame(stel.observer, 'ICRF', 'MOUNT', stel.s2c(0, 0))
    : stel.s2c(0, 15 * rad);
  stel.lookAt(direction, 0);
  if (viewMode === 'allsky') setFovImmediately(360 * rad);
  else stel.zoomTo(100 * rad, 0.5);
  renderSelection();
}

function layer(name, enabled) {
  if (viewMode === 'allsky' && ['landscape', 'atmosphere'].includes(name)) enabled = false;
  const c = stel.core;
  switch (name) {
    case 'constellations': c.constellations.lines_visible = enabled; break;
    case 'labels': c.constellations.labels_visible = enabled; break;
    case 'atmosphere': c.atmosphere.visible = enabled; break;
    case 'landscape':
      c.landscapes.visible = enabled;
      c.landscapes.fog_visible = enabled;
      syncGroundControls();
      break;
    case 'equatorial': c.lines.equatorial.visible = enabled; break;
    case 'azimuthal': c.lines.azimuthal.visible = enabled; break;
    case 'dss':
      if (enabled && !dssAdded) {
        c.dss.addDataSource({ url: 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color' });
        dssAdded = true;
      }
      c.dss.visible = enabled;
      if (enabled) toast('DSS 실제 관측 영상: 시야를 10° 이하로 확대하세요. 인터넷 연결이 필요합니다.');
      break;
    case 'spherex':
      if (spherex && spherex.enabled !== enabled) spherex.setEnabled(enabled);
      syncSpherexControls();
      break;
  }
}

// ---- SPHEREx layer (v1.3.0) ----
function setSpherexLayer(enabled) {
  $('#layer-spherex').checked = enabled;
  layer('spherex', enabled);
  if (enabled) toast('NASA SPHEREx 적외선 전천 영상을 켰습니다. 1년 평균 영상이라 시간에 따른 변화는 보이지 않습니다.');
}

function syncSpherexControls() {
  if (!spherex) return;
  const enabled = $('#layer-spherex').checked;
  const channel = spherex.channel;
  $('#spherex-panel').hidden = !enabled;
  $('#toggle-spherex').setAttribute('aria-pressed', String(enabled));
  $('#toggle-spherex').setAttribute('aria-label', enabled ? 'SPHEREx 적외선 전천 영상 끄기' : 'SPHEREx 적외선 전천 영상 켜기');
  const slider = $('#spherex-channel');
  slider.max = String(USABLE_CHANNELS.length - 1);
  if (document.activeElement !== slider) slider.value = String(USABLE_CHANNELS.indexOf(channel));
  const lockedToFirst = spherex.probed && !spherex.perChannel;
  for (const control of [slider, $('#spherex-prev'), $('#spherex-next')]) control.disabled = lockedToFirst;
  renderSpherexReadout(channel);
  $('#spherex-source-note').hidden = !lockedToFirst;
  $('#spherex-source-note').textContent = lockedToFirst
    ? '채널 변환 서버(hips/spherex)를 찾지 못해 IRSA에서 첫 채널(0.75 µm)만 직접 불러옵니다. 다른 파장은 npm run preview로 실행하거나 TrueBlink 사이트의 /sky/에서 열면 고를 수 있습니다.'
    : '';
  $('#map-source').textContent = enabled
    ? `NASA SPHEREx ${formatWavelength(channel)} µm(채널 ${channel}) 전천 영상(1년 평균)입니다. 시간에 따른 변화는 보이지 않습니다. 변화를 보려면 TrueBlink에서 깜빡여 보세요. 영상: NASA/JPL-Caltech/IPAC · IRSA`
    : 'Stellarium 별지도 · SPHEREx 영상은 꺼져 있음';
  syncBlinkButtons();
  fitSkyCanvas();
}

function renderSpherexReadout(channel) {
  const info = channelInfo(channel);
  const readout = $('#spherex-readout');
  const strong = document.createElement('strong');
  strong.textContent = `${formatWavelength(channel)} µm`;
  const detail = document.createElement('span');
  detail.textContent = `채널 ${channel} / 102 · 검출기 ${info.detector}`;
  readout.replaceChildren(strong, detail);
}

function chooseSpherexChannel(channel, { immediate = false } = {}) {
  if (!spherex) return;
  channel = isUsableChannel(channel) ? channel : nearestUsableChannel(channel);
  renderSpherexReadout(channel);
  clearTimeout(spherexChannelTimer);
  // Dragging the slider passes many channels; only the one it rests on is downloaded.
  const apply = () => { spherex.setChannel(channel).then(syncSpherexControls); };
  if (immediate) apply();
  else spherexChannelTimer = setTimeout(apply, 280);
}

function stepSpherexChannel(direction) {
  const index = USABLE_CHANNELS.indexOf(spherex.channel);
  const next = USABLE_CHANNELS[Math.max(0, Math.min(USABLE_CHANNELS.length - 1, index + direction))];
  $('#spherex-channel').value = String(USABLE_CHANNELS.indexOf(next));
  chooseSpherexChannel(next);
}

// ---- TrueBlink link (v1.3.0) ----
async function resolveTrueBlinkRoot() {
  // Deployed together, TrueBlink is the site root and this app lives in /sky/.
  if (!/\/sky\/(?:index\.html)?$/.test(location.pathname)) return;
  try {
    const response = await fetch(new URL('../index.html', base), { credentials: 'omit', cache: 'no-cache' });
    const text = response.ok ? await response.text() : '';
    if (text.includes('TrueBlink') && !text.includes('stellarium-web-lab-spherex')) trueBlinkRoot = new URL('../', base).href;
  } catch { /* Keep the configured TrueBlink address. */ }
}

function icrfDegrees(vector) {
  const [ra, dec] = stel.c2s(vector);
  return { ra: stel.anp(ra) / rad, dec: dec / rad };
}

// TrueBlink looks a name up (CDS Sesame) before it uses ra/dec, and stops with "Could not find a
// target" when the lookup fails. So a link carries a name only when TrueBlink can find it: the name a
// start link brought in (round trip), or a star / deep-sky object's catalogue name. A view-centre field
// and a moving solar-system body (whose position now is what matters) go as ra/dec only.
function isSolarSystemObject(object) {
  try {
    const data = object.jsonData;
    if (data?.types?.includes('SSO') || /sso|asteroid|comet|satellite/i.test(data?.model ?? '')) return true;
  } catch { /* fall through to the distance test */ }
  const distance = object.getInfo('distance', stel.observer);
  return Number.isFinite(distance) && distance < 1000; // astronomical units
}

function trueBlinkName(object) {
  if (isSolarSystemObject(object)) return '';
  const names = object.designations().map((name) => name.replace(/^NAME /, ''));
  return names.find((name) => /^(?:M|NGC|IC) ?\d/.test(name)) || names[0] || '';
}

function angularSeparationDeg(a, b) {
  const [ra1, dec1, ra2, dec2] = [a.ra * rad, a.dec * rad, b.ra * rad, b.dec * rad];
  const cosine = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / rad;
}

function blinkTarget(useSelection = true) {
  const object = useSelection ? stel.core.selection : null;
  if (object) {
    const vector = object.getInfo('radec', stel.observer);
    if (vector && vector.length >= 3) {
      const { ra, dec } = icrfDegrees(vector);
      return { ra, dec, name: trueBlinkName(object), label: $('#selection-name').textContent };
    }
  }
  const { ra, dec } = icrfDegrees(centerDirection('ICRF'));
  // Still looking at the position a start link opened: send its name and exact coordinates back.
  const near = Math.max(0.2, (stel.core.fov / rad) * 0.02);
  if (sharedTarget?.name && angularSeparationDeg(sharedTarget, { ra, dec }) <= near) {
    return { ra: sharedTarget.ra, dec: sharedTarget.dec, name: sharedTarget.name, label: sharedTarget.name };
  }
  return { ra, dec, name: '', label: '화면 중심' };
}

function trueBlinkUrl(target) {
  const hash = new URLSearchParams({ ra: String(Number(target.ra.toFixed(6))), dec: String(Number(target.dec.toFixed(6))) });
  if (target.name) hash.set('name', target.name);
  return `${trueBlinkRoot.split('#')[0]}#${hash.toString()}`;
}

function openTrueBlink(useSelection) {
  if (!ready) return;
  const target = blinkTarget(useSelection);
  window.open(trueBlinkUrl(target), '_blank', 'noopener');
  toast(`${target.label}(적경 ${target.ra.toFixed(3)}°, 적위 ${target.dec.toFixed(3)}°)을(를) TrueBlink에서 엽니다.`);
}

function syncBlinkButtons() {
  const selected = Boolean(stel?.core.selection);
  $('#spherex-blink').title = selected ? '선택한 천체를 TrueBlink에서 엽니다(새 탭)' : '화면 중심을 TrueBlink에서 엽니다(새 탭)';
  $('#spherex-blink').lastChild.textContent = selected ? '선택한 천체를 TrueBlink에서 깜빡여 보기' : '화면 중심을 TrueBlink에서 깜빡여 보기';
}

// ---- Start parameters ra/dec/fov/name (v1.3.0) ----
function showNotice(message, actions) {
  $('#sky-notice-text').textContent = message;
  $('#notice-allsky').hidden = !actions;
  $('#notice-ground-off').hidden = !actions;
  $('#sky-notice').hidden = false;
}

function pointAtSharedTarget({ forceGroundOff = false } = {}) {
  if (!sharedTarget) return;
  const direction = stel.s2c(sharedTarget.ra * rad, sharedTarget.dec * rad);
  const [, altitude] = stel.c2s(stel.convertFrame(stel.observer, 'ICRF', 'OBSERVED_GEOM', direction));
  const label = sharedTarget.name || `적경 ${sharedTarget.ra.toFixed(3)}°, 적위 ${sharedTarget.dec.toFixed(3)}°`;
  stel.core.selection = null;
  stel.core.lock = null;
  if (forceGroundOff && stel.core.landscapes.visible) layer('landscape', false);
  if (viewMode === 'sky' && altitude < 0 && stel.core.landscapes.visible) {
    showNotice(`${label}은(는) 지금 ${currentLocation.name}에서 지평선 아래(고도 ${(altitude / rad).toFixed(1)}°)에 있어 보이지 않습니다. 전천 지도에서 보거나 지표면을 끄고 보세요.`, true);
    return;
  }
  stel.lookAt(stel.convertFrame(stel.observer, 'ICRF', 'MOUNT', direction), 0);
  if (sharedTarget.fov) setFovImmediately(Math.min(sharedTarget.fov, viewMode === 'allsky' ? 360 : 150) * rad);
  // Select the engine's own object when the name matches one near the position.
  const object = sharedTarget.name ? getObject(sharedTarget.name) : null;
  if (object) {
    const vector = object.getInfo('radec', stel.observer);
    const separation = vector ? Math.acos(Math.max(-1, Math.min(1, (vector[0] * direction[0] + vector[1] * direction[1] + vector[2] * direction[2]) / Math.hypot(vector[0], vector[1], vector[2])))) : Infinity;
    if (separation < 0.5 * rad) stel.core.selection = object;
  }
  renderSelection();
  toast(`${label} · 적경 ${sharedTarget.ra.toFixed(3)}°, 적위 ${sharedTarget.dec.toFixed(3)}°${viewMode === 'sky' ? ` · 고도 ${(altitude / rad).toFixed(1)}°` : ''}`);
}

function syncGroundControls() {
  const enabled = Boolean(stel.core.landscapes.visible);
  $('#layer-landscape').checked = enabled;
  $('#toggle-ground').setAttribute('aria-pressed', String(enabled));
  const label = `지표면 ${enabled ? '끄기' : '켜기'} (G)`;
  $('#toggle-ground').setAttribute('aria-label', label);
  $('#toggle-ground').title = label;
}

function toggleGround() {
  if (!ready) return;
  if (viewMode === 'allsky') return toast('전천 지도에서는 지표면을 숨깁니다. 하늘 보기로 돌아가면 복원됩니다.');
  const enabled = !stel.core.landscapes.visible;
  layer('landscape', enabled);
  toast(enabled ? '지표면을 켰습니다.' : '지표면을 껐습니다. 지평선 아래의 하늘도 볼 수 있습니다.');
}

function getObject(id) {
  return stel.getObj(`NAME ${id}`) || stel.getObj(id);
}

function renderSelection() {
  const object = stel.core.selection;
  $('#selection-panel').hidden = !object;
  syncBlinkButtons();
  if (!object) return;
  const names = object.designations().map((name) => name.replace(/^NAME /, ''));
  const known = objects.find((item) => names.includes(item.id));
  $('#selection-name').textContent = known?.name ?? names[0] ?? '선택한 천체';
  const rows = [];
  if (names.length) rows.push(names.slice(0, 3).join(' · '));
  const magnitude = object.getInfo('vmag');
  if (Number.isFinite(magnitude)) rows.push(`겉보기 등급 ${magnitude.toFixed(2)}`);
  $('#selection-details').textContent = rows.join('\n');
}

function selectObject(item) {
  if (!ready) return;
  const object = getObject(item.id);
  if (!object) {
    toast('현재 포함된 카탈로그에서 찾지 못했습니다. 데이터 로딩 후 다시 시도하거나 달·화성·M 31을 검색하세요.');
    return;
  }
  stel.core.selection = object;
  stel.pointAndLock(object, 0.8);
  stel.zoomTo((item.fov ?? 12) * rad, 0.8);
  $('#search-input').value = item.name ?? item.id;
  $('#search-results').replaceChildren();
  renderSelection();
  if (window.innerWidth < 720) setPanel(false);
  toast(viewMode === 'allsky' ? `${item.name ?? item.id}(으)로 확대했습니다. ‘전체 보기’를 누르면 전천 지도로 돌아갑니다.` : `${item.name ?? item.id}(으)로 이동했습니다. 지평선 아래 천체는 지형을 끄면 볼 수 있습니다.`);
}

function search(query) {
  const normalized = normalize(query);
  const container = $('#search-results');
  container.replaceChildren();
  if (!normalized) return;
  const matches = objects.filter((item) => item.aliases.some((alias) => normalize(alias).includes(normalized)) || normalize(item.name).includes(normalized));
  for (const item of matches.slice(0, 6)) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    const label = document.createElement('span');
    const detail = document.createElement('small');
    label.textContent = item.name;
    detail.textContent = item.type;
    button.append(label, detail);
    button.addEventListener('click', () => selectObject(item));
    li.append(button);
    container.append(li);
  }
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'search-hint';
    li.textContent = '추천 목록에 없습니다. 영문 이름 또는 M 31 같은 번호를 입력하고 Enter를 누르세요.';
    container.append(li);
  }
}

function setPanel(open) {
  document.body.classList.toggle('panel-closed', !open);
  $('#toggle-panel').setAttribute('aria-expanded', String(open));
  $('#control-panel').inert = !open;
  fitSkyCanvas();
}

async function applySharedView() {
  const params = new URL(location.href).searchParams;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const sharedPlace = locations.get(params.get('place'));
    if (sharedPlace && Math.abs(sharedPlace.latitude - lat) < 0.00002 && Math.abs(sharedPlace.longitude - lon) < 0.00002) {
      changeLocation(sharedPlace);
      $('#location-preset').value = sharedPlace.id;
    } else {
      changeLocation({ id: 'custom', name: '사용자 위치', latitude: lat, longitude: lon, elevation: 0 });
      customLocation = { latitude: lat, longitude: lon };
      $('#location-preset').value = 'custom';
    }
  }
  const time = new Date(params.get('time') ?? '');
  if (Number.isFinite(time.getTime()) && time.getFullYear() >= 1900 && time.getFullYear() <= 2100) stel.observer.utc = stel.date2MJD(time.getTime());
  if (params.get('view') === 'allsky') await setViewMode('allsky');
  else if (params.get('frame') === 'equatorial') await setCoordinateMode('equatorial');
  for (const [key, min, max, apply] of [
    ['fov', 0.2, viewMode === 'allsky' ? 360 : 150, (value) => { setFovImmediately(value * rad); }],
    ['yaw', -360, 360, (value) => { stel.observer.yaw = value * rad; }],
    ['pitch', -90, 90, (value) => { stel.observer.pitch = value * rad; }],
  ]) {
    const value = Number(params.get(key));
    if (params.has(key) && Number.isFinite(value) && value >= min && value <= max) apply(value);
  }
  const sharedLayers = params.get('layers');
  if (sharedLayers !== null) {
    const names = new Set(sharedLayers.split(','));
    for (const input of document.querySelectorAll('[data-layer]')) {
      input.checked = names.has(input.dataset.layer);
    }
  }
  // v1.3.0: ra/dec (ICRS degrees), name and spherex=<channel> from TrueBlink or a shared link.
  if (params.has('spherex')) {
    const requested = Number(params.get('spherex'));
    if (Number.isInteger(requested) && requested >= 1 && requested <= 102) {
      const channel = nearestUsableChannel(requested);
      if (BLANK_CHANNELS.has(requested)) toast(`채널 ${requested}은(는) 영상이 없어 가까운 채널 ${channel}을(를) 엽니다.`);
      spherex.channel = channel;
      $('#layer-spherex').checked = true;
    }
  }
  const ra = Number(params.get('ra'));
  const dec = Number(params.get('dec'));
  if (params.has('ra') && params.has('dec') && Number.isFinite(ra) && Number.isFinite(dec) && Math.abs(dec) <= 90) {
    const fov = Number(params.get('fov'));
    sharedTarget = {
      ra: ((ra % 360) + 360) % 360, dec,
      fov: params.has('fov') && Number.isFinite(fov) && fov >= 0.2 ? fov : (viewMode === 'allsky' ? null : 30),
      name: (params.get('name') ?? '').trim().slice(0, 120),
    };
  }
}

function setupControls() {
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setViewMode(button.dataset.view));
  $('#toggle-allsky').addEventListener('click', () => setViewMode(viewMode === 'allsky' ? 'sky' : 'allsky'));
  $('#map-full-view').addEventListener('click', resetView);
  window.addEventListener('resize', fitSkyCanvas);
  $('#coordinate-system').addEventListener('change', (event) => setCoordinateMode(event.target.value));
  $('#toggle-coordinates').addEventListener('click', () => setCoordinateMode(coordinateMode === 'equatorial' ? 'horizon' : 'equatorial'));
  $('#equatorial-target').addEventListener('submit', goToEquatorialCoordinates);
  $('#search-input').addEventListener('input', (event) => search(event.target.value));
  $('#search-input').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $('#search-results').replaceChildren();
    if (event.key === 'ArrowDown') { event.preventDefault(); $('#search-results button')?.focus(); }
  });
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#search-input').value.trim();
    if (!query) return;
    const item = objects.find((entry) => normalize(entry.name) === normalize(query) || entry.aliases.some((alias) => normalize(alias) === normalize(query)));
    selectObject(item ?? { id: query, name: query });
  });
  $('#location-preset').addEventListener('change', (event) => {
    if (event.target.value === 'custom') {
      $('#latitude').value = customLocation.latitude;
      $('#longitude').value = customLocation.longitude;
      $('#latitude').focus();
      return;
    }
    const place = locations.get(event.target.value);
    if (!place) return;
    changeLocation(place);
    toast(`${place.name}의 위치를 적용했습니다.`);
  });
  $('#location-search').addEventListener('input', (event) => populateLocations(event.target.value.trim()));
  $('#location-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('#location-preset').focus(); }
  });
  for (const id of ['#latitude', '#longitude']) $(id).addEventListener('input', () => { $('#location-preset').value = 'custom'; });
  $('#location-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const latitude = $('#latitude').valueAsNumber;
    const longitude = $('#longitude').valueAsNumber;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return toast('위도는 −90~90°, 경도는 −180~180°로 입력하세요.');
    const preset = locations.get($('#location-preset').value);
    if (!preset) saveCustomLocation(latitude, longitude);
    changeLocation({ id: preset?.id ?? 'custom', name: preset?.name ?? '사용자 위치', latitude, longitude, elevation: preset?.elevation ?? 0 });
    toast('관측 위치를 변경했습니다.');
  });
  $('#observation-time').addEventListener('input', () => { timeInputDirty = true; });
  $('#time-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const date = new Date($('#observation-time').value);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1900 || date.getFullYear() > 2100) return toast('1900~2100년 사이의 날짜를 입력하세요.');
    stel.observer.utc = stel.date2MJD(date.getTime());
    timeInputDirty = false;
    setSpeed(0);
    syncTime();
  });
  $('#time-backward').addEventListener('click', () => stepTimeSpeed(-1));
  $('#time-stop').addEventListener('click', () => setSpeed(0));
  $('#time-forward').addEventListener('click', () => stepTimeSpeed(1));
  $('#time-speed-input').addEventListener('input', () => {
    speedInputDirty = true;
    $('#time-speed-input').removeAttribute('aria-invalid');
    $('#time-speed-hint').textContent = TIME_SPEED_HINT;
  });
  $('#time-speed-form').addEventListener('submit', (event) => {
    event.preventDefault();
    applyTypedSpeed();
  });
  $('#time-speed-input').addEventListener('change', () => {
    if (speedInputDirty) applyTypedSpeed(false);
  });
  $('#time-now').addEventListener('click', () => {
    timeInputDirty = false;
    stel.observer.utc = stel.date2MJD(Date.now());
    setSpeed(1);
    syncTime();
    toast('현재시간으로 돌아왔습니다. 실시간 ×1로 재생합니다.');
  });
  stel.core.change('time_speed', syncSpeedControls);
  for (const input of document.querySelectorAll('[data-layer]')) input.addEventListener('change', () => layer(input.dataset.layer, input.checked));
  $('#toggle-ground').addEventListener('click', toggleGround);
  document.addEventListener('keydown', (event) => {
    if (!ready || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || $('#help-dialog').open) return;
    if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select') || event.target.isContentEditable)) return;
    if (event.code !== 'KeyG' && event.key.toLowerCase() !== 'g') return;
    event.preventDefault();
    toggleGround();
  });
  $('#quality-select').addEventListener('change', (event) => { stel.maxPixelRatio = { performance: 1, balanced: 1.5, detail: 2 }[event.target.value]; });
  $('#zoom-in').addEventListener('click', () => stel.zoomTo(Math.max(0.2 * rad, stel.core.fov * 0.7), 0.3));
  $('#zoom-out').addEventListener('click', () => stel.zoomTo(Math.min((viewMode === 'allsky' ? 360 : 150) * rad, stel.core.fov / 0.7), 0.3));
  $('#reset-view').addEventListener('click', resetView);
  $('#clear-selection').addEventListener('click', () => { stel.core.selection = null; stel.core.lock = null; renderSelection(); });
  $('#copy-link').addEventListener('click', async () => {
    const url = new URL(base);
    const yawDegrees = ((stel.observer.yaw / rad + 180) % 360 + 360) % 360 - 180;
    url.search = new URLSearchParams({
      lat: currentLocation.latitude.toFixed(5), lon: currentLocation.longitude.toFixed(5),
      place: currentLocation.id ?? 'custom',
      frame: coordinateMode,
      view: viewMode,
      time: stel.MJD2date(stel.observer.utc).toISOString(),
      fov: (stel.core.fov / rad).toFixed(3), yaw: yawDegrees.toFixed(3), pitch: (stel.observer.pitch / rad).toFixed(3),
      layers: [...document.querySelectorAll('[data-layer]:checked')].map((input) => input.dataset.layer).join(','),
      ...($('#layer-spherex').checked ? { spherex: String(spherex.channel) } : {}),
    }).toString();
    try { await navigator.clipboard.writeText(url.href); toast('같은 위치·시간·시야를 여는 링크를 복사했습니다.'); }
    catch { window.prompt('이 주소를 복사하세요.', url.href); }
  });
  stel.core.change('selection', renderSelection);
  $('#toggle-spherex').addEventListener('click', () => setSpherexLayer(!$('#layer-spherex').checked));
  $('#spherex-close').addEventListener('click', () => setSpherexLayer(false));
  $('#spherex-channel').addEventListener('input', (event) => chooseSpherexChannel(USABLE_CHANNELS[Number(event.target.value)]));
  $('#spherex-channel').addEventListener('change', (event) => chooseSpherexChannel(USABLE_CHANNELS[Number(event.target.value)], { immediate: true }));
  $('#spherex-prev').addEventListener('click', () => stepSpherexChannel(-1));
  $('#spherex-next').addEventListener('click', () => stepSpherexChannel(1));
  $('#spherex-blink').addEventListener('click', () => openTrueBlink(true));
  $('#selection-blink').addEventListener('click', () => openTrueBlink(true));
  $('#center-blink').addEventListener('click', () => openTrueBlink(false));
  $('#notice-close').addEventListener('click', () => { $('#sky-notice').hidden = true; });
  $('#notice-allsky').addEventListener('click', async () => {
    $('#sky-notice').hidden = true;
    await setViewMode('allsky');
    pointAtSharedTarget();
  });
  $('#notice-ground-off').addEventListener('click', () => {
    $('#sky-notice').hidden = true;
    pointAtSharedTarget({ forceGroundOff: true });
  });
}

async function onReady(engine) {
  try {
    stel = engine;
    // Expose the engine for local integration and scientific extension work.
    window.stellarium = engine;
    const c = stel.core;
    const sky = asset('skydata/');
    c.stars.addDataSource({ url: sky + 'stars' });
    c.skycultures.addDataSource({ url: sky + 'skycultures/western', key: 'western' });
    c.dsos.addDataSource({ url: sky + 'dso' });
    c.landscapes.addDataSource({ url: sky + 'landscapes/guereins', key: 'guereins' });
    c.milkyway.addDataSource({ url: sky + 'surveys/milkyway' });
    for (const [body, key] of [['moon', 'moon'], ['sun', 'sun'], ['moon', 'default']]) c.planets.addDataSource({ url: sky + 'surveys/sso/' + body, key });
    c.constellations.show_only_pointed = false;
    spherex = new SpherexLayer(stel, base);
    spherex.onChange(syncSpherexControls);
    resolveTrueBlinkRoot();
    populateLocations();
    changeLocation(presets.seoul);
    stel.observer.utc = stel.date2MJD(Date.now());
    setSpeed(1);
    resetView();
    await applySharedView();
    // Ordinary sky visits start with ground on; an explicit all-sky link has no horizon.
    $('#layer-landscape').checked = viewMode !== 'allsky';
    if (viewMode === 'allsky') $('#layer-atmosphere').checked = false;
    for (const input of document.querySelectorAll('[data-layer]')) layer(input.dataset.layer, input.checked);
    // The observer's frame matrices follow a new time or place only after the engine has drawn.
    if (sharedTarget) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      pointAtSharedTarget();
    }
    setupControls();
    const fonts = await Promise.allSettled([
      stel.setFont('regular', asset('fonts/NotoSans-Regular.ttf')),
      stel.setFont('bold', asset('fonts/NotoSans-Bold.ttf')),
    ]);
    if (fonts.some((result) => result.status === 'rejected')) console.warn('외부 폰트를 불러오지 못해 엔진의 기본 폰트를 사용합니다.');
    clearTimeout(startupTimer);
    ready = true;
    syncViewControls();
    $('#loading-overlay').hidden = true;
    $('#engine-status').textContent = '하늘 탐색 중';
    $('#engine-status').dataset.state = 'ready';
    syncTime();
    statusTimer = setInterval(syncTime, 500);
    if (window.innerWidth < 720) setPanel(false);
  } catch (error) { fail('하늘을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요.', error); }
}

for (const button of document.querySelectorAll('.view-controls button')) button.disabled = true;
$('#toggle-panel').addEventListener('click', () => setPanel(document.body.classList.contains('panel-closed')));
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#help-dialog').addEventListener('click', (event) => { if (event.target === $('#help-dialog')) $('#help-dialog').close(); });
$('#retry-button').addEventListener('click', () => location.reload());
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('이 브라우저에서는 전체 화면을 사용할 수 없습니다.'); }
});
$('#sky-canvas').addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  ready = false;
  fail('그래픽 연결이 중단되었습니다. 다른 무거운 탭을 닫고 다시 시작해 주세요.');
});

async function start() {
  if (location.protocol === 'file:') return fail('Start-Web.cmd를 실행해 주세요. WebAssembly는 HTTP 서버에서 열어야 합니다.');
  if (!window.WebAssembly) return fail('WebAssembly를 지원하는 최신 Chrome 또는 Edge에서 열어 주세요.');
  const probe = document.createElement('canvas');
  const context = probe.getContext('webgl') || probe.getContext('experimental-webgl');
  if (!context) return fail('WebGL을 사용할 수 없습니다. 브라우저의 그래픽 가속을 켜고 다시 시작해 주세요.');
  context.getExtension('WEBGL_lose_context')?.loseContext();
  startupTimer = setTimeout(() => fail('로딩이 지연되고 있습니다. 서버 연결을 확인하고 다시 시도해 주세요.'), 45000);
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = asset('engine/stellarium-web-engine.js');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Engine script failed to load'));
      document.head.append(script);
    });
    $('#loading-message').textContent = '천체 엔진과 하늘 데이터를 불러오는 중…';
    const engine = window.StelWebEngine({
      wasmFile: asset('engine/stellarium-web-engine.wasm'), canvas: $('#sky-canvas'), maxPixelRatio: 1.5,
      translateFn: (_domain, text) => text,
      onReady,
      onAbort: (reason) => fail('천체 엔진을 실행하지 못했습니다. 브라우저와 WASM 파일을 확인해 주세요.', reason),
    });
    if (engine?.catch) engine.catch((error) => fail('WebAssembly를 불러오지 못했습니다. 서버 연결을 확인해 주세요.', error));
  } catch (error) { fail('엔진 파일을 찾을 수 없습니다. npm run build 후 다시 실행해 주세요.', error); }
}
start();
