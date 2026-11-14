"""Observation-time analysis on SIMULATED SPHEREx-structured data (visits, detector families,
repeated observations, rotational lightcurves)."""
import numpy as np
import pytest

from src.preprocessing.temporal_analysis import analyse_temporal, apply_temporal_correction
from src.validation.simulation import synthetic_spherex_observations

KW = dict(rotation_period_h=5.27, G=0.15, eta0=1.47)


def test_visits_families_and_time_offsets_are_detected():
    df, _ = synthetic_spherex_observations("S", seed=2)
    r = analyse_temporal(df, **KW)
    assert r.n_visits == 24 and r.time_span_days > 10
    assert set(r.families.values()) == {"B1+B4", "B2+B5", "B3+B6"}
    unshared = [s["segments"] for s in r.segment_time_offsets if s["shared_visits"] == 0]
    assert "B1-B2" in unshared and "B2-B3" in unshared
    assert any("never observed together" in w for w in r.warnings)


def test_supported_lightcurve_is_applied_and_amplitude_recovered():
    df, truth = synthetic_spherex_observations("S", seed=3, lc_swir=(0.05, 0.0, 0.30, 0.25))
    r = analyse_temporal(df, **KW)
    assert r.variability["detected"]
    assert r.correction == "periodic_lightcurve" and r.lightcurve["supported"]
    grid = np.linspace(0, 2 * np.pi, 361)
    L = 0.05 * np.cos(grid) + 0.30 * np.cos(2 * grid) + 0.25 * np.sin(2 * grid)
    assert r.lightcurve["joint"]["amplitude_mag"] == pytest.approx(L.max() - L.min(), abs=0.1)
    corr = apply_temporal_correction(df, r)
    assert {"visit", "norm_group", "temporal_corr_err_ln", "flux_uJy_raw"} <= set(corr.columns)
    assert corr["norm_group"].nunique() == 1


def test_no_rotational_correction_without_repeated_observations():
    df, _ = synthetic_spherex_observations("S", seed=4)
    r = analyse_temporal(df, **KW)
    keep = ~r.points.duplicated(subset=["repeat_cluster"], keep="first")
    r2 = analyse_temporal(df.loc[keep.values].reset_index(drop=True), **KW)
    assert r2.n_repeat_bins == 0
    assert r2.correction == "none" and not r2.lightcurve["supported"]
    assert "no repeated observations" in r2.lightcurve["reason"]
    assert not r2.cross_visit_verified
    assert np.all(r2.points["corr_ln"] == 0)


def test_constant_brightness_needs_no_correction():
    df, _ = synthetic_spherex_observations("S", seed=5, lc_swir=(), lc_mwir=())
    r = analyse_temporal(df, **KW)
    assert r.variability["tested"] and not r.variability["detected"]
    assert r.correction == "none"
    assert r.cross_visit_verified


def test_unknown_period_gives_no_periodic_correction():
    df, _ = synthetic_spherex_observations("S", seed=6)
    r = analyse_temporal(df, rotation_period_h=None, G=0.15, eta0=1.47)
    assert r.variability["detected"]
    assert not r.correction.startswith("periodic")
    assert r.lightcurve["reason"] == "rotation period unknown"


def test_chromatic_lightcurve_is_corrected_per_arm():
    df, _ = synthetic_spherex_observations("S", seed=7, lc_swir=(0.0, 0.0, 0.30, 0.25), lc_mwir=(0.0, 0.0, 0.55, -0.1))
    r = analyse_temporal(df, **KW)
    assert r.lightcurve["achromatic_p"] < 1e-3
    assert r.lightcurve["mode"] == "per_arm"
    assert set(r.lightcurve["corrected_arms"]) == {"SWIR", "MWIR"}
