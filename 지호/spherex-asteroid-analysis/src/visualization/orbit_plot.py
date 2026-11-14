"""Sky-track and population plots."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from ..i18n import t  # noqa: E402


def plot_sky_track(obs, spectrum, target, ax=None):
    ax = ax or plt.subplots(figsize=(6, 5))[1]
    o = obs.sort_values("mjd_mid")
    ax.plot(o["pred_ra_deg"], o["pred_dec_deg"], ".-", color="#888", ms=3, label=t("plot.predicted"))
    if spectrum is not None and len(spectrum) and "measured_ra_deg" in spectrum:
        ax.plot(spectrum["measured_ra_deg"], spectrum["measured_dec_deg"], "x", color="#c0392b", ms=4,
                label=t("plot.measured"))
    ax.invert_xaxis()
    ax.set_xlabel(t("plot.ra"))
    ax.set_ylabel(t("plot.dec"))
    ax.set_title(t("plot.sky_title", target=target))
    ax.legend(fontsize=8)
    return ax


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def plot_population(results: pd.DataFrame):
    fig, axs = plt.subplots(2, 2, figsize=(10, 8))
    cx = results.get("spectral_complex", pd.Series(dtype=str)).dropna().value_counts()
    axs[0, 0].bar(cx.index.astype(str), cx.values, color="#1f6fb4")
    axs[0, 0].set_title(t("plot.class_distribution"))
    axs[0, 0].set_ylabel(t("plot.count"))
    D = _num(results.get("diameter_km", pd.Series(dtype=float))).dropna()
    if len(D):
        axs[0, 1].hist(D, bins=min(20, max(len(D), 3)), color="#1f6fb4")
    axs[0, 1].set_title(t("plot.diameter_distribution"))
    axs[0, 1].set_xlabel(t("plot.diameter"))
    rho = _num(results.get("density", pd.Series(dtype=float)))
    Dd = _num(results.get("diameter_km", pd.Series(dtype=float))).fillna(_num(results.get("catalog_diameter_km",
                                                                                          pd.Series(dtype=float))))
    m = rho.notna() & Dd.notna()
    axs[1, 0].errorbar(Dd[m], rho[m], yerr=_num(results.get("density_uncertainty"))[m] if m.any() else None,
                       fmt="o", color="#c0392b")
    axs[1, 0].set_xscale("log")
    axs[1, 0].set_xlabel(t("plot.diameter"))
    axs[1, 0].set_ylabel(t("plot.density"))
    axs[1, 0].set_title(t("plot.diameter_density"))
    rel = {}
    for v, e, name in (("diameter_km", "diameter_uncertainty", "D"), ("geometric_albedo_pV", "albedo_uncertainty", "pV"),
                       ("mass_kg", "mass_uncertainty", "M"), ("density", "density_uncertainty", "rho")):
        a, b = _num(results.get(v)), _num(results.get(e))
        rel[name] = (b / a).dropna().values if a is not None and b is not None else np.array([])
    axs[1, 1].boxplot([rel[k] if len(rel[k]) else [np.nan] for k in rel], tick_labels=list(rel))
    axs[1, 1].set_ylabel(t("plot.relative_uncertainty"))
    axs[1, 1].set_title(t("plot.uncertainty_title"))
    fig.tight_layout()
    return fig
