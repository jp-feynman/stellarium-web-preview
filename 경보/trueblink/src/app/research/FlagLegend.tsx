// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// The 23 SPHEREx pixel flags, grouped by what they mean for a scientist: real defects, artefacts
// that appear near bright stars, and labels that carry information only. SOURCE (a catalogued star
// is here) and OUTLIER (statistically unusual, perhaps a real mover) are never bad pixels.

import { useT } from './chart';
import { FLAG_INFO, fill } from './helpers';
import type { FlagGroup } from './helpers';
import type { Translate } from './strings';

export interface FlagLegendProps {
  /** Number of flagged pixels (or exposures) per flag name. */
  counts: Record<string, number>;
  selected?: string[];
  /** Without it the legend is a read-only list (nothing on the blink view reacts to a selection). */
  onToggle?(name: string): void;
  t?: Translate;
}

const GROUPS: FlagGroup[] = ['defect', 'bright', 'info'];

export function FlagLegend(props: FlagLegendProps) {
  const t = useT(props.t);
  const sel = new Set(props.selected ?? []);
  const toggle = props.onToggle;
  return (
    <section className="rs-card rs-flags" aria-label={t('flags.title')}>
      <header className="rs-cardhead">
        <h3>{t('flags.title')}</h3>
        <span className="rs-muted">
          <span className="rs-pchip" aria-hidden="true">P</span> = {t('flags.photMask')}
        </span>
      </header>
      <div className="rs-flaggroups">
        {GROUPS.map((g) => (
          <div key={g} className={`rs-flaggroup rs-fg-${g}`}>
            <h4>{t(`flags.group.${g}`)}</h4>
            <ul>
              {FLAG_INFO.filter((f) => f.group === g).map((f) => {
                const n = props.counts[f.name] ?? 0;
                const on = sel.has(f.name);
                const body = (
                  <>
                      <span className="rs-flagname">
                        {f.name}
                        <span className="rs-bit">bit {f.bit}</span>
                        {f.inPhotometryMask && (
                          <span className="rs-pchip" title={t('flags.photMask')}>
                            P
                          </span>
                        )}
                      </span>
                      <span className="rs-flagcount">{n.toLocaleString('en-US')}</span>
                      <span className="rs-flagdesc">{t(`flag.${f.name}`)}</span>
                  </>
                );
                return (
                  <li key={f.name}>
                    {toggle ? (
                      <button type="button" className={`rs-flag${on ? ' rs-on' : ''}${n === 0 ? ' rs-zero' : ''}`} aria-pressed={on} onClick={() => toggle(f.name)} aria-label={fill(t('flags.toggle'), { name: f.name, n })}>
                        {body}
                      </button>
                    ) : (
                      <div className={`rs-flag rs-static${n === 0 ? ' rs-zero' : ''}`}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
