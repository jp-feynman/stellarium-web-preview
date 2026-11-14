/* SPDX-License-Identifier: AGPL-3.0-only */
import { buildAnalysisUrl, targetFromVector } from './analysis-target.js';

export function createAnalysisController({ getEngine, notify, onVisibilityChange = () => {} }) {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#analysis-dialog');
  const frame = $('#analysis-frame');
  const base = new URL('../', import.meta.url);
  let loadTimer;
  let opening = 0;

  function selectionTarget() {
    const engine = getEngine();
    const object = engine?.core.selection;
    if (!object) return null;
    try {
      const target = targetFromVector(object.getInfo('radec', engine.observer), $('#selection-name').textContent);
      if (!target) return null;
      const distance = object.getInfo('distance', engine.observer);
      target.moving = Number.isFinite(distance) && distance < 1000;
      return target;
    } catch { return null; }
  }

  function updateSelection() {
    const target = selectionTarget();
    $('#selection-analyze').disabled = !target;
    $('#selection-coordinates').textContent = target
      ? `ICRF · RA ${target.ra.toFixed(5)}° · Dec ${target.dec >= 0 ? '+' : ''}${target.dec.toFixed(5)}°` : '분석 좌표를 읽을 수 없습니다.';
    $('#selection-analysis-note').textContent = target?.moving
      ? '이동하는 천체입니다. 현재 위치 주변의 보관 영상을 조회하며, 천체를 과거 시점까지 추적하지는 않습니다.'
      : '이 천체 주변의 SPHEREx 관측 영상·파장·변화를 살펴봅니다. 관측 자료가 없는 위치도 있습니다.';
  }

  function open(target) {
    if (!target) return notify('분석할 천체의 좌표를 읽을 수 없습니다. 다른 천체를 선택해 주세요.');
    $('#analysis-title').textContent = `${target.label} · SPHEREx 분석`;
    $('#analysis-position').textContent = `ICRF · RA ${target.ra.toFixed(5)}° · Dec ${target.dec.toFixed(5)}°`;
    $('#analysis-context').textContent = target.moving
      ? '선택한 관측 시각의 위치 주변을 조회합니다. 이동 천체 자체의 과거 관측을 추적한 결과는 아닙니다.'
      : '선택한 하늘 위치 주변의 SPHEREx 보관 자료를 조회합니다. 분석창을 닫으면 보던 하늘로 돌아갑니다.';
    $('#analysis-new-tab').href = buildAnalysisUrl(target, base, false);
    $('#analysis-loading').hidden = false;
    $('#analysis-loading').textContent = '분석 도구를 불러오는 중…';
    clearTimeout(loadTimer);
    if (!dialog.open) dialog.showModal();
    onVisibilityChange(true);
    // Paint the dialog with the sky renderer paused before starting the second app.
    const request = ++opening;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (request !== opening || !dialog.open) return;
      frame.src = buildAnalysisUrl(target, base);
      loadTimer = setTimeout(() => {
        if (!$('#analysis-loading').hidden) $('#analysis-loading').textContent = '불러오기가 지연되고 있습니다. 새 탭으로 열거나 잠시 후 다시 시도해 주세요.';
      }, 20000);
    }));
  }

  $('#selection-analyze').addEventListener('click', () => open(selectionTarget()));
  $('#close-analysis').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    opening++;
    clearTimeout(loadTimer);
    // Unload requests, WebGL and workers when the workbench is no longer visible.
    frame.src = 'about:blank';
    onVisibilityChange(false);
  });
  frame.addEventListener('load', () => {
    if (frame.getAttribute('src') === 'about:blank') return;
    clearTimeout(loadTimer);
    $('#analysis-loading').hidden = true;
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'spherex-analysis-close' && dialog.open) dialog.close();
  });
  return { updateSelection, open };
}
