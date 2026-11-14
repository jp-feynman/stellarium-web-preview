"""Merge stage outputs into one integrated record per asteroid (schema: RESULT_COLUMNS)."""
from __future__ import annotations

import json

import numpy as np

from ..common import status
from ..common.config import model_version
from ..common.provenance import utc_now


def _fmt(v):
    if v is None:
        return None
    if isinstance(v, float) and not np.isfinite(v):
        return None
    return v


def merge(asteroid_id: str, *, sbdb=None, search=None, spectrum=None, taxonomy=None, minerals=None,
          thermal=None, h_result=None, diameter=None, albedo=None, mass=None, density=None,
          calibration: dict | None = None, origin: str = status.ORIGIN_OBSERVED) -> dict:
    rec = {"asteroid_id": asteroid_id, "origin": origin, "analysis_timestamp": utc_now(),
           "model_version": model_version()}
    missing, limitations, sources = [], [], []
    if sbdb is not None and sbdb.found:
        rec["official_name"] = sbdb.fullname
        rec["provisional_designation"] = sbdb.designation
        rec["discovery_status"] = "Catalogued (JPL SBDB)"
        if sbdb.source:
            sources.append(sbdb.source.to_dict())
    else:
        rec["discovery_status"] = status.UNKNOWN
    if search is not None and not search.observations.empty:
        o = search.observations
        rec["observation_date"] = f"MJD {o['mjd_mid'].min():.4f}-{o['mjd_mid'].max():.4f}"
        rec["right_ascension"] = float(o["pred_ra_deg"].iloc[0])
        rec["declination"] = float(o["pred_dec_deg"].iloc[0])
        rec["spherex_observation_id"] = sorted(o["obs_id"].unique().tolist())[:200]
        sources.extend(search.provenance.sources)
    if spectrum is not None and len(spectrum):
        rec["n_spectral_points"] = int(len(spectrum))
        rec["signal_to_noise_median"] = float(np.nanmedian(spectrum["snr"]))
        rec["quality_flag"] = spectrum["quality_flag"].value_counts().to_dict()
    else:
        missing.append("SPHEREx spectrum")
    if taxonomy is not None and taxonomy.candidates:
        top = taxonomy.candidates[0]
        rec["spectral_class"] = f"{taxonomy.best_class} candidate"
        # ranked list, highest probability first (all reference classes)
        rec["spectral_class_probability"] = [
            {"rank": int(c["rank"]), "class": c["class"], "complex": c["complex"],
             "probability": round(float(c["probability"]), 6)} for c in (taxonomy.ranking or taxonomy.candidates)]
        rec["spectral_complex_probability"] = taxonomy.complex_ranking
        rec["spectral_complex"] = taxonomy.best_complex
        rec["classification_confidence"] = taxonomy.confidence
        limitations.extend(taxonomy.limitations)
    else:
        rec["spectral_class"] = status.INSUFFICIENT_DATA
        missing.append("spectral classification")
    if calibration is not None:
        rec["spectral_calibration"] = {k: calibration.get(k) for k in (
            "applied", "reason", "n_stars", "stars", "chi2_red", "slope_sigma_per_um", "max_abs_correction",
            "n_uncorrected", "file", "data_releases_calibration", "warnings") if k in calibration}
        if not calibration.get("applied"):
            limitations.append("Solar-analog relative spectral calibration not applied: "
                               + str(calibration.get("reason", status.UNKNOWN)) + ".")
    if minerals is not None:
        rec["mineral_candidates"] = minerals.candidates or status.UNKNOWN
        rec["absorption_features"] = [b.__dict__ for b in minerals.bands]
        limitations.extend(minerals.limitations)
    if thermal is not None:
        rec["estimated_temperature"] = _fmt(thermal.T_ss_K)
        rec["estimated_temperature_err"] = _fmt(thermal.T_ss_err_K)
    if h_result is not None:
        rec["absolute_magnitude_H"] = _fmt(h_result.H) if h_result.reliable else h_result.status
        rec["H_uncertainty"] = _fmt(h_result.H_err)
        rec["absolute_magnitude_source"] = f"{h_result.source} {h_result.reference}".strip() or h_result.status
        rec["photometry_source_ids"] = h_result.photometry_sources
        rec["filter_system"] = h_result.filters or h_result.band
        rec["phase_function_model"] = h_result.phase_model
        rec["phase_function_parameters"] = {"G": h_result.G, "G_err": h_result.G_err, "G_fitted": h_result.G_fitted}
        rec["photometry_epochs"] = h_result.n_points
        rec["photometry_quality"] = {"rms_mag": h_result.rms_mag, "n_nights": h_result.n_nights,
                                     "excluded": h_result.excluded, "warnings": h_result.warnings}
        if not h_result.reliable:
            missing.append("absolute magnitude H")
    if diameter is not None:
        if diameter.diameter_km is not None:
            rec["diameter_km"] = diameter.diameter_km
            rec["diameter_uncertainty"] = diameter.diameter_total_err_km
            rec["diameter_source"] = f"SPHEREx {diameter.model} fit (eta={'fitted' if diameter.eta_fitted else 'fixed'})"
        else:
            rec["diameter_km"] = None
            rec["diameter_source"] = diameter.status
            missing.append("diameter")
        rec["diameter_conditional_range_km"] = diameter.conditional_range_km
        rec["catalog_diameter_km"] = diameter.catalog_diameter_km
        rec["catalog_diameter_uncertainty"] = diameter.catalog_diameter_err_km
        rec["catalog_diameter_source"] = diameter.catalog_diameter_ref
    if albedo is not None:
        ok = albedo.status in ("ESTIMATED", "ON_HOLD_VALIDATION") and albedo.geometric_albedo is not None
        rec["geometric_albedo_pV"] = albedo.geometric_albedo if ok else None
        rec["albedo_uncertainty"] = albedo.albedo_err if ok else None
        rec["albedo_band"] = albedo.band if ok else None
        rec["albedo_method"] = albedo.method if ok else None
        rec["albedo_status"] = albedo.status if ok else f"{albedo.status}: missing {', '.join(albedo.missing_inputs)}"
        if not ok:
            missing.append("geometric albedo")
    if mass is not None:
        rec["mass_kg"] = mass.mass_kg if mass.mass_kg is not None else status.UNKNOWN
        rec["mass_uncertainty"] = mass.mass_err_kg
        rec["mass_method"] = f"{mass.method} {mass.source}".strip() or mass.notes
        if mass.mass_kg is None:
            missing.append("mass")
    if density is not None:
        rec["density"] = density.density_kg_m3 if density.density_kg_m3 is not None else status.UNKNOWN
        rec["density_uncertainty"] = density.density_err_kg_m3
        rec["density_unit"] = "kg/m^3"
        rec["shape_assumption"] = density.shape_assumption or None
        if density.status == "ON_HOLD_VALIDATION":
            limitations.append(f"Density on hold: {density.notes}")
    rec["missing_data"] = missing
    rec["limitations"] = sorted(set(limitations))
    rec["input_data_sources"] = sources[:100]
    rec["quality_status"] = "Complete" if not missing else "Partial"
    confs = [x for x in (getattr(taxonomy, "confidence", None), getattr(diameter, "confidence", None),
                         getattr(albedo, "confidence", None)) if x and x != status.CONF_NONE]
    order = [status.CONF_LOW, status.CONF_MEDIUM, status.CONF_HIGH]
    rec["confidence_level"] = min(confs, key=order.index) if confs else status.CONF_NONE
    return rec
