"""Taxonomy validation against a target with a known reference taxonomy (e.g. 433 Eros, S-type).

The reference taxonomy is read from config/validation_targets.yaml (and cross-checked against the
JPL SBDB taxonomy field). It is used ONLY here, to score the result - the analysis and the
classifier never receive it (criterion C8 verifies this statically).

Criteria
  C1  The ~1-um band is detected when the data support it (a typical band would be detectable).
  C2  The ~2-um band is evaluated (status, depth / upper limit, detectability reported).
  C3  A red continuum slope alone does not cause a D-type classification
      (data check + counterfactual: band-bearing class templates reddened to D-like slope,
      sampled and weighted exactly like the observations, must not become D; a D template must).
  C4  Observation-time differences are detected (visits, segment time offsets, variability test).
  C5  No unsupported rotational correction: applied corrections satisfy the support criteria, and
      with the repeated observations removed (or without a period) no rotational correction is made.
  C6  Classification confidence decreases when the spectrum cannot distinguish S-complex from D-type
      (counterfactuals: 1-um region removed; errors inflated).
  C7  Most probable complex vs the reference complex.
  C8  No target-specific information in the classification code.
"""
from __future__ import annotations

import ast
import inspect
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from ..classification.mineral_identification import DETECTED, NOT_DETECTED, NOT_EVALUABLE
from ..classification.reference_library import load_busdemeo, resample_reference
from ..classification.taxonomy import classify
from ..common.config import PROJECT_ROOT, resolve, settings
from ..i18n import t
from ..integration.spectrum_analysis import analyse_spectrum
from ..preprocessing.temporal_analysis import analyse_temporal

PASS, FAIL, INCONCLUSIVE = "PASS", "FAIL", "INCONCLUSIVE"
CONF_RANK = {"High": 3, "Medium": 2, "Low": 1, "None": 0}


@dataclass
class Criterion:
    id: str
    name: str
    result: str
    evidence: dict = field(default_factory=dict)
    explanation: str = ""


@dataclass
class ValidationReport:
    target: str
    reference: dict
    criteria: list = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    analysis_summary: dict = field(default_factory=dict)
    origin: str = "OBSERVED"

    def to_dict(self):
        return {"target": self.target, "reference": self.reference, "origin": self.origin,
                "summary": self.summary, "analysis_summary": self.analysis_summary,
                "criteria": [asdict(c) for c in self.criteria]}


TOLEN_TO_COMPLEX = {"A": "A-type", "B": "C-complex", "C": "C-complex", "F": "C-complex", "G": "C-complex",
                    "D": "D-type", "E": "X-complex", "M": "X-complex", "P": "X-complex", "X": "X-complex",
                    "Q": "Q-type", "R": "R-type", "S": "S-complex", "T": "T-type", "V": "V-type", "K": "K-type"}
BUS_EXTRA = {"Sk": "S-complex", "Sl": "S-complex", "Ld": "L-type"}


def reference_from_sbdb(sbdb, name: str = "") -> dict:
    """Reference taxonomy from the JPL SBDB taxonomy fields: SMASSII (spec_B, Bus & Binzel 2002) if
    present, else Tholen (spec_T; first letter = preferred class). Both are visible-wavelength
    taxonomies, so the comparison with a near-infrared (SPHEREx) classification is made at complex
    level."""
    from ..classification.reference_library import complex_of
    b = sbdb.param("spec_B").raw_value.strip() if sbdb.param("spec_B") is not None else None
    tt = sbdb.param("spec_T").raw_value.strip() if sbdb.param("spec_T") is not None else None
    if b:
        cls = b.rstrip(":")
        cx = BUS_EXTRA.get(cls) or complex_of(cls)
        field_name, src = "spec_B", f"JPL SBDB spec_B (SMASSII, Bus & Binzel 2002): {b}"
    elif tt:
        cls = tt[0]
        cx = TOLEN_TO_COMPLEX.get(cls, "Other")
        field_name, src = "spec_T", f"JPL SBDB spec_T (Tholen): {tt}"
    else:
        raise KeyError("SBDB has no taxonomy for this object")
    other = [f"JPL SBDB spec_T (Tholen): {tt}"] if b and tt else []
    return {"name": name or sbdb.fullname, "reference_taxonomy": {"class": cls, "complex": cx, "sources": [src] + other,
                                                                   "cross_check_sbdb_field": field_name,
                                                                   "basis": "visible-wavelength taxonomy"}}


def load_reference(target: str) -> dict:
    with open(resolve("config/validation_targets.yaml"), encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    ref = (cfg.get("targets") or {}).get(str(target))
    if ref is None:
        raise KeyError(f"No validation reference for target {target} in config/validation_targets.yaml")
    return ref


# ----------------------------------------------------------------------------- criteria
def _c1(ana, reference: dict) -> Criterion:
    """Band-bearing reference: a 1-um band must be found when the data are sensitive enough to see a
    typical band. Featureless reference: no band may be claimed (no false detection)."""
    from ..classification.mineral_identification import BAND_BEARING_CLASSES
    b = ana.minerals.band("Band I") if ana.minerals else None
    if b is None:
        return Criterion("C1", t("validation.c1"), FAIL, explanation="Band I was not evaluated.")
    expect_band = reference.get("class") in BAND_BEARING_CLASSES
    ev = {"status": b.status, "evidence": b.evidence, "centre_um": b.center_um, "depth": b.depth,
          "depth_err": b.depth_err, "min_detectable_depth": b.min_detectable_depth,
          "typical_band_depth": b.typical_depth, "detectable": b.detectable,
          "within_segment": {k: v for k, v in (b.within_segment or {}).items() if k != "window_um"}}
    supported = b.status != NOT_EVALUABLE and bool(b.detectable)
    ev["band_expected_for_reference"] = expect_band
    if not expect_band:
        return Criterion("C1", t("validation.c1"), FAIL if b.detected else PASS, ev,
                         "Reference class has no 1-um band: " + ("a band was (falsely) detected." if b.detected
                                                                 else "no band claimed (correct)."))
    if b.detected:
        return Criterion("C1", t("validation.c1"), PASS, ev,
                         f"Band I detected ({', '.join(b.evidence)}) at {b.center_um:.3f} um"
                         + ("" if supported else " (sensitivity marginal)") + ".")
    if supported:
        return Criterion("C1", t("validation.c1"), FAIL, ev,
                         "A typical band would be detectable with these data, but none was detected.")
    return Criterion("C1", t("validation.c1"), INCONCLUSIVE, ev,
                     f"Data not sensitive enough or region not covered: {b.reason}.")


def _c2(ana) -> Criterion:
    b = ana.minerals.band("Band II") if ana.minerals else None
    if b is None:
        return Criterion("C2", t("validation.c2"), FAIL, explanation="Band II missing from the analysis.")
    ev = {"status": b.status, "centre_um": b.center_um, "depth": b.depth, "depth_err": b.depth_err,
          "upper_limit_depth": b.upper_limit_depth, "min_detectable_depth": b.min_detectable_depth,
          "typical_band_depth": b.typical_depth, "detectable": b.detectable, "reason": b.reason,
          "within_segment": {k: v for k, v in (b.within_segment or {}).items() if k != "window_um"}}
    if b.status in (DETECTED, NOT_DETECTED) and b.min_detectable_depth is not None:
        return Criterion("C2", t("validation.c2"), PASS, ev,
                         f"Band II evaluated: {b.status}; {b.reason or 'detected'}.")
    if b.status == NOT_EVALUABLE and b.reason:
        return Criterion("C2", t("validation.c2"), INCONCLUSIVE, ev, f"Band II not evaluable: {b.reason}.")
    return Criterion("C2", t("validation.c2"), FAIL, ev, "Band II status undefined.")


def _linear_trend(lam, R, lam_norm):
    p = np.polyfit(lam, R, 1)
    return np.polyval(p, lam) / np.polyval(p, lam_norm)


def _counterfactual_table(refl: pd.DataFrame, values: np.ndarray) -> pd.DataFrame:
    """Same sampling, normalisation groups, visits and error structure as the observation, new values."""
    cf = refl.copy()
    scale = values / cf["reflectance"].values
    cf["reflectance"] = values
    cf["reflectance_err"] = cf["reflectance_err"].values * np.abs(scale)
    if "flux_uJy_raw" in cf:
        cf["flux_uJy_raw"] = cf["flux_uJy_raw"].values * scale
        cf["flux_err_uJy_raw"] = cf["flux_err_uJy_raw"].values * np.abs(scale)
    return cf


def _c3(ana) -> Criterion:
    tax, refl = ana.taxonomy, ana.reflectance
    b1 = ana.minerals.band("Band I") if ana.minerals else None
    band = bool(b1 and b1.detected)
    top = tax.complex_ranking[0]["complex"] if tax and tax.complex_ranking else None
    ev = {"top_complex": top, "band_I_detected": band}
    # Data checks. D-type means "featureless and steeply red" (DeMeo et al. 2009), so a D result may
    # legitimately depend on slope - but not when a 1-um band is detected, and not when the slope term
    # overturns a shape comparison that favours a band-bearing class.
    from ..classification.mineral_identification import BAND_BEARING_CLASSES
    ok_data = not (top == "D-type" and band)
    lam_norm = settings()["reflectance"]["normalization_wavelength_um"]
    if top == "D-type":
        rows = {r["class"]: r for r in tax.ranking}
        bb = [rows[c] for c in BAND_BEARING_CLASSES if c in rows]
        best_bb = min(bb, key=lambda r: r["chi2"]) if bb else None
        if best_bb is not None:
            gap = (rows["D"]["chi2"] - best_bb["chi2"]) / (tax.probability_scale or 1.0)
            ev["shape_chi2_D_minus_best_band_bearing"] = float(gap)
            ev["best_band_bearing_class"] = best_bb["class"]
            ok_data = ok_data and gap < 4.0        # D not chosen against a clearly better band-bearing shape
    # counterfactual: band-bearing templates reddened to the slope of the D-type mean
    lib = load_busdemeo()
    lam = refl["wavelength_um"].values
    R_res = settings()["classification"]["spherex_resolving_power"]
    win = (lam >= 0.75) & (lam <= 2.45)
    rD, _, _ = resample_reference(lib["D"], np.clip(lam, 0.45, 2.45), R_res, lam_norm)
    cf_results = {}
    for cls in ("S", "Sq", "Sr", "V", "Q"):
        rT, _, _ = resample_reference(lib[cls], np.clip(lam, 0.45, 2.45), R_res, lam_norm)
        trD = _linear_trend(lam[win], rD[win], lam_norm)
        trT = _linear_trend(lam[win], rT[win], lam_norm)
        red = rT.copy()
        red[win] = rT[win] * trD / trT
        tc = classify(_counterfactual_table(refl, red), slope_sys_per_um=ana.slope_sys_per_um,
                      band_evidence={"band_I_detected": True})
        cf_results[cls] = tc.complex_ranking[0]["complex"]
    ctrl = classify(_counterfactual_table(refl, rD), slope_sys_per_um=ana.slope_sys_per_um,
                    band_evidence={"band_I_detected": False})
    ev["reddened_band_bearing_templates_top_complex"] = cf_results
    ev["D_template_control_top_complex"] = ctrl.complex_ranking[0]["complex"]
    ok_cf = all(v != "D-type" for v in cf_results.values()) and ev["D_template_control_top_complex"] == "D-type"
    res = PASS if (ok_data and ok_cf) else FAIL
    expl = []
    expl.append("Observed spectrum: " + ("no D-type driven by slope" if ok_data else "D-type despite band / driven by slope"))
    expl.append("Counterfactual: band-bearing templates reddened to D-like slope classified as "
                + ", ".join(f"{k}->{v}" for k, v in cf_results.items())
                + f"; D template -> {ev['D_template_control_top_complex']}")
    return Criterion("C3", t("validation.c3"), res, ev, ". ".join(expl) + ".")


def _c4(ana) -> Criterion:
    T = ana.temporal
    unshared = [s["segments"] for s in T.segment_time_offsets if s["shared_visits"] == 0]
    ev = {"n_visits": T.n_visits, "n_exposures": T.n_exposures, "time_span_days": T.time_span_days,
          "segments_never_observed_together": unshared, "n_repeat_bins": T.n_repeat_bins,
          "variability": {k: v for k, v in T.variability.items() if k in ("tested", "detected", "p_constant",
                                                                           "visit_offset_rms_mag", "reason")},
          "warnings": T.warnings}
    if T.n_visits <= 1:
        ok = True
        expl = "Single visit: no observation-time differences."
    else:
        ok = bool(T.segment_time_offsets) and bool(T.warnings) and (T.variability.get("tested") or
                                                                     "reason" in T.variability)
        expl = (f"{T.n_visits} visits over {T.time_span_days:.2f} d detected; segments never observed together: "
                f"{', '.join(unshared) or 'none'}; variability "
                + ("detected" if T.variability.get("detected") else "tested" if T.variability.get("tested")
                   else "untested (" + T.variability.get("reason", "") + ")") + ".")
    return Criterion("C4", t("validation.c4"), PASS if ok else FAIL, ev, expl)


def _c5(ana, rotation_period_h, G, eta0) -> Criterion:
    T = ana.temporal
    cfg = settings()["temporal"]
    lc = T.lightcurve or {}
    ev = {"correction": T.correction, "lightcurve_supported": lc.get("supported"), "reason": lc.get("reason")}
    ok_a = True
    if T.correction.startswith("periodic"):
        models = [lc.get("joint")] if lc.get("mode") == "achromatic" else \
            [lc["per_arm"][a] for a in lc.get("corrected_arms", [])]
        for m in models:
            ok_a &= bool(m and m["delta_bic"] >= cfg["lightcurve_min_delta_bic"]
                         and m["phase_coverage"] >= cfg["lightcurve_min_phase_coverage"]
                         and m["variance_explained"] >= cfg["lightcurve_min_variance_explained"])
        ok_a &= bool(lc.get("supported"))
    # counterfactual: remove all repeated observations (keep the first point of each wavelength cluster)
    pts = T.points
    keep = ~pts.duplicated(subset=["repeat_cluster"], keep="first") if "repeat_cluster" in pts else np.ones(len(pts), bool)
    no_rep = ana.clean.loc[keep.values].reset_index(drop=True)
    T2 = analyse_temporal(no_rep, rotation_period_h=rotation_period_h, G=G, eta0=eta0)
    ok_b = (T2.n_repeat_bins == 0 and T2.correction == "none" and not T2.lightcurve.get("supported")
            and float(np.abs(T2.points["corr_ln"]).max()) == 0.0)
    ev["without_repeats"] = {"n_points": len(no_rep), "n_repeat_bins": T2.n_repeat_bins, "correction": T2.correction,
                             "reason": T2.lightcurve.get("reason"), "cross_visit_verified": T2.cross_visit_verified}
    T3 = analyse_temporal(ana.clean, rotation_period_h=None, G=G, eta0=eta0)
    ok_c = not T3.correction.startswith("periodic")
    ev["without_period"] = {"correction": T3.correction, "reason": T3.lightcurve.get("reason")}
    res = PASS if (ok_a and ok_b and ok_c) else FAIL
    expl = (f"Applied correction '{T.correction}' " + ("meets" if ok_a else "VIOLATES") + " the support criteria; "
            f"without repeated observations: '{T2.correction}' ({T2.lightcurve.get('reason')}); "
            f"without rotation period: '{T3.correction}'.")
    return Criterion("C5", t("validation.c5"), res, ev, expl)


def _c6(ana) -> Criterion:
    tax, refl = ana.taxonomy, ana.reflectance
    base = tax.confidence
    ev = {"baseline_confidence": base, "baseline_s_vs_d": tax.s_vs_d}
    no_b1 = refl[refl["wavelength_um"] >= 1.15]
    ta = classify(no_b1, slope_sys_per_um=ana.slope_sys_per_um)
    ev["no_1um_region"] = {"confidence": ta.confidence, "reasons": ta.confidence_reasons, "s_vs_d": ta.s_vs_d,
                           "top_complex": ta.complex_ranking[0]["complex"] if ta.complex_ranking else None}
    noisy = refl.copy()
    for c in ("reflectance_err", "flux_err_uJy_raw"):
        if c in noisy:
            noisy[c] = noisy[c] * 4.0
    if "temporal_corr_err_ln" in noisy:
        noisy["temporal_corr_err_ln"] = noisy["temporal_corr_err_ln"] * 4.0
    tb = classify(noisy, slope_sys_per_um=None if ana.slope_sys_per_um is None else ana.slope_sys_per_um * 4)
    ev["errors_x4"] = {"confidence": tb.confidence, "reasons": tb.confidence_reasons, "s_vs_d": tb.s_vs_d}
    # Without the 1-um region the S-complex / D-type question cannot be settled by band evidence. If the
    # result is then S-complex or D-type (or S and D are not distinguished), confidence must be Low;
    # in every case it must not exceed the baseline.
    top_a = ta.complex_ranking[0]["complex"] if ta.complex_ranking else None
    sd_relevant = top_a in ("S-complex", "D-type") or (ta.s_vs_d and not ta.s_vs_d["distinguished"])
    ok_a = CONF_RANK.get(ta.confidence, 0) <= CONF_RANK.get(base, 0) and (ta.confidence == "Low" or not sd_relevant)
    ev["no_1um_region"]["s_d_question_relevant"] = bool(sd_relevant)
    ok_b = CONF_RANK.get(tb.confidence, 0) <= CONF_RANK.get(base, 0)
    res = PASS if (ok_a and ok_b) else FAIL
    expl = (f"Baseline confidence {base}; without the 1-um region -> {ta.confidence}; with errors x4 -> "
            f"{tb.confidence}.")
    return Criterion("C6", t("validation.c6"), res, ev, expl)


def _c7(ana, reference: dict) -> Criterion:
    tax = ana.taxonomy
    ref_cx = reference["complex"]
    cr = {c["complex"]: c for c in tax.complex_ranking}
    top = tax.complex_ranking[0]["complex"]
    ev = {"reference_complex": ref_cx, "reference_class": reference.get("class"), "top_complex": top,
          "top_class": tax.best_class, "reference_complex_probability": cr.get(ref_cx, {}).get("probability"),
          "reference_complex_rank": cr.get(ref_cx, {}).get("rank"), "confidence": tax.confidence,
          "ranking_top5": [(c["rank"], c["class"], round(100 * c["probability"], 2)) for c in tax.ranking[:5]]}
    res = PASS if top == ref_cx else FAIL
    return Criterion("C7", t("validation.c7"), res, ev,
                     f"Most probable complex {top} ({100 * tax.complex_ranking[0]['probability']:.1f}%), reference "
                     f"{ref_cx} at rank {ev['reference_complex_rank']}; confidence {tax.confidence}.")


ANALYSIS_FILES = ["src/classification", "src/preprocessing", "src/integration/spectrum_analysis.py",
                  "src/extraction", "src/physical"]
FORBIDDEN = re.compile(r"\b(eros|433|20000433|spec_b|spec_t|validation_targets)\b", re.IGNORECASE)


def _executable_strings(tree):
    """String constants and identifiers in code, excluding docstrings and comments."""
    doc_nodes = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant):
                doc_nodes.add(id(first.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_nodes:
            yield node.value
        elif isinstance(node, ast.Name):
            yield node.id
        elif isinstance(node, ast.Attribute):
            yield node.attr


def _c8() -> Criterion:
    hits = []
    for rel in ANALYSIS_FILES:
        path = PROJECT_ROOT / rel
        files = sorted(path.rglob("*.py")) if path.is_dir() else [path]
        for f in files:
            tree = ast.parse(f.read_text(encoding="utf-8"))
            for sval in _executable_strings(tree):
                if FORBIDDEN.search(sval):
                    hits.append(f"{f.relative_to(PROJECT_ROOT)}: {sval[:60]!r}")
    params = list(inspect.signature(classify).parameters)
    bad_params = [p for p in params if p in ("target", "designation", "name", "sbdb", "reference", "expected")]
    ev = {"files_scanned": ANALYSIS_FILES, "target_specific_code": hits, "classify_parameters": params,
          "forbidden_parameters": bad_params}
    ok = not hits and not bad_params
    return Criterion("C8", t("validation.c8"), PASS if ok else FAIL, ev,
                     "No target names, reference taxonomies or validation files in the analysis/classification code."
                     if ok else "Target-specific information found in analysis code.")


# ----------------------------------------------------------------------------- driver
def evaluate_criteria(spectrum: pd.DataFrame, *, reference: dict, h_result=None,
                      rotation_period_h: float | None = None, G: float | None = None, target: str = "",
                      log=lambda m: None) -> ValidationReport:
    ana = analyse_spectrum(spectrum, h_result=h_result, rotation_period_h=rotation_period_h, G=G, log=log)
    sep = ana.separator
    G_used = sep.G if hasattr(sep, "G") else (G or sep.cfg["default_G"])
    eta0 = sep.eta_prior(float(np.median(ana.clean["phase_deg"])))["eta0"]
    rep = ValidationReport(target=target, reference=reference.get("reference_taxonomy", reference),
                           origin=str(spectrum["origin"].iloc[0]) if "origin" in spectrum and len(spectrum) else "")
    ref_tax = rep.reference
    if ana.taxonomy is None or ana.minerals is None or not ana.taxonomy.candidates:
        # No reflectance spectrum or too few points to classify (e.g. a bright target whose SWIR points
        # are all saturated): the taxonomy criteria cannot be scored, which is not the same as a wrong
        # classification. The observation-time criteria and C8 are still evaluated.
        if ana.taxonomy is None or ana.minerals is None:
            th = ana.thermal
            why = "no reflectance spectrum" + (f" ({th.warnings[0]})" if th is not None and th.warnings else "")
        else:
            why = "; ".join(ana.taxonomy.limitations[-1:]) or ana.taxonomy.status
        rep.criteria = [Criterion(cid, name, INCONCLUSIVE, explanation=f"No classification: {why}")
                        for cid, name in (("C1", t("validation.c1")), ("C2", t("validation.c2")),
                                          ("C3", t("validation.c3")), ("C6", t("validation.c6")),
                                          ("C7", t("validation.c7")))]
        rep.criteria += [_c4(ana), _c5(ana, rotation_period_h, G_used, eta0), _c8()]
        rep.criteria.sort(key=lambda c: c.id)
        rep.summary = {k: sum(c.result == k for c in rep.criteria) for k in (PASS, FAIL, INCONCLUSIVE)}
        rep.analysis_summary = {"taxonomy_status": ana.taxonomy.status if ana.taxonomy else why,
                                "n_points": ana.taxonomy.n_points if ana.taxonomy else int(len(ana.clean)),
                                "solar_analog_calibration": {k: (ana.calibration or {}).get(k) for k in
                                                             ("applied", "reason", "n_stars")}}
        return rep
    rep.criteria = [_c1(ana, ref_tax), _c2(ana), _c3(ana), _c4(ana), _c5(ana, rotation_period_h, G_used, eta0),
                    _c6(ana), _c7(ana, ref_tax), _c8()]
    rep.summary = {k: sum(c.result == k for c in rep.criteria) for k in (PASS, FAIL, INCONCLUSIVE)}
    th = ana.thermal
    rep.analysis_summary = {
        "solar_analog_calibration": {k: (ana.calibration or {}).get(k) for k in
                                     ("applied", "reason", "n_stars", "max_abs_correction", "slope_sigma_per_um")},
        "temporal_correction": ana.temporal.correction, "norm_groups": ana.temporal.n_norm_groups,
        "slope_sys_per_um": ana.slope_sys_per_um,
        "thermal_status": th.status if th else None, "thermal_chi2_red": th.chi2_red if th else None,
        "diameter_km": ana.diameter.diameter_km if ana.diameter else None,
        "diameter_err_km": ana.diameter.diameter_total_err_km if ana.diameter else None,
        "taxonomy_top_class": ana.taxonomy.best_class, "taxonomy_confidence": ana.taxonomy.confidence,
        "complex_ranking": [(c["complex"], round(100 * c["probability"], 2)) for c in ana.taxonomy.complex_ranking[:5]],
    }
    return rep


def run_taxonomy_validation(target: str, start: str | None = None, end: str | None = None,
                            max_images: int | None = None, out_dir: str = "outputs/validation", log=print):
    from ..acquisition.spherex_search import search_known_asteroid
    from ..extraction.spectral_extraction import extract_spectrum
    from ..integration.pipeline import resolve_absolute_magnitude

    try:
        reference = load_reference(target)
    except KeyError:
        reference = None                    # fall back to the SBDB taxonomy fields
    if reference is not None:
        start = start or reference["default_window"][0]
        end = end or reference["default_window"][1]
        max_images = max_images or reference.get("default_max_images")
    if not (start and end):
        raise ValueError("start and end dates are required for targets without a validation config entry")
    search = search_known_asteroid(target, start, end)
    sbdb = search.sbdb
    if reference is None:
        reference = reference_from_sbdb(sbdb)
    obs = search.observations
    if obs.empty:
        raise RuntimeError(f"No SPHEREx exposures for {target} between {start} and {end}")
    spectrum, _ = extract_spectrum(obs[obs["inside_footprint"]], max_images=max_images)
    h = resolve_absolute_magnitude(sbdb, target, use_mpc=False, log=log)
    field_name = reference["reference_taxonomy"].get("cross_check_sbdb_field")
    sbdb_tax = sbdb.param(field_name).raw_value if field_name and sbdb.param(field_name) else None
    rep = evaluate_criteria(spectrum, reference=reference, h_result=h,
                            rotation_period_h=sbdb.value("rot_per"), target=target, log=log)
    rep.reference = dict(rep.reference, sbdb_cross_check={field_name: sbdb_tax})
    out = resolve(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = "".join(ch if ch.isalnum() else "_" for ch in str(target))
    (out / f"{stem}_taxonomy_validation.json").write_text(json.dumps(rep.to_dict(), indent=2, default=str))
    (out / f"{stem}_taxonomy_validation.md").write_text(validation_markdown(rep, reference), encoding="utf-8")
    return rep


def validation_markdown(rep: ValidationReport, reference: dict) -> str:
    L = [f"# {t('validation.title', target=reference.get('name', rep.target))}", "",
         f"- {t('validation.reference')}: {rep.reference.get('class')} ({rep.reference.get('complex')}) — "
         + "; ".join(rep.reference.get("sources", [])), "",
         f"| {t('validation.criterion')} | {t('validation.result')} | {t('validation.explanation')} |", "|---|---|---|"]
    L += [f"| {c.id} {c.name} | **{c.result}** | {c.explanation} |" for c in rep.criteria]
    L += ["", f"**{t('validation.summary')}:** " + ", ".join(f"{k} {v}" for k, v in rep.summary.items()), "",
          f"## {t('validation.analysis')}", "", "```json", json.dumps(rep.analysis_summary, indent=1, default=str), "```"]
    return "\n".join(L)
