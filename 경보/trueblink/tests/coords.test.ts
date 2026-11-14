// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import { formatAngleArcsec, formatDec, formatDeg, formatPos, formatRa, parseCoordinates } from '../src/core/coords';
import { angularSepArcsec } from '../src/core/wcs';

// WISE 0855-0714 discovery position from the challenge brief.
const RA = (8 + 55 / 60 + 10.831 / 3600) * 15;
const DEC = -(7 + 14 / 60 + 42.53 / 3600);

function near(text: string, ra: number, dec: number, tolArcsec = 0.01): void {
  const p = parseCoordinates(text);
  expect(p, text).not.toBeNull();
  expect(angularSepArcsec(p!.ra, p!.dec, ra, dec), text).toBeLessThan(tolArcsec);
}

describe('parseCoordinates', () => {
  it('reads the formats people type', () => {
    near('08h55m10.831s -07d14m42.53s', RA, DEC);
    near('08h 55m 10.831s, -07d 14m 42.53s', RA, DEC);
    near('08:55:10.831 -07:14:42.53', RA, DEC);
    near('08:55:10.831, -07:14:42.53', RA, DEC);
    near('08 55 10.831 -07 14 42.53', RA, DEC);
    near('08 55 10.831  -07 14 42.53', RA, DEC);
    near("08h55m10.831s -07°14′42.53″", RA, DEC);
    near("08h55m10.831s −07°14'42.53\"", RA, DEC);
    near('J085510.831-071442.53', RA, DEC);
    near('133.795129 -7.245147', 133.795129, -7.245147, 1e-3);
    near('133.795129, -7.245147', 133.795129, -7.245147, 1e-3);
    near('133.795129,-7.245147', 133.795129, -7.245147, 1e-3);
    near('133.795129d -7.245147d', 133.795129, -7.245147, 1e-3);
    near('133.795 7.245', 133.795, 7.245, 1e-3);
    near('133.795 +7.245', 133.795, 7.245, 1e-3);
    near('8.919675h -7.245147', 8.919675 * 15, -7.245147, 1e-3);
    near('17 57 48.5 +04 41 36', (17 + 57 / 60 + 48.5 / 3600) * 15, 4 + 41 / 60 + 36 / 3600);
    near('17h57m48.5s 04d41m36s', (17 + 57 / 60 + 48.5 / 3600) * 15, 4 + 41 / 60 + 36 / 3600);
    near('0 0 0 -0 30 0', 0, -0.5);
    near('22:04 -56:47', (22 + 4 / 60) * 15, -(56 + 47 / 60));
  });

  it('keeps the sign of declinations between 0 and -1 degree', () => {
    expect(parseCoordinates('12:00:00 -00:30:00')!.dec).toBeCloseTo(-0.5, 12);
    expect(parseCoordinates('180 -0.5')!.dec).toBeCloseTo(-0.5, 12);
  });

  it('rejects text that is not a position', () => {
    for (const bad of ['', 'WISE 0855-0714', "Barnard's Star", 'R Dra', '400 10', '10 95', '25:00:00 10:00:00', '08 61 00 -07 00 00', '1 2 3 4 5 6 7', '12', '-10 10'])
      expect(parseCoordinates(bad), bad).toBeNull();
  });
});

describe('formatters', () => {
  it('format and parse round-trip', () => {
    const cases: [number, number][] = [
      [RA, DEC],
      [0, 0],
      [359.99999, 89.99999],
      [269.452073, 4.693410],
      [331.044152, -56.782846],
      [76.956068, 30.401326],
      [248.167611, 66.754979],
      [12.3456, -0.25],
    ];
    for (const [ra, dec] of cases) {
      const text = `${formatRa(ra, { digits: 3 })} ${formatDec(dec, { digits: 2 })}`;
      near(text, ra, dec, 0.02);
      near(`${formatRa(ra, { style: ':', digits: 3 })} ${formatDec(dec, { style: ':', digits: 2 })}`, ra, dec, 0.02);
      near(formatPos({ ra, dec }, 'deg', 7), ra, dec, 0.001);
    }
  });

  it('writes the expected strings and carries 60 s properly', () => {
    expect(formatRa(RA)).toBe('08h55m10.83s');
    expect(formatDec(DEC)).toBe(`-07°14'42.5"`);
    expect(formatRa(RA, { style: ':' })).toBe('08:55:10.83');
    expect(formatDec(DEC, { style: ':' })).toBe('-07:14:42.5');
    expect(formatDec(4.5)).toBe(`+04°30'00.0"`);
    expect(formatRa(359.9999999)).toBe('00h00m00.00s');
    expect(formatDec(-0.99999999)).toBe(`-01°00'00.0"`);
    expect(formatDeg(133.7951294)).toBe('133.79513');
    expect(formatPos({ ra: 133.795129, dec: 7.2 })).toBe('133.79513 +7.20000');
    expect(formatAngleArcsec(125.4)).toBe("2.09'");
    expect(formatAngleArcsec(4.21)).toBe('4.21"');
    expect(formatRa(Number.NaN)).toBe('--');
  });
});
