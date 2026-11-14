import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JihoResultView } from '../src/app/asteroid/JihoAnalysis';
import { jihoStrings } from '../src/app/asteroid/jiho-strings';
import type { Result } from '../src/app/asteroid/jiho-client';

const base = 'https://example.github.io/lab/analysis/';
const result = (id: string): Result => JSON.parse(readFileSync(`public/data/asteroid-analysis/${id}/result.json`, 'utf8'));
const render = (id: string, data = result(id)) => renderToStaticMarkup(createElement(JihoResultView, {
  loaded: { data, url: `${base}data/asteroid-analysis/${id}/result.json` }, t: jihoStrings.en,
}));

beforeEach(() => vi.stubGlobal('document', { baseURI: base }));
afterEach(() => vi.unstubAllGlobals());

describe('integrated analysis scientific presentation', () => {
  it('keeps the saved Eros disagreement visible beside the high model probability', () => {
    const html = render('433');
    expect(html).toContain('94.1 %');
    expect(html).toContain('data-testid="jiho-validation-mismatch"');
    expect(html).toContain(jihoStrings.en.validationMismatch);
    expect(html).toContain(jihoStrings.en.probabilityNote);
    expect(html).toContain('S (S-complex)');
    // Missing H uncertainty must not make the derived albedo error look complete.
    expect(html).toContain(jihoStrings.en.lowerBound);
    expect(html).toContain(jihoStrings.en.densityThermal);
    // The rejected Band II fit is not presented as a measured feature centre/depth.
    expect(html).toMatch(/Band II<\/td><td>Not detected<\/td><td class="num">—<\/td><td class="num">—/);
  });

  it('does not replace unavailable Gedania estimates with catalogue facts or invent calibration', () => {
    const html = render('A913_SF');
    expect(html).toMatch(/Thermal-model diameter<\/h4><p class="astro-metric-value">Not estimable \/ unavailable/);
    expect(html).toContain('Catalogue diameter: 58.28');
    expect(html).toMatch(/Mass from external dynamical data<\/h4><p class="astro-metric-value">Not estimable \/ unavailable/);
    expect(html).toContain('Solar-analog calibration: Not recorded');
    expect(html).toContain(jihoStrings.en.validationNone);
    expect(html).not.toContain('data-testid="jiho-validation-mismatch"');
  });

  it('identifies the catalogue volume and incomplete density uncertainty for Hygiea', () => {
    const html = render('10');
    expect(html).toContain(jihoStrings.en.densityCatalog);
    expect(html).toContain(jihoStrings.en.lowerBound);
    expect(html).toContain(jihoStrings.en.massNote);
    expect(html).toContain('Unique exposure IDs</dt><dd>134');
    expect(html).toContain('Detector images found / Spectral points</dt><dd>263 / 120');
    const data = result('10');
    expect(html).toContain(data.coverage.start!.slice(0, 10));
    expect(html).toContain(data.measuredCoverage!.start!.slice(0, 10));
    expect(html).toContain('Search result period (UTC)');
    expect(html).toContain('Measured period (UTC)');
    expect(html).toContain(`${base}data/asteroid-analysis/10/spectrum.csv`);
  });
});
