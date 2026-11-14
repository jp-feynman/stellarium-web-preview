/* SPDX-License-Identifier: AGPL-3.0-only */
// Stellarium's radec info is an ICRF Cartesian direction, not a pair of degrees.
export function targetFromVector(vector, label = '선택한 천체') {
  if (!vector || vector.length < 3) return null;
  const [x, y, z] = vector;
  if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) === 0) return null;
  const ra = ((Math.atan2(y, x) * 180 / Math.PI) % 360 + 360) % 360;
  const dec = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
  return { ra, dec, label };
}

export function buildAnalysisUrl(target, planetariumUrl, embedded = true) {
  if (!target || !Number.isFinite(target.ra) || !Number.isFinite(target.dec) || Math.abs(target.dec) > 90) {
    throw new TypeError('분석할 천체의 좌표가 올바르지 않습니다.');
  }
  const url = new URL('../analysis/', planetariumUrl);
  const hash = new URLSearchParams({
    ra: (((target.ra % 360) + 360) % 360).toFixed(8), dec: target.dec.toFixed(8),
    label: target.label || '선택한 천체', mode: 'research', lang: 'ko',
  });
  if (embedded) hash.set('embed', 'panel');
  url.hash = hash.toString();
  return url.href;
}
