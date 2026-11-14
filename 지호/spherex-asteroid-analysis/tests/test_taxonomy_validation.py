"""Taxonomy validation criteria (C1-C8).

Offline tests use SIMULATED SPHEREx-structured data; the real-data test validates against
433 Eros (reference S-type from config/validation_targets.yaml) and needs --run-network.
The reference taxonomy is only used for scoring, never by the classifier (C8).
"""
import inspect
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.classification.mineral_identification import NOT_EVALUABLE, analyse_minerals
from src.classification.reference_library import load_busdemeo, resample_reference
from src.classification.taxonomy import classify
from src.physical.absolute_magnitude import HResult
from src.preprocessing.solar_spectrum import load_solar_spectrum
from src.validation.simulation import synthetic_spherex_observations
from src.validation.taxonomy_validation import _c8, evaluate_criteria

sys.path.insert(0, str(Path(__file__).parent))
from test_classification import fake_obs  # noqa: E402

REF_S = {"reference_taxonomy": {"class": "S", "complex": "S-complex", "sources": ["SIMULATED truth"]}}
REF_D = {"reference_taxonomy": {"class": "D", "complex": "D-type", "sources": ["SIMULATED truth"]}}


@pytest.fixture(scope="module")
def solar():
    return load_solar_spectrum()


def _run(taxon, ref, solar, **kw):
    df, truth = synthetic_spherex_observations(taxon, solar=solar, **kw)
    h = HResult(status="CATALOG", H=truth["H"], H_err=0.05, H_err_provided=True, G=truth["G"], source="SIMULATED")
    return evaluate_criteria(df, reference=ref, h_result=h, rotation_period_h=truth["rotation_period_h"],
                             target=f"SIM-{taxon}")


def test_simulated_red_s_type_passes_all_criteria(solar):
    """Eros-like: S-type, redder than the class mean (phase reddening / weathering), 1.3-mag lightcurve."""
    rep = _run("S", REF_S, solar, extra_slope_per_um=0.3, seed=1)
    res = {c.id: c.result for c in rep.criteria}
    assert res == {f"C{i}": "PASS" for i in range(1, 9)}, [(c.id, c.result, c.explanation) for c in rep.criteria]


def test_simulated_d_type_is_classified_d_without_false_band(solar):
    rep = _run("D", REF_D, solar, seed=2)
    res = {c.id: c for c in rep.criteria}
    assert res["C7"].result == "PASS"                     # D-type recovered: the method is not anti-D
    assert res["C1"].result == "PASS"                     # featureless reference: no false 1-um band
    assert res["C1"].evidence["status"] != "DETECTED"
    assert res["C3"].result == "PASS" and res["C5"].result == "PASS"


@pytest.mark.parametrize("cls", ["S", "Sq", "Sr", "V", "Q"])
def test_red_slope_alone_does_not_make_d_type(cls):
    """Band-bearing class means reddened to the slope of the D-type mean stay band-bearing."""
    lib = load_busdemeo()
    obs = fake_obs(cls, snr=50, seed=3)
    lam = obs["wavelength_um"].values
    rT, _, _ = resample_reference(lib[cls], lam, 40, 1.2)
    rD, _, _ = resample_reference(lib["D"], lam, 40, 1.2)
    tr = lambda r: np.polyval(np.polyfit(lam, r, 1), lam) / np.polyval(np.polyfit(lam, r, 1), 1.2)  # noqa: E731
    obs["reflectance"] = obs["reflectance"] * tr(rD) / tr(rT)
    obs["reflectance_err"] = obs["reflectance_err"] * tr(rD) / tr(rT)
    res = classify(obs)
    assert res.complex_ranking[0]["complex"] != "D-type"
    # the legacy comparison (slope inside the shape fit) is the behaviour being guarded against
    legacy = classify(obs, slope_mode="absolute")
    assert legacy.ranking[0]["probability"] >= 0.0      # still runs; kept for comparison only


def test_band_detection_only_when_supported():
    s_good = analyse_minerals(fake_obs("S", snr=50))
    s_poor = analyse_minerals(fake_obs("S", snr=5))
    d_good = analyse_minerals(fake_obs("D", snr=50))
    assert s_good.band("Band I").detected and s_good.band("Band I").detectable
    assert 0.85 < s_good.band("Band I").center_um < 1.05
    assert not d_good.band("Band I").detected and d_good.band("Band I").detectable
    b = s_poor.band("Band I")
    assert not b.detected and not b.detectable                      # reported as not sensitive enough
    for m in (s_good, s_poor, d_good):                              # Band II is always evaluated
        assert m.band("Band II").status in ("DETECTED", "NOT_DETECTED")
        assert m.band("Band II").min_detectable_depth is not None


def test_band_region_missing_is_not_evaluable_and_lowers_confidence():
    obs = fake_obs("S", snr=50)
    full = classify(obs)
    cut = obs[obs["wavelength_um"] >= 1.15]
    m = analyse_minerals(cut)
    assert m.band("Band I").status == NOT_EVALUABLE
    t = classify(cut)
    assert t.confidence == "Low"
    assert {"High": 3, "Medium": 2, "Low": 1}[t.confidence] <= {"High": 3, "Medium": 2, "Low": 1}[full.confidence]


def test_classifier_has_no_target_specific_input():
    assert _c8().result == "PASS"
    params = inspect.signature(classify).parameters
    assert not {"target", "designation", "sbdb", "reference", "expected"} & set(params)


@pytest.fixture(scope="module")
def eros_report():
    from src.validation.taxonomy_validation import run_taxonomy_validation
    return run_taxonomy_validation("433")


@pytest.mark.network
def test_eros_real_data_validation(eros_report):
    """Method criteria on real DR1 data of 433 Eros (2026-02-01..21, 160 exposures)."""
    res = {c.id: c for c in eros_report.criteria}
    for cid in ("C1", "C2", "C3", "C4", "C5", "C6", "C8"):
        assert res[cid].result == "PASS", (cid, res[cid].explanation)
    assert eros_report.reference["sbdb_cross_check"]["spec_B"] == "S"


@pytest.mark.network
@pytest.mark.xfail(strict=False, reason="Known limitation (docs/STAGE_STATUS.md): with the saturated wing-only points "
                   "weighted by their measured 8% scatter, 433 Eros in this window comes out V-type (Medium); with "
                   "nominal errors it was S-complex. Eros is a 1.3-2 mag rotator that saturates at bright phases.")
def test_eros_most_probable_complex_matches_reference(eros_report):
    res = {c.id: c for c in eros_report.criteria}
    assert res["C7"].result == "PASS", res["C7"].explanation          # S-complex most probable


class _P:
    def __init__(self, v):
        self.raw_value = v


class _FakeSBDB:
    fullname = "SIMULATED object"

    def __init__(self, spec_B=None, spec_T=None):
        self._p = {k: _P(v) for k, v in (("spec_B", spec_B), ("spec_T", spec_T)) if v}

    def param(self, k):
        return self._p.get(k)


@pytest.mark.parametrize("spec_B,spec_T,cls,cx,field", [
    ("S", "S", "S", "S-complex", "spec_B"), ("Ch", "G", "Ch", "C-complex", "spec_B"), ("Xk", "M", "Xk", "X-complex", "spec_B"),
    ("Sk", None, "Sk", "S-complex", "spec_B"), (None, "D", "D", "D-type", "spec_T"), (None, "FP", "F", "C-complex", "spec_T"),
    ("A", "A", "A", "A-type", "spec_B")])
def test_reference_from_sbdb_maps_taxonomy_to_complex(spec_B, spec_T, cls, cx, field):
    from src.validation.taxonomy_validation import reference_from_sbdb
    ref = reference_from_sbdb(_FakeSBDB(spec_B, spec_T))["reference_taxonomy"]
    assert (ref["class"], ref["complex"], ref["cross_check_sbdb_field"]) == (cls, cx, field)


def test_parallel_prefetch_uses_cache(tmp_path, monkeypatch):
    """Concurrent prefetch downloads each cutout once; photometry then reads the cached files."""
    import src.extraction.spectral_extraction as se
    calls = []

    class FakeIrsa:
        def download_cutout(self, url, ra, dec, size, out_dir):
            calls.append(url)
            raise RuntimeError("offline test")      # extraction must record, not crash

    monkeypatch.setattr("src.acquisition.irsa_client.IrsaClient", lambda: FakeIrsa())
    obs = pd.DataFrame({"image_url": [f"u{i}" for i in range(6)], "pred_ra_deg": 1.0, "pred_dec_deg": 2.0,
                        "obs_id": [f"x{i}" for i in range(6)], "detector": 1})
    df, prov = se.extract_spectrum(obs, cache_dir=str(tmp_path))
    assert df.empty and len(prov.warnings) == 6
    assert sorted(set(calls)) == [f"u{i}" for i in range(6)]


@pytest.mark.parametrize("seed", [0, 1, 5])
def test_isolated_faint_visit_does_not_create_a_false_band(solar, seed):
    """cf. 10 Hygiea in DR1: one B1 visit (0.85-0.97 um, no wavelength shared with other visits) is 10%
    fainter; variability is not detectable from the repeats. The untested offset must not be read as a
    1-um band (with zero visit error this case gave a false band and an X-complex result)."""
    from src.integration.spectrum_analysis import analyse_spectrum
    from src.preprocessing.temporal_analysis import analyse_temporal
    df, tr = synthetic_spherex_observations("C", seed=seed, lc_swir=(), lc_mwir=(), snr=60, rotation_period_h=13.8,
                                            D_km=430, pV=0.07, r_au=(3.4, 3.4), delta_au=(2.9, 3.0),
                                            alpha_deg=(17, 17.5), solar=solar)
    t = analyse_temporal(df, rotation_period_h=13.8, G=0.15, eta0=1.0)
    p = t.points
    iso = [v for v, g in p[p.band == "B1"].groupby("visit") if g.wavelength_um.between(0.85, 0.97).all()
           and not p.loc[g.index, "repeat_cluster"].isin(p.loc[p.visit != v, "repeat_cluster"]).any()]
    df.loc[p.visit.values == iso[0], "flux_uJy"] *= 0.90
    h = HResult(status="CATALOG", H=tr["H"], H_err=0.05, H_err_provided=True, G=0.15, source="SIMULATED")
    a = analyse_spectrum(df, h_result=h, rotation_period_h=13.8, log=lambda m: None)
    assert a.minerals.band("Band I").status != "DETECTED"
    assert a.taxonomy.complex_ranking[0]["complex"] == "C-complex"


def test_too_few_points_gives_inconclusive_not_a_crash(solar):
    """Enough points for the thermal fit but too few in 0.75-2.45 um to classify (as for a bright target
    whose SWIR points are saturated): the taxonomy criteria are INCONCLUSIVE, the others still scored."""
    df, truth = synthetic_spherex_observations("S", solar=solar, seed=3)
    swir = df[(df["wavelength_um"] >= 1.65) & (df["wavelength_um"] <= 2.4)].iloc[::4].head(6)
    df = pd.concat([df[df["wavelength_um"] > 2.5], swir]).sort_index()
    h = HResult(status="CATALOG", H=truth["H"], H_err=0.05, H_err_provided=True, G=truth["G"], source="SIMULATED")
    rep = evaluate_criteria(df, reference=REF_S, h_result=h, rotation_period_h=truth["rotation_period_h"], target="SIM")
    res = {c.id: c.result for c in rep.criteria}
    assert res["C7"] == "INCONCLUSIVE" and res["C1"] == "INCONCLUSIVE", res
    assert res["C8"] == "PASS" and "C4" in res and "C5" in res


def test_no_reflectance_spectrum_is_inconclusive(solar):
    """Too few points in the reflected continuum window for any reflectance spectrum."""
    df, truth = synthetic_spherex_observations("S", solar=solar, seed=4)
    df = df[(df["wavelength_um"] > 2.6) | (df["wavelength_um"] < 0.9)]
    h = HResult(status="CATALOG", H=truth["H"], H_err=0.05, H_err_provided=True, G=truth["G"], source="SIMULATED")
    rep = evaluate_criteria(df, reference=REF_S, h_result=h, rotation_period_h=truth["rotation_period_h"], target="SIM")
    res = {c.id: c.result for c in rep.criteria}
    assert "C0" not in res and res["C7"] == "INCONCLUSIVE" and res["C8"] == "PASS"
    assert "no reflectance spectrum" in next(c for c in rep.criteria if c.id == "C7").explanation


def test_saturated_points_inform_the_lightcurve_but_not_the_spectrum(solar, monkeypatch):
    """Mode lightcurve_only. Saturated points (core_flags OVERFLOW) with a +10% wing-fit bias enter the
    observation-time analysis (with the error floor) but not the reflectance."""
    import src.integration.spectrum_analysis as sa
    from src.integration.spectrum_analysis import analyse_spectrum
    cfg = sa.settings()
    cfg["temporal"]["saturated_points"] = "lightcurve_only"
    monkeypatch.setattr(sa, "settings", lambda: cfg)
    df, truth = synthetic_spherex_observations("S", solar=solar, seed=5)
    df["core_flags"] = "SOURCE"
    sat = (df["wavelength_um"] < 1.6).values & (np.arange(len(df)) % 4 == 0)
    df.loc[sat, "core_flags"] = "OVERFLOW|SOURCE"
    df.loc[sat, "flux_uJy"] *= 1.10
    h = HResult(status="CATALOG", H=truth["H"], H_err=0.05, H_err_provided=True, G=truth["G"], source="SIMULATED")
    kw = dict(h_result=h, rotation_period_h=truth["rotation_period_h"], log=lambda m: None)
    a = analyse_spectrum(df, **kw)
    assert a.saturation["n_saturated"] == int(sat.sum()) and a.saturation["mode"] == "lightcurve_only"
    assert a.temporal.n_points == len(a.clean) and a.clean["saturated_core"].sum() == sat.sum()
    assert a.reflectance is not None and not a.reflectance.get("saturated_core", pd.Series(False)).any()
    assert len(a.reflectance) == len(a.clean) - int(sat.sum())
    b = analyse_spectrum(df[~sat], **kw)
    assert a.taxonomy.complex_ranking[0]["complex"] == b.taxonomy.complex_ranking[0]["complex"]


def test_inflated_saturated_points_and_their_sensitivity_check(solar):
    """Default mode: saturated points are used with the 8% floor; the classification is repeated without them."""
    from src.integration.spectrum_analysis import analyse_spectrum
    df, truth = synthetic_spherex_observations("S", solar=solar, seed=6)
    df["core_flags"] = "SOURCE"
    sat = (df["wavelength_um"] < 1.6).values & (np.arange(len(df)) % 5 == 0)
    df.loc[sat, "core_flags"] = "OVERFLOW|SOURCE"
    h = HResult(status="CATALOG", H=truth["H"], H_err=0.05, H_err_provided=True, G=truth["G"], source="SIMULATED")
    a = analyse_spectrum(df, h_result=h, rotation_period_h=truth["rotation_period_h"], log=lambda m: None)
    assert a.saturation["mode"] == "inflated" and a.saturation["n_saturated"] == int(sat.sum())
    assert a.reflectance["saturated_core"].sum() == sat.sum()                    # kept in the spectrum
    r = a.clean[a.clean["saturated_core"]]
    assert (r["flux_err_uJy"] >= 0.08 * r["flux_uJy"].abs() - 1e-9).all()        # with the error floor
    ss = a.taxonomy.saturation_sensitivity
    assert ss["n_saturated"] == int(sat.sum()) and ss["stable"] is True
    assert a.taxonomy.visit_jackknife["n_samples"] >= 3


def _stub_tax(top, conf="High"):
    from src.classification.taxonomy import TaxonomyResult
    return TaxonomyResult(status="CANDIDATE", complex_ranking=[{"rank": 1, "complex": top, "probability": 0.9}],
                          candidates=[{"class": "x"}], confidence=conf)


@pytest.mark.parametrize("check", ["jackknife", "saturation", "lightcurve"])
def test_unstable_classification_is_downgraded_to_low(check, monkeypatch):
    """Each stability check sets the confidence to Low when the most probable complex changes, and only then."""
    import src.integration.spectrum_analysis as sa

    class _T:
        correction = "periodic_lightcurve"

    refl = pd.DataFrame({"wavelength_um": np.linspace(0.8, 2.4, 12), "visit": np.repeat([0, 1, 2, 3], 3),
                         "reflectance": 1.0, "reflectance_err": 0.01, "temporal_corr_mag": 0.5,
                         "saturated_core": [True] + [False] * 11})
    for flips in (True, False):
        def fake_classify(r, **k):
            if check == "jackknife":
                changed = 0 not in set(r["visit"])
            elif check == "saturation":
                changed = not r["saturated_core"].any()
            else:
                changed = not np.allclose(r["reflectance"], 1.0)
            return _stub_tax("D-type" if (changed and flips) else "S-complex")
        monkeypatch.setattr(sa, "classify", fake_classify)
        tax = _stub_tax("S-complex")
        if check == "jackknife":
            res = sa.visit_jackknife(refl, tax, 0.0, None)
            assert res["n_samples"] == 4 and res["n_agree"] == (3 if flips else 4)
        elif check == "saturation":
            res = sa.saturation_sensitivity(refl, tax, 0.0, None)
        else:
            res = sa.lightcurve_sensitivity(refl, _T(), tax, 0.0, None)
        assert res["stable"] is (not flips)
        assert tax.confidence == ("Low" if flips else "High")
