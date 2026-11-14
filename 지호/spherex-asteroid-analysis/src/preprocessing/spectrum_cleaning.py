"""Spectrum cleaning: quality selection, outlier rejection and optional binning.

Multi-epoch points are not averaged blindly: each point keeps its own observing
geometry (r, Delta, alpha) so the models are evaluated per point. Binning is only
used for display and for the taxonomy step, after geometry normalisation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..common import status


def select_usable(df: pd.DataFrame, allow_warn: bool = True) -> pd.DataFrame:
    ok = df["quality_flag"] == status.Q_GOOD
    if allow_warn:
        ok |= df["quality_flag"] == status.Q_WARN
    ok &= np.isfinite(df["flux_uJy"]) & np.isfinite(df["flux_err_uJy"]) & (df["flux_err_uJy"] > 0)
    return df[ok].copy()


def reject_outliers(df: pd.DataFrame, value_col: str, err_col: str, window_um: float = 0.08,
                    nsigma: float = 4.0) -> pd.DataFrame:
    """Flag points deviating from a running median by > nsigma (in units of their error
    combined with the local scatter). Outliers are flagged, not deleted."""
    df = df.sort_values("wavelength_um").copy()
    lam = df["wavelength_um"].values
    v = df[value_col].values
    e = df[err_col].values
    out = np.zeros(len(df), bool)
    for i in range(len(df)):
        m = np.abs(lam - lam[i]) <= window_um
        if m.sum() < 4:
            continue
        med = np.median(v[m])
        mad = 1.4826 * np.median(np.abs(v[m] - med))
        sig = np.hypot(e[i], mad)
        out[i] = sig > 0 and abs(v[i] - med) > nsigma * sig
    df["outlier"] = out
    return df


def bin_spectrum(lam, val, err, edges):
    """Inverse-variance weighted binning. Returns centres, values, errors, counts."""
    lam, val, err = map(np.asarray, (lam, val, err))
    cen, out_v, out_e, cnt = [], [], [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (lam >= lo) & (lam < hi) & np.isfinite(val) & np.isfinite(err) & (err > 0)
        if not m.any():
            continue
        w = 1 / err[m] ** 2
        cen.append(np.sum(w * lam[m]) / np.sum(w))
        out_v.append(np.sum(w * val[m]) / np.sum(w))
        e_stat = 1 / np.sqrt(np.sum(w))
        # include scatter if points disagree more than their errors
        if m.sum() > 1:
            chi2 = np.sum(w * (val[m] - out_v[-1]) ** 2) / (m.sum() - 1)
            e_stat *= np.sqrt(max(chi2, 1.0))
        out_e.append(e_stat)
        cnt.append(int(m.sum()))
    return np.array(cen), np.array(out_v), np.array(out_e), np.array(cnt)


def resolution_bin_edges(lam_min=0.75, lam_max=5.0, R=40.0):
    edges = [lam_min]
    while edges[-1] < lam_max:
        edges.append(edges[-1] * (1 + 1 / R))
    return np.array(edges)
