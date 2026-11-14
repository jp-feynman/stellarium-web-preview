// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
import { describe, expect, it } from 'vitest';
import { applyUrlState, decodeHash, encodeHash, urlStateFromApp, type UrlState } from '../src/app/urlState';
import { useApp } from '../src/app/store';
import { parseCoordinatesLoose } from '../src/app/parseInput';

describe('URL hash encode / decode', () => {
  it('round-trips a full view', () => {
    const s: UrlState = {
      name: "Barnard's Star",
      ra: 269.446379,
      dec: 4.766781,
      fov: 240,
      seq: 'difference',
      band: 'cold',
      mode: 'research',
      lang: 'ko',
      embed: true,
      frame: 2,
      speed: 900,
    };
    const h = encodeHash(s);
    expect(h.startsWith('#')).toBe(true);
    expect(decodeHash(h)).toEqual(s);
  });

  it('encodes keys in a stable order and leaves out empty values', () => {
    expect(encodeHash({ dec: -7.2, ra: 133.76, seq: 'thenNow' })).toBe('#ra=133.76&dec=-7.2&seq=thenNow');
    expect(encodeHash({})).toBe('');
    expect(encodeHash({ embed: false })).toBe('');
  });

  it('round-trips the cold-object filter sequence', () => {
    expect(decodeHash('#name=WISE%200855-0714&seq=coldFilter&band=cold').seq).toBe('coldFilter');
    expect(encodeHash({ seq: 'coldFilter' })).toBe('#seq=coldFilter');
  });

  it('keeps planetarium labels separate from catalogue names and preserves the full panel mode', () => {
    const input = { ra: 101.287155, dec: -16.716116, label: '시리우스', mode: 'research' as const, lang: 'ko' as const, embed: 'panel' as const };
    const decoded = decodeHash(encodeHash(input));
    expect(decoded.ra).toBeCloseTo(input.ra, 6);
    expect(decoded).toMatchObject({ dec: input.dec, label: input.label, mode: input.mode, lang: input.lang, embed: input.embed });
    expect(decoded.name).toBeUndefined();
    applyUrlState(decoded);
    expect(useApp.getState().embed).toBe('panel');
    expect(useApp.getState().uiMode).toBe('research');
    expect(useApp.getState().lang).toBe('ko');
    applyUrlState(decodeHash('#embed=1'));
    expect(useApp.getState().embed).toBe(true);
    applyUrlState({});
    expect(useApp.getState().embed).toBe(false);
  });

  it('retains the display label in a shared link, then clears it for a different search', () => {
    const st = useApp.getState();
    st.setSourceLabel('  안드로메다 은하  ');
    st.setCenter({ ra: 10.684708, dec: 41.26875 });
    st.setEmbed('panel');
    const link = urlStateFromApp(useApp.getState());
    expect(decodeHash(encodeHash(link))).toMatchObject({ label: '안드로메다 은하', ra: 10.684708, dec: 41.26875, embed: 'panel' });
    st.reset();
    expect(useApp.getState().sourceLabel).toBe('');
    expect(useApp.getState().embed).toBe('panel');
    st.setEmbed(false);
  });

  it('accepts a hash with or without the leading #', () => {
    expect(decodeHash('ra=10&dec=20')).toEqual({ ra: 10, dec: 20 });
    expect(decodeHash('#ra=10&dec=20')).toEqual({ ra: 10, dec: 20 });
  });

  it('drops invalid or out-of-range values instead of guessing', () => {
    const u = decodeHash('#ra=abc&dec=95&fov=5&seq=rainbow&band=d9&mode=admin&lang=fr&frame=-1&speed=10&embed=0');
    expect(u).toEqual({});
  });

  it('needs both coordinates and wraps right ascension into 0..360', () => {
    expect(decodeHash('#ra=10')).toEqual({});
    expect(decodeHash('#ra=-10&dec=5')).toEqual({ ra: 350, dec: 5 });
    expect(decodeHash('#ra=370&dec=-90')).toEqual({ ra: 10, dec: -90 });
  });

  it('keeps names with spaces and punctuation intact', () => {
    const h = encodeHash({ name: 'WISE 0855-0714 & friends' });
    expect(decodeHash(h).name).toBe('WISE 0855-0714 & friends');
  });

  it('rounds coordinates to 6 decimals (about 4 milliarcsec) and integers elsewhere', () => {
    expect(encodeHash({ ra: 1.23456789, dec: -0.000000049, fov: 180.4 })).toBe('#ra=1.234568&dec=0&fov=180');
  });

  it('builds short links from app state by leaving defaults out', () => {
    const u = urlStateFromApp({
      target: { id: 'rwaur', name: 'RW Aurigae', ra: 76.956, dec: 30.401, epoch: 2025.5 },
      center: { ra: 76.956, dec: 30.401 },
      fovArcsec: 180,
      sequence: 'epochs',
      bandGroupId: 'all',
      uiMode: 'explore',
      lang: 'en',
      embed: false,
      frameIndex: 0,
      speedMs: 600,
    });
    expect(encodeHash(u)).toBe('#name=RW+Aurigae&ra=76.956&dec=30.401');
  });
});

describe('search box coordinate parsing', () => {
  it('reads decimal degrees', () => {
    expect(parseCoordinatesLoose('269.446 +4.767')).toEqual({ ra: 269.446, dec: 4.767 });
    expect(parseCoordinatesLoose('133.761, -7.242')).toEqual({ ra: 133.761, dec: -7.242 });
  });
  it('reads sexagesimal hours and degrees', () => {
    const p = parseCoordinatesLoose('17:57:48.5 +04:41:36')!;
    expect(p.ra).toBeCloseTo(269.452083, 5);
    expect(p.dec).toBeCloseTo(4.693333, 5);
    const q = parseCoordinatesLoose('08h55m10.83s -07d14m42.5s')!;
    expect(q.ra).toBeCloseTo(133.795125, 5);
    expect(q.dec).toBeCloseTo(-7.245139, 5);
  });
  it('treats names as names', () => {
    expect(parseCoordinatesLoose("Barnard's Star")).toBeNull();
    expect(parseCoordinatesLoose('WISE 0855-0714')).toBeNull();
    expect(parseCoordinatesLoose('400 10')).toBeNull();
  });
});
