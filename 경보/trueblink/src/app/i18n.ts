// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Tiny translation layer. English is the default and the fallback; Korean is a toggle.
// Other modules add their own keys with registerStrings('en', {...}) / registerStrings('ko', {...}).
import { useCallback } from 'react';
import { useApp, type Lang } from './store';
import { en } from './locales/en';
import { ko } from './locales/ko';

export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

const dictionaries: Record<Lang, Dict> = { en: { ...en }, ko: { ...ko } };

export function registerStrings(lang: Lang, dict: Dict): void {
  Object.assign(dictionaries[lang], dict);
}

/** True when the key exists in English (or the given language). */
export function hasKey(key: string, lang: Lang = 'en'): boolean {
  return key in dictionaries[lang];
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate in the current language (or `lang`). Missing keys fall back to English, then to the key. */
export function t(key: string, vars?: Vars, lang?: Lang): string {
  const l = lang ?? useApp.getState().lang;
  const s = dictionaries[l][key] ?? dictionaries.en[key] ?? key;
  return interpolate(s, vars);
}

/** Hook: returns t bound to the current language and re-renders when the language changes. */
export function useT(): (key: string, vars?: Vars) => string {
  const lang = useApp((s) => s.lang);
  return useCallback((key: string, vars?: Vars) => t(key, vars, lang), [lang]);
}

export function useLang(): Lang {
  return useApp((s) => s.lang);
}
