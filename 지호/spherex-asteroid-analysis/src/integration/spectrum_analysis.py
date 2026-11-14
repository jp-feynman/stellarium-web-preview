"""Shared analysis chain for an extracted spectrum (used by the pipeline and by validation):

  quality selection -> relative spectral calibration (solar analogs; OBSERVED data) ->
  observation-time analysis -> data-supported brightness correction ->
  reflected/thermal fit (one normalisation group) -> reflectance for every point ->
  band analysis -> classification (shape + slope, band evidence) -> consistency downgrades.

No target-specific information is used: the inputs are the spectrum, an optional H result and an
optional rotation period. Reference taxonomies are only used by src/validation. The solar-analog
correction is built from stars only (src/preprocessing/solar_analog_calibration.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..classification.mineral_identification import analyse_minerals
from ..classification.taxonomy import classify
from ..common import status
from ..physical.albedo import albedo_from_thermal_fit
from ..common.config import settings
from ..preprocessing.solar_analog_calibration import (SolarAnalogCorrection, apply_correction,
                                                      calibration_slope_sigma, load_correction)
from ..preprocessing.spectrum_cleaning import reject_outliers, select_usable
from ..preprocessing.temporal_analysis import (analyse_temporal, apply_temporal_correction,
                                               slope_systematic_per_um)
from ..preprocessing.thermal_separation import ThermalSeparator, reflectance_spectrum


@dataclass
class SpectrumAnalysis:
    clean: pd.DataFrame
    temporal: object
    corrected: pd.DataFrame
    thermal: object = None
    diameter: object = None
    albedo: object = None
    reflectance: pd.DataFrame | None = None
    minerals: object = None
    taxonomy: object = None
    slope_sys_per_um: float | None = None
    thermal_fit_group: int | None = None
    separator: object = None
    calibration: dict | None = None
    saturation: dict | None = None
    log: list = field(default_factory=list)


def saturated_mask(df: pd.DataFrame) -> np.ndarray:
    """Points whose PSF core contains a saturation plane (extraction.saturation_flags)."""
    flags = set(settings()["extraction"].get("saturation_flags", []))
    if "core_flags" not in df or not flags:
        return np.zeros(len(df), bool)
    return df["core_flags"].fillna("").astype(str).map(lambda s: bool(set(s.split("|")) & flags)).values


def _handle_saturated(clean: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Apply temporal.saturated_points to the points with a saturated PSF core (wing-only photometry):
      inflated        - used everywhere with an error floor (temporal.saturated_flux_error_frac, the scatter
                        measured on the calibration stars); the classification is also repeated without
                        them (saturation_sensitivity) and its confidence lowered if the result changes;
      lightcurve_only - used, with the floor, for the observation-time analysis only;
      exclude         - not used;   all - used everywhere with nominal errors.
    Saturated points are marked in the column saturated_core."""
    cfg = settings()["temporal"]
    mode = cfg.get("saturated_points", "inflated")
    sat = saturated_mask(clean)
    info = {"n_saturated": int(sat.sum()), "mode": mode, "drop_from_spectrum": False}
    if not sat.any() or mode == "all":
        info["use"] = "used everywhere with nominal errors" if sat.any() else "none"
        return clean, info
    if mode == "exclude":
        info["use"] = "excluded"
        return clean[~sat].reset_index(drop=True), info
    floor = float(cfg.get("saturated_flux_error_frac", 0.08))
    out = clean.copy()
    out["saturated_core"] = sat
    out.loc[sat, "flux_err_uJy"] = np.hypot(out.loc[sat, "flux_err_uJy"], floor * out.loc[sat, "flux_uJy"].abs())
    info["error_floor_frac"] = floor
    if mode == "lightcurve_only":
        info["drop_from_spectrum"] = True
        info["use"] = (f"used for the brightness (lightcurve) analysis only, with a {100 * floor:.0f}% error floor; "
                       "excluded from the thermal fit, reflectance and classification")
    else:
        info["use"] = (f"used with a {100 * floor:.0f}% error floor (wing-only photometry); the classification is "
                       "repeated without them")
    return out, info


def saturation_sensitivity(refl: pd.DataFrame, tax, slope_sys_per_um, band_I) -> dict | None:
    """Classification with and without the saturated points (mode 'inflated'). Their wing-only photometry
    scatters by 7-8% with star-dependent offsets of several percent, so a conclusion that changes when they
    are left out depends on that photometry: the confidence is then Low."""
    if "saturated_core" not in refl or not refl["saturated_core"].astype(bool).any():
        return None
    base = tax.complex_ranking[0]["complex"]
    t = classify(refl[~refl["saturated_core"].astype(bool)], slope_sys_per_um=slope_sys_per_um,
                 band_evidence={"band_I_detected": bool(band_I is not None and band_I.detected)})
    alt = t.complex_ranking[0]["complex"] if t.complex_ranking else None
    res = {"baseline_complex": base, "n_saturated": int(refl["saturated_core"].astype(bool).sum()),
           "without_saturated": {"complex": alt, "status": t.status,
                                 "probability": float(t.complex_ranking[0]["probability"]) if t.complex_ranking else None},
           "stable": alt == base}
    tax.saturation_sensitivity = res
    if alt != base:
        tax.confidence = status.CONF_LOW
        tax.confidence_reasons.append(f"most probable complex changes ({base} -> {alt or t.status}) without the "
                                      f"{res['n_saturated']} saturated (wing-only) points")
        tax.limitations.append(f"The classification depends on {res['n_saturated']} points with a saturated PSF core: "
                               f"without them the most probable complex is {alt or t.status}.")
    return res


def resolve_calibration(calibration, spectrum: pd.DataFrame) -> SolarAnalogCorrection | None:
    """calibration: a SolarAnalogCorrection (used as given), None/False (none), or "auto": the stored
    correction (settings reflectance.solar_analog_correction) if enabled, and only for OBSERVED data -
    it is an instrument calibration of real SPHEREx images, so it is never applied to SIMULATED data
    by default."""
    if isinstance(calibration, SolarAnalogCorrection):
        return calibration
    if calibration != "auto":
        return None
    if not settings()["reflectance"].get("apply_solar_analog_correction", False):
        return None
    origin = spectrum["origin"] if "origin" in spectrum else pd.Series([status.ORIGIN_OBSERVED])
    if len(origin) and not (origin == status.ORIGIN_OBSERVED).all():
        return None
    return load_correction()


def lightcurve_sensitivity(refl: pd.DataFrame, temporal, tax, slope_sys_per_um, band_I) -> dict | None:
    """Stability of the classification against the rotational-lightcurve model (spec 11.2: sensitivity
    analysis). When a periodic lightcurve correction was applied, the per-point corrections are scaled by
    1 -/+ temporal.lightcurve_sensitivity_frac and the spectrum is re-classified. The statistical error of
    the Fourier fit is already in the covariance; this covers the model itself (harmonics, shape), which
    the repeats constrain less well. On 433 Eros two defensible data treatments changed the fitted SWIR
    amplitude by 7% (1.26 vs 1.35 mag) and the class from S to V. If the most probable complex changes,
    the confidence is set to Low. The reflected-light spectrum is perturbed directly (the thermal part
    below 2.45 um is small), so no thermal refit is needed."""
    if not str(temporal.correction).startswith("periodic") or "temporal_corr_mag" not in refl:
        return None
    frac = float(settings()["temporal"].get("lightcurve_sensitivity_frac", 0.10))
    base = tax.complex_ranking[0]["complex"]
    corr_ln = refl["temporal_corr_mag"].fillna(0.0).values / 1.0857
    res = {"fraction": frac, "baseline_complex": base, "perturbed": {}}
    for k in (1.0 - frac, 1.0 + frac):
        r = refl.copy()
        r["reflectance"] = r["reflectance"].values * np.exp(-(k - 1.0) * corr_ln)
        t = classify(r, slope_sys_per_um=slope_sys_per_um,
                     band_evidence={"band_I_detected": bool(band_I is not None and band_I.detected)})
        res["perturbed"][f"x{k:.2f}"] = {"complex": t.complex_ranking[0]["complex"] if t.complex_ranking else None,
                                         "probability": float(t.complex_ranking[0]["probability"]) if t.complex_ranking else None}
    changed = [v["complex"] for v in res["perturbed"].values() if v["complex"] != base]
    res["stable"] = not changed
    tax.lightcurve_sensitivity = res
    if changed:
        tax.confidence = status.CONF_LOW
        tax.confidence_reasons.append(
            f"most probable complex changes ({base} -> {', '.join(sorted(set(changed)))}) when the lightcurve "
            f"correction is scaled by 1 -/+ {frac:.2f}")
        tax.limitations.append("The classification depends on the rotational-lightcurve model: with the correction "
                               f"scaled by 1 -/+ {frac:.2f} the most probable complex becomes "
                               f"{', '.join(sorted(set(changed)))}.")
    return res


def visit_jackknife(refl: pd.DataFrame, tax, slope_sys_per_um, band_I, window=(0.75, 2.45)) -> dict | None:
    """Leave-one-visit-out stability of the classification (spec 11.2: stability against changes of the
    input). A visit is the unit that shares a rotational phase and a calibration state, so a result that
    one visit decides is not robust - e.g. a sparsely sampled band once the saturated points of a bright,
    fast rotator are removed (433 Eros: 3 points left at 0.92-1.04 um). Each visit with points in the
    classification window is removed in turn and the spectrum re-classified; if the most probable complex
    changes in any of these samples, the confidence is set to Low."""
    if "visit" not in refl:
        return None
    w = refl[(refl["wavelength_um"] >= window[0]) & (refl["wavelength_um"] <= window[1])]
    visits = sorted(w["visit"].dropna().unique())
    if len(visits) < 3:
        return None
    base = tax.complex_ranking[0]["complex"]
    ev = {"band_I_detected": bool(band_I is not None and band_I.detected)}
    changes = {}
    for v in visits:
        t = classify(refl[refl["visit"] != v], slope_sys_per_um=slope_sys_per_um, band_evidence=ev)
        top = t.complex_ranking[0]["complex"] if t.complex_ranking else None
        if top != base:
            changes[int(v)] = {"complex": top, "n_points_removed": int((w["visit"] == v).sum())}
    res = {"baseline_complex": base, "n_samples": len(visits), "n_agree": len(visits) - len(changes),
           "changed": changes, "stable": not changes}
    tax.visit_jackknife = res
    if changes:
        tax.confidence = status.CONF_LOW
        alt = sorted({c["complex"] or "none" for c in changes.values()})
        tax.confidence_reasons.append(f"most probable complex changes when single visits are left out "
                                      f"({len(changes)} of {len(visits)} samples: {', '.join(alt)})")
        tax.limitations.append(f"The classification is not stable against leaving out single visits: {len(changes)} of "
                               f"{len(visits)} leave-one-visit-out samples give {', '.join(alt)} instead of {base}.")
    return res


def _not_applied_reason(calibration, corr, df: pd.DataFrame) -> str:
    if calibration is None or calibration is False:
        return "not requested"
    if corr is not None:
        return "spectrum has no detector column" if len(df) else "empty spectrum"
    if not settings()["reflectance"].get("apply_solar_analog_correction", False):
        return "disabled in settings (reflectance.apply_solar_analog_correction)"
    if "origin" in df and len(df) and not (df["origin"] == status.ORIGIN_OBSERVED).all():
        return "the stored correction is applied to OBSERVED data only"
    return "no stored correction (build it with: python main.py solar-analog-calibration)"


def _reference_group(df: pd.DataFrame, sep: ThermalSeparator):
    """Normalisation group with the best joint coverage of the reflected continuum and the thermal
    region (a diameter needs both under one normalisation)."""
    lo, hi = sep.cfg["reflected_continuum_region_um"]
    best, score = None, -1
    for g, gg in df.groupby("norm_group"):
        n_c = int(((gg["wavelength_um"] >= lo) & (gg["wavelength_um"] <= hi)).sum())
        n_t = int((gg["wavelength_um"] >= sep.cfg["thermal_region_min_um"]).sum())
        if min(n_c, n_t) > score:
            best, score = g, min(n_c, n_t)
    return best, score


def analyse_spectrum(spectrum: pd.DataFrame, *, h_result=None, sbdb=None, rotation_period_h: float | None = None,
                     G: float | None = None, log=print, temporal_cfg: dict | None = None,
                     separator: ThermalSeparator | None = None, calibration="auto") -> SpectrumAnalysis:
    msgs = []

    def L(m):
        msgs.append(m)
        log(m)

    clean = select_usable(spectrum)
    clean = reject_outliers(clean, "flux_uJy", "flux_err_uJy")
    clean = clean[~clean["outlier"]].reset_index(drop=True)
    clean, sat_info = _handle_saturated(clean)
    if sat_info["n_saturated"]:
        L(f"  [saturation] {sat_info['n_saturated']} points with a saturated PSF core: {sat_info['use']}.")
    corr = resolve_calibration(calibration, clean)
    if corr is not None and len(clean) and "detector" in clean:
        clean, cal_info = apply_correction(clean, corr)
        L(f"  [calibration] solar-analog relative correction applied ({cal_info['n_stars']} stars; largest "
          f"|C - 1| = {100 * cal_info['max_abs_correction']:.1f}%; slope uncertainty "
          f"{100 * calibration_slope_sigma(corr):.2f} %/um)")
        for w in cal_info["warnings"]:
            L("  [calibration] " + w)
    else:
        cal_info = {"applied": False, "reason": _not_applied_reason(calibration, corr, clean)}
        if calibration == "auto":
            L(f"  [calibration] solar-analog relative correction not applied: {cal_info['reason']}.")
    sep = separator or ThermalSeparator()          # lightcurve handled upstream from repeated observations
    G = G if G is not None else (h_result.G if h_result is not None and h_result.G is not None
                                 else sep.cfg["default_G"])
    alpha = float(np.median(clean["phase_deg"])) if len(clean) else 0.0
    eta0 = sep.eta_prior(alpha)["eta0"] if sep.cfg.get("eta_mode") == "phase_prior" else sep.cfg["eta_default"]

    temporal = analyse_temporal(clean, rotation_period_h=rotation_period_h, G=G, eta0=eta0, cfg=temporal_cfg)
    for w in temporal.warnings:
        L("  [time] " + w)
    corrected = apply_temporal_correction(clean, temporal)
    if sat_info.get("drop_from_spectrum") and "saturated_core" in corrected:
        # saturated points informed the brightness corrections only; the spectrum uses the others
        corrected = corrected[~corrected["saturated_core"].astype(bool)].reset_index(drop=True)
    out = SpectrumAnalysis(clean=clean, temporal=temporal, corrected=corrected, separator=sep, log=msgs,
                           calibration=cal_info, saturation=sat_info)
    if corrected.empty:
        return out

    fit_df = corrected
    if corrected["norm_group"].nunique() > 1:
        g, score = _reference_group(corrected, sep)
        out.thermal_fit_group = g
        fit_df = corrected[corrected["norm_group"] == g]
        L(f"  [thermal] fitted on normalisation group {g} only ({len(fit_df)} points): other groups are not "
          "linked to it by the data.")
    albedo, dres = albedo_from_thermal_fit(fit_df, h_result, sep, sbdb=sbdb)
    out.albedo, out.diameter = albedo, dres
    thermal = dres.thermal_fit if dres is not None else None
    out.thermal = thermal
    if thermal is None or thermal.points is None:
        return out
    pts = thermal.points
    if len(fit_df) != len(corrected):
        other = sep.components(corrected, thermal)
        if other is not None:
            pts = other
    refl = reflectance_spectrum(pts, sep.solar, sep.G)
    out.reflectance = refl
    thermal_ok = thermal.status == "OK"

    pre = analyse_minerals(refl, thermal_removed=thermal_ok)
    b1 = pre.band("Band I")
    out.slope_sys_per_um = slope_systematic_per_um(refl, temporal)
    if cal_info.get("applied") and out.slope_sys_per_um is not None:
        # the mean correction's slope is uncertain by the star-to-star colour scatter / sqrt(N)
        out.slope_sys_per_um = float(np.hypot(out.slope_sys_per_um, calibration_slope_sigma(corr, "SWIR")))
    tax = classify(refl, slope_sys_per_um=out.slope_sys_per_um,
                   band_evidence={"band_I_detected": bool(b1 is not None and b1.detected)})
    if thermal_ok and thermal.chi2_red is not None and thermal.chi2_red > sep.cfg["chi2_red_warning"]:
        msg = (f"Thermal model fits poorly (chi2_red {thermal.chi2_red:.1f}); reflectance derived from it "
               "is less reliable.")
        if tax.candidates:
            tax.confidence = status.CONF_LOW
            tax.confidence_reasons.append(msg)
        tax.limitations.append(msg)
        if albedo is not None and albedo.status == "ESTIMATED":
            albedo.status = "ON_HOLD_VALIDATION"
            albedo.warnings.append(msg + " Albedo on hold.")
    if tax.candidates:
        lightcurve_sensitivity(refl, temporal, tax, out.slope_sys_per_um, b1)
        visit_jackknife(refl, tax, out.slope_sys_per_um, b1)
        saturation_sensitivity(refl, tax, out.slope_sys_per_um, b1)
    out.taxonomy = tax
    out.minerals = analyse_minerals(
        refl, albedo_pV=albedo.geometric_albedo if albedo is not None and albedo.status == "ESTIMATED" else None,
        thermal_removed=thermal_ok,
        spectrum_fit_chi2_red=tax.candidates[0]["chi2_red"] if tax.candidates else None)
    return out
