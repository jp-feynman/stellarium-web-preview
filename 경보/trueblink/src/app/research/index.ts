// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Research-mode presentational components: props in, callbacks out, no store and no network.
// Import './research.css' once (the components import it themselves).

import './research.css';

export { SpectrumChart } from './SpectrumChart';
export type { SpectrumChartProps, SpectrumBin, SpectrumReference } from './SpectrumChart';
export { LightCurveChart } from './LightCurveChart';
export type { LightCurveChartProps, LightCurveSeries, LightCurvePoint } from './LightCurveChart';
export { RatioChart } from './RatioChart';
export type { RatioChartProps, RatioRow } from './RatioChart';
export { CoverageChart } from './CoverageChart';
export type { CoverageChartProps, CoverageExposure } from './CoverageChart';
export { ExposureTable, exposuresToCsv, downloadText, EXPOSURE_CSV_COLUMNS } from './ExposureTable';
export type { ExposureTableProps, ExposureRow, ExposureStatus } from './ExposureTable';
export { MotionPanel } from './MotionPanel';
export type { MotionPanelProps, MotionEpoch, MotionFit } from './MotionPanel';
export { FlagLegend } from './FlagLegend';
export type { FlagLegendProps } from './FlagLegend';
export { ProvenancePanel } from './ProvenancePanel';
export type { ProvenancePanelProps, ProvenanceItem, Citation } from './ProvenancePanel';
export { AsteroidPanel } from './AsteroidPanel';
export type { AsteroidPanelProps, ReflectancePoint, ReflectanceTemplate, ThermalModel, Classification } from './AsteroidPanel';
export { en as researchStringsEn, ko as researchStringsKo, makeT, tEn } from './strings';
export type { StringKey as ResearchStringKey, Translate } from './strings';
export {
  toCsv,
  sortRows,
  windowRange,
  niceTicks,
  logTicks,
  timeTicks,
  timeSegments,
  weightedMean,
  motionVerdict,
  normaliseAt,
  mjdToUtc,
  s3HttpsUrl,
  FLAG_INFO,
  flagNames,
  evidenceSteps,
  EVIDENCE_LEVELS,
} from './helpers';
export type { EvidenceLevel, FlagInfo, FlagGroup, SortDir, WeightedStats, MotionVerdict, TimeTick, TimeSegment } from './helpers';
