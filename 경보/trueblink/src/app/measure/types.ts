// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Result types of the measurement module.
import type { MotionFit } from '../../core/astrometry';
import type { LightCurvePoint } from '../../core/phot';
import type { PhotPoint, SkyPos } from '../../core/types';
import type { BrightnessVerdict, CombinedRatio, ControlStar, DetectorRatio, VisitOffset } from './core';

export type MotionFitResult = MotionFit & { twoPoint: boolean };

export interface RatioResult {
  visitA: number;
  visitB: number;
  labelA: string;
  labelB: string;
  rows: { cubeChannel: number; wavelength: number; ratio: number; ratioErr: number }[];
  combined: { ratio: number; ratioErr: number; n: number };
  /** The same robust ratio for 0.75-2.4 um (cube channels 1-51) and 2.4-5.0 um (52-102) separately. */
  bands?: { short: CombinedRatio; long: CombinedRatio };
  /** The same robust ratio per detector array. */
  perDetector?: DetectorRatio[];
  /**
   * Saturated targets: the wing ring used, and the band ratios again with a ring 2 px further out
   * (how much the number depends on where around the core it is measured).
   */
  rings?: { phot: { rin: number; rout: number }; alt: { rin: number; rout: number }; altBands: { short: CombinedRatio; long: CombinedRatio } };
}

export interface MotionResult {
  /** Per-visit mean offsets (arcsec) from the first visit. */
  epochs: VisitOffset[];
  fit: MotionFitResult | null;
  /** Catalogue proper motion (mas/yr) when the target has one. */
  catalogue?: { pmRa: number; pmDec: number; total: number };
  /** Detectors used for the centroids. */
  detectors: number[];
  method: 'centroid' | 'wings';
  /** Number of single-exposure centroids used. */
  nCentroids: number;
  significant: boolean;
  threshold: number;
  controlMedian: number;
}

export interface ControlResult {
  star: ControlStar;
  points: PhotPoint[];
  epochs: VisitOffset[];
  fit: MotionFitResult | null;
  ratio: { ratio: number; ratioErr: number; n: number } | null;
  /** Its ratio for 0.75-2.4 um and 2.4-5.0 um separately (same visits as the target). */
  bands?: { short: CombinedRatio; long: CombinedRatio } | null;
  lightCurve: LightCurvePoint[];
}

export interface Neighbour {
  id: string;
  mag?: number;
  sepArcsec: number;
  date: string;
}

export interface MeasureResult {
  sessionId: number;
  /** The fixed position measured, or null when the session target (propagated) was measured. */
  pos: SkyPos | null;
  isTarget: boolean;
  targetName: string;
  points: PhotPoint[];
  binned: { wavelength: number; flux: number; fluxErr: number; n: number; cubeChannel: number }[];
  lightCurve: LightCurvePoint[];
  ratio: RatioResult | null;
  brightness: BrightnessVerdict | null;
  motion: MotionResult | null;
  controls: ControlResult[];
  /** Saturated target: brightness from the wings (relative), centroids on the wings. */
  relative: boolean;
  /** Saturated targets: the wing photometry ring (px). */
  wingRing?: { rin: number; rout: number };
  saturatedCount: number;
  /** Cold object: motion restricted to detectors 5 and 6. */
  cold: boolean;
  neighbours: Neighbour[];
  /** Exposures used / skipped. */
  nCutouts: number;
  notes: string[];
}
