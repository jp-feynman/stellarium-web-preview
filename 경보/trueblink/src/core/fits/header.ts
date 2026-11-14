// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// FITS header parsing. A FITS header is a sequence of 80-character ASCII "cards" (KEYWORD = value / comment)
// ending with an END card, padded to a multiple of 2880 bytes (one FITS "block").

export type CardValue = string | number | boolean;
export type Cards = Record<string, CardValue>;

/** One FITS block: every header and data unit starts on a multiple of this. */
export const BLOCK = 2880;

/** Round a byte count up to whole FITS blocks. */
export function padBlock(n: number): number {
  return Math.ceil(n / BLOCK) * BLOCK;
}

function parseValue(raw: string): CardValue {
  const s = raw.trim();
  if (s.startsWith("'")) {
    // Quoted string; two single quotes in a row stand for one quote. Trailing blanks are not significant.
    let out = '';
    for (let j = 1; j < s.length; j++) {
      if (s[j] === "'") {
        if (s[j + 1] === "'") {
          out += "'";
          j++;
          continue;
        }
        break;
      }
      out += s[j];
    }
    return out.trimEnd();
  }
  const v = s.split('/')[0].trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  if (/^[+-]?\d+$/.test(v)) return parseInt(v, 10);
  const f = Number(v.replace(/[dD]/, 'E'));
  return v === '' || Number.isNaN(f) ? v : f;
}

/**
 * Parse header cards starting at bytes[offset]. Returns the cards (value only) and the header length
 * in bytes (whole blocks), or null when the END card is not inside the buffer yet (fetch more bytes).
 * HIERARCH cards ("HIERARCH L2 N_TRANSIENT = 22243 / ...") are stored under their long name ("L2 N_TRANSIENT").
 */
export function parseHeader(bytes: Uint8Array, offset = 0): { cards: Cards; length: number } | null {
  const cards: Cards = {};
  for (let i = offset; i + 80 <= bytes.length; i += 80) {
    let line = '';
    for (let k = 0; k < 80; k++) line += String.fromCharCode(bytes[i + k]);
    const key = line.slice(0, 8).trimEnd();
    if (key === 'END' && line.slice(8).trim() === '') {
      return { cards, length: padBlock(i + 80 - offset) };
    }
    if (line.startsWith('HIERARCH ')) {
      const eq = line.indexOf('=');
      if (eq > 9) cards[line.slice(9, eq).trim()] = parseValue(line.slice(eq + 1));
      continue;
    }
    if (key !== '' && line.slice(8, 10) === '= ') cards[key] = parseValue(line.slice(10));
  }
  return null;
}

/** Size in bytes of an HDU's data section before padding: |BITPIX|/8 * GCOUNT * (PCOUNT + NAXIS1*...*NAXISn). */
export function hduDataBytes(cards: Cards): number {
  const naxis = Number(cards.NAXIS ?? 0);
  if (naxis === 0) return 0;
  let n = 1;
  for (let k = 1; k <= naxis; k++) n *= Number(cards[`NAXIS${k}`] ?? 0);
  const bitpix = Math.abs(Number(cards.BITPIX ?? 8));
  const pcount = Number(cards.PCOUNT ?? 0);
  const gcount = Number(cards.GCOUNT ?? 1);
  return (bitpix / 8) * gcount * (pcount + n);
}
