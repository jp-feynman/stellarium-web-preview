// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// core/solar: asteroid science for the Research mode (reflected sunlight, thermal models, reflectance
// spectra and broad Bus-DeMeo taxonomy). Pure functions, no DOM, no network.

export { solarFluxMjy, SOLAR_TABLE_RANGE_UM } from './sun';
export {
  neatmFlux,
  stmFlux,
  reflectedFlux,
  toReflectance,
  fitThermalTail,
  crossoverWavelength,
  planckNu,
  phaseIntegral,
  hgPhase,
  diameterFromH,
  absoluteMagnitude,
  subsolarTemperature,
  THERMAL_NOTES,
  STM_ETA,
  STM_PHASE_MAG_PER_DEG,
  AU_KM,
  D0_KM,
  S0_W_M2,
} from './thermal';
export type { ThermalParams, StmParams, ReflectedParams, AsteroidPoint } from './thermal';
export { classifyBusDemeo, describeGroup, BUS_DEMEO_GROUPS, TAXONOMY_LIMITS } from './taxonomy';
export type { TaxonomyResult } from './taxonomy';
