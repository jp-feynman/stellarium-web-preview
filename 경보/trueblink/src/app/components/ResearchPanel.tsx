// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Research side panel: tabs whose bodies come from registerResearchTab (src/app/research fills them).
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { getResearchTabs, onResearchTabsChange, type ResearchTab } from '../seams';
import { useApp } from '../store';

const BUILT_IN = ['frames', 'measure', 'overlays', 'asteroid', 'provenance'];

function Placeholder() {
  const t = useT();
  const frames = useApp((s) => s.frames.length);
  const exposures = useApp((s) => s.exposures.length);
  const points = useApp((s) => s.spectrum.length);
  return (
    <div className="placeholder">
      <p>{t('research.placeholder')}</p>
      <p className="muted small">{t('research.placeholder.detail', { frames, exposures, points })}</p>
    </div>
  );
}

function useTabs(): ResearchTab[] {
  const [tabs, setTabs] = useState(getResearchTabs);
  useEffect(() => onResearchTabsChange(() => setTabs(getResearchTabs())), []);
  const byId = new Map(tabs.map((x) => [x.id, x]));
  const builtIn = BUILT_IN.map((id) => byId.get(id) ?? { id, title: `research.tab.${id}`, Component: Placeholder });
  const extra = tabs.filter((x) => !BUILT_IN.includes(x.id));
  return [...builtIn, ...extra];
}

export function ResearchPanel() {
  const t = useT();
  const tabs = useTabs();
  const active = useApp((s) => s.researchTab);
  const setTab = useApp((s) => s.setResearchTab);
  const current = tabs.find((x) => x.id === active) ?? tabs[0];

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKey = (e: KeyboardEvent) => {
    const k = tabs.findIndex((x) => x.id === current.id);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.id);
      document.getElementById(`rtab-${next.id}`)?.focus();
    }
  };

  const Body = current.Component;
  return (
    <section className="card research" aria-label={t('panel.research')} data-testid="research-panel">
      <div className="tabs" role="tablist" aria-label={t('panel.research')} onKeyDown={onKey}>
        {tabs.map((x) => (
          <button
            key={x.id}
            id={`rtab-${x.id}`}
            type="button"
            role="tab"
            aria-selected={x.id === current.id}
            aria-controls={`rpanel-${x.id}`}
            tabIndex={x.id === current.id ? 0 : -1}
            className={x.id === current.id ? 'on' : ''}
            onClick={() => setTab(x.id)}
          >
            {t(x.title)}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel" id={`rpanel-${current.id}`} aria-labelledby={`rtab-${current.id}`}>
        <Body />
      </div>
    </section>
  );
}
