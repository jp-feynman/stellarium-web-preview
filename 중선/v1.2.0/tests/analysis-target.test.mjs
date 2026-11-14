import test from 'node:test';
import assert from 'node:assert/strict';
import { targetFromVector, buildAnalysisUrl } from '../src/analysis-target.js';

test('ICRF axes and RA wrap are handed off in degrees, not hours or radians', () => {
  for (const [vector, ra, dec] of [
    [[1, 0, 0], 0, 0], [[0, 1, 0], 90, 0], [[-1, 0, 0], 180, 0],
    [[0, -1, 0], 270, 0], [[1, 1, Math.sqrt(2)], 45, 45], [[0, 0, -1], 0, -90],
  ]) {
    const target = targetFromVector(vector, '테스트');
    assert.ok(Math.abs(target.ra - ra) < 1e-10);
    assert.ok(Math.abs(target.dec - dec) < 1e-10);
  }
});

test('missing or invalid selections cannot silently analyze the origin', () => {
  for (const vector of [null, [], [0, 0, 0], [NaN, 1, 0], [1, Infinity, 0], ['1', 0, 0]]) {
    assert.equal(targetFromVector(vector), null);
  }
  assert.throws(() => buildAnalysisUrl({ ra: 10, dec: 91 }, 'https://example.org/planetarium/'));
});

test('localized labels are display-only and nested deployment paths are preserved', () => {
  const target = { ra: 101.28715533, dec: -16.71611586, label: '시리우스 & <항성>' };
  const url = new URL(buildAnalysisUrl(target, 'https://example.org/my-site/planetarium/'));
  assert.equal(url.pathname, '/my-site/analysis/');
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(params.get('label'), target.label);
  assert.equal(params.has('name'), false);
  assert.equal(params.get('embed'), 'panel');
  assert.equal(Number(params.get('ra')), target.ra);
  assert.equal(Number(params.get('dec')), target.dec);
  assert.equal(new URLSearchParams(new URL(buildAnalysisUrl(target, url.origin + '/my-site/planetarium/', false)).hash.slice(1)).has('embed'), false);
});
