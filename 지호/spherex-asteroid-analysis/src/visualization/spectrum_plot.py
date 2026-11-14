"""Spectrum, component separation, reference comparison and residual plots."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from ..classification.reference_library import load_busdemeo, resample_reference  # noqa: E402
from ..common.config import settings  # noqa: E402
from ..i18n import t  # noqa: E402

QCOLOR = {"GOOD": "#1f6fb4", "WARN": "#e69f00", "BAD": "#b0b0b0"}


def plot_spectrum(df, target, ax=None, simulated=False):
    ax = ax or plt.subplots(figsize=(8, 4.5))[1]
    for q, g in df.groupby("quality_flag"):
        ax.errorbar(g["wavelength_um"], g["flux_uJy"], yerr=g["flux_err_uJy"], fmt="o", ms=3,
                    color=QCOLOR.get(q, "k"), label=f"{t('plot.observed')} ({q})", alpha=0.8)
    ax.set_xlabel(t("plot.wavelength"))
    ax.set_ylabel(t("plot.flux"))
    ax.set_yscale("log")
    ax.set_xlim(0.7, 5.05)
    ax.set_title(t("plot.spectrum_title", target=target) + (" [SIMULATED]" if simulated else ""))
    ax.legend(fontsize=8)
    return ax


def plot_separation(points, target, ax=None, simulated=False):
    ax = ax or plt.subplots(figsize=(8, 4.5))[1]
    p = points.sort_values("wavelength_um")
    ax.errorbar(p["wavelength_um"], p["flux_uJy"], yerr=p["flux_err_uJy"], fmt="o", ms=3, color="k",
                label=t("plot.observed"))
    ax.plot(p["wavelength_um"], p["model_total_uJy"], "-", color="#c0392b", label=t("plot.model_total"))
    ax.plot(p["wavelength_um"], p["model_reflected_uJy"], "--", color="#1f6fb4", label=t("plot.model_reflected"))
    th = p["model_thermal_uJy"]
    ax.plot(p["wavelength_um"], np.where(th > 0, th, np.nan), ":", color="#e67e22", label=t("plot.model_thermal"))
    if "thermal_err_uJy" in p:
        ax.fill_between(p["wavelength_um"], th - p["thermal_err_uJy"], th + p["thermal_err_uJy"], color="#e67e22",
                        alpha=0.2)
    ax.set_yscale("log")
    ax.set_xlabel(t("plot.wavelength"))
    ax.set_ylabel(t("plot.flux"))
    ax.set_title(t("plot.separation_title", target=target) + (" [SIMULATED]" if simulated else ""))
    ax.legend(fontsize=8)
    return ax


def plot_residuals(points, target, ax=None):
    ax = ax or plt.subplots(figsize=(8, 3))[1]
    p = points.sort_values("wavelength_um")
    used = p.get("used_in_fit", np.zeros(len(p), bool)).astype(bool)
    ax.axhline(0, color="k", lw=0.8)
    ax.plot(p["wavelength_um"][used], p["residual_sigma"][used], "o", ms=3, color="#1f6fb4", label="used in fit")
    ax.plot(p["wavelength_um"][~used], p["residual_sigma"][~used], "o", ms=3, mfc="none", color="#888",
            label="not used")
    ax.set_xlabel(t("plot.wavelength"))
    ax.set_ylabel(t("plot.residual_sigma"))
    ax.set_title(t("plot.residual_title", target=target))
    ax.legend(fontsize=8)
    return ax


def plot_reference_comparison(refl, taxonomy, target, ax=None, n=3):
    ax = ax or plt.subplots(figsize=(8, 4.5))[1]
    lib = load_busdemeo()
    R_cfg = settings()["classification"]["spherex_resolving_power"]
    lam_norm = settings()["reflectance"]["normalization_wavelength_um"]
    r = refl.dropna(subset=["reflectance"]).sort_values("wavelength_um")
    ax.errorbar(r["wavelength_um"], r["reflectance"], yerr=r["reflectance_err"], fmt="o", ms=3, color="k",
                label=t("plot.observed"))
    grid = np.linspace(0.75, 2.45, 200)
    for c in (taxonomy.candidates[:n] if taxonomy and taxonomy.candidates else []):
        rr, _, _ = resample_reference(lib[c["class"]], grid, R_cfg, lam_norm)
        model = rr * c.get("scale", 1.0) * (1 + c.get("beta_slope", 0.0) * (grid - lam_norm))
        ax.plot(grid, model, label=f"{c['class']} ({100 * c.get('probability', c.get('score', 0)):.1f}%)")
    ax.set_xlabel(t("plot.wavelength"))
    ax.set_ylabel(t("plot.reflectance"))
    ax.set_title(t("plot.reflectance_title", target=target))
    ax.legend(fontsize=8)
    return ax


def save(fig_or_ax, path):
    fig = fig_or_ax.figure if hasattr(fig_or_ax, "figure") else fig_or_ax
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path
