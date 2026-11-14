// Integration with the team's planetarium. Labels are display text, never catalogue queries.
import { SKY_APP_URL } from '../config';
import { getPipeline } from '../seams';
import { useApp } from '../store';

export function closePlanetariumAnalysis(): void {
  getPipeline()?.cancel();
  useApp.getState().setPlaying(false);
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'spherex-analysis-close' }, window.location.origin);
  } else {
    window.location.assign(SKY_APP_URL);
  }
}

export function PlanetariumHeader() {
  const lang = useApp((s) => s.lang);
  const label = useApp((s) => s.sourceLabel);
  const target = useApp((s) => s.target);
  const center = useApp((s) => s.center);
  const ko = lang === 'ko';
  return (
    <header className="planetarium-header">
      <div>
        <p className="eyebrow">SPHEREx · TrueBlink</p>
        <h1>{label || target?.name || (ko ? '선택한 하늘 영역 분석' : 'Selected sky field')}</h1>
        <p className="small muted">
          {center ? `ICRF · RA ${center.ra.toFixed(6)}° · Dec ${center.dec.toFixed(6)}°` : (ko ? '선택한 좌표의 관측 자료를 확인합니다.' : 'Opening observations at the selected coordinates.')}
        </p>
      </div>
      <button className="btn" type="button" onClick={closePlanetariumAnalysis}>
        {ko ? '플라네타리움으로 돌아가기' : 'Back to planetarium'} <span aria-hidden="true">×</span>
      </button>
    </header>
  );
}
