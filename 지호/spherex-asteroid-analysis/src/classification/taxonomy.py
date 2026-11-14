"""Stage 4a: spectral type candidates, ranked by relative probability.

Method (default) - shape and slope compared separately, following DeMeo et al. (2009, Icarus 202,
160), who remove the spectral slope before PCA "thus making PCA more sensitive to other features"
and tabulate the slope as a separate parameter (for near-infrared-only data they normalise at
1.2 um). For each Bus-DeMeo class mean T (resampled to SPHEREx, R ~ 40):

    model_i = s_g(i) * T(lambda_i) * [1 + beta (lambda_i - lambda_norm)]

  * s_g: free brightness scale per normalisation group g (groups are visits whose relative
    brightness the repeated observations could not link - see preprocessing.temporal_analysis);
  * beta: free slope difference between asteroid and class mean. The shape term is therefore
    slope-independent: a red continuum alone cannot make a spectrum look like a featureless class;
  * slope term: beta^2 / (sigma_class_slope^2 + sigma_slope_sys^2). sigma_slope_sys is the
    systematic slope uncertainty from the observation-time normalisation (None = slope not
    constrained -> slope term off). For classes that have a high-slope "w" variant (S, Sq, Sr, Sv,
    V, Q; DeMeo et al. 2009) a redder slope (beta > 0) is not penalised: it is reported as "w".
  deviance_c = chi2_shape + slope term,  P_c = exp(-(dev_c - dev_min) / (2 s)) / sum,
  s = max(chi2_red of the most probable class, 1).

The observed spectrum is binned onto the 0.05-um reference grid (within each normalisation group)
and classes without a published intra-class sigma (Cg, O, R) get the median sigma of all classes.

Confidence reflects how well the data separate the best complex from the alternatives: High if the
runner-up complex is >= 9 deviance units (~3 sigma) worse, Medium if >= 4, otherwise Low. It is
capped at Low when S-complex and D-type are not distinguished (|delta| < 4), when the 1-um band
region is not covered, or when a featureless class ranks first although a 1-um band is detected.
P_c is conditional on the 25 Bus-DeMeo classes and this model - NOT the probability that the
asteroid contains a mineral. No target-specific information enters the classification.

Method 2 - PCA in SPHEREx sampling, built from the resampled reference spectra.
Method 3 - supervised ML via `train_classifier`, only with an independent labelled training set.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

from ..common import status
from ..common.config import settings
from .reference_library import COMPLEXES, complex_of, load_busdemeo, resample_reference, sigma_decomposition

# Classes with a high-slope "w" variant (DeMeo et al. 2009, Sect. 4.3 and Sect. 6).
W_ELIGIBLE = {"S", "Sq", "Sr", "Sv", "V", "Q"}
# Classes without a 1-um absorption band at SPHEREx wavelengths (described as linear / featureless
# in the near-infrared by DeMeo et al. 2009).
FEATURELESS_NIR = {"B", "C", "Cb", "Cg", "Cgh", "Ch", "D", "T", "X", "Xc", "Xe", "Xn"}


@dataclass
class TaxonomyResult:
    status: str
    candidates: list = field(default_factory=list)       # top-N of `ranking`
    ranking: list = field(default_factory=list)          # all classes, most probable first
    complex_ranking: list = field(default_factory=list)  # [{rank, complex, probability}]
    probability_scale: float | None = None
    complex_scores: dict = field(default_factory=dict)
    best_class: str = status.UNKNOWN
    best_complex: str = status.UNKNOWN
    confidence: str = status.CONF_NONE
    confidence_reasons: list = field(default_factory=list)
    wavelength_range_um: tuple | None = None
    n_points: int = 0
    n_norm_groups: int = 1
    slope_used: bool = True
    slope_sys_per_um: float | None = None
    complex_separation: float | None = None          # deviance gap best vs runner-up complex (scaled)
    s_vs_d: dict = field(default_factory=dict)
    pca: dict | None = None
    lightcurve_sensitivity: dict | None = None          # see integration.spectrum_analysis
    visit_jackknife: dict | None = None                 # see integration.spectrum_analysis
    saturation_sensitivity: dict | None = None          # see integration.spectrum_analysis
    limitations: list = field(default_factory=list)
    method: str = "shape+slope (DeMeo et al. 2009 slope treatment)"


def _class_slope_sigma(rr, rs, x):
    """Intra-class slope spread (relative, per um), estimated from the published class sigma at long
    lever arms and bounded to [slope_sigma_min, slope_sigma_max] (config). The bounds bracket the
    half-widths of the slope ranges that separate featureless classes in DeMeo et al. (2009):
    T 0.25-0.38 and X 0.2-0.38 per um, i.e. half-widths of 0.065-0.09."""
    cfg = settings()["classification"]
    lo, hi = cfg.get("slope_sigma_min", 0.03), cfg.get("slope_sigma_max", 0.10)
    m = np.isfinite(rr) & np.isfinite(rs) & (np.abs(x) > 0.3) & (rr > 0)
    if m.sum() < 2:
        return float(hi)
    return float(np.clip(np.median(rs[m] / rr[m] / np.abs(x[m])), lo, hi))


def _fit_class(R, E, g, rr, rs, x, slope_sigma, w_eligible, likelihood, slope_mode, Cobs=None):
    """Profile over beta (closed-form group scales); returns chi2_shape, penalty, beta, deviance, scale.
    With Cobs (full observational covariance of the binned spectrum) the fit is generalised least
    squares; otherwise errors E are treated as independent."""
    groups = np.unique(g)
    if Cobs is not None:
        from .covariance import gls
        gidx = {k: i for i, k in enumerate(groups)}

        def evaluate_cov(beta):
            M = rr * (1 + beta * x)
            Ms = rs * np.abs(1 + beta * x)
            sc = np.ones(len(R))
            for _ in range(3):
                X = np.zeros((len(R), len(groups)))
                for i in range(len(R)):
                    X[i, gidx[g[i]]] = M[i]
                C = Cobs + np.diag((sc * Ms) ** 2)
                coef, _, chi2 = gls(X, R, C)
                sc = np.array([coef[gidx[k]] for k in g])
            if slope_sigma is None or (w_eligible and beta > 0):
                pen = 0.0
            else:
                pen = float(beta ** 2 / slope_sigma ** 2)
            return chi2, pen, float(np.median(sc))

        if slope_mode == "absolute":
            c2, _, sc = evaluate_cov(0.0)
            return c2, 0.0, 0.0, c2, sc
        opt = minimize_scalar(lambda b: sum(evaluate_cov(b)[:2]), bounds=(-0.75, 2.0), method="bounded",
                              options={"xatol": 1e-4})
        c2, pen, sc = evaluate_cov(opt.x)
        return c2, pen, float(opt.x), c2 + pen, sc

    def evaluate(beta):
        M = rr * (1 + beta * x)
        Ms = rs * np.abs(1 + beta * x)
        sg = np.ones(len(R))
        for _ in range(3):
            var = E ** 2 + (sg * Ms) ** 2
            w = 1 / var
            for k in groups:
                m = g == k
                den = np.sum(w[m] * M[m] ** 2)
                sg[m] = np.sum(w[m] * R[m] * M[m]) / den if den > 0 else 1.0
        var = E ** 2 + (sg * Ms) ** 2
        chi2 = float(np.sum((R - sg * M) ** 2 / var))
        if likelihood == "gaussian":
            chi2 += float(np.sum(np.log(var)))
        if slope_sigma is None or (w_eligible and beta > 0):
            pen = 0.0
        else:
            pen = float(beta ** 2 / slope_sigma ** 2)
        return chi2, pen, float(np.median(sg))

    if slope_mode == "absolute":            # legacy: template scale only, slope compared implicitly
        c2, _, sc = evaluate(0.0)
        return c2, 0.0, 0.0, c2, sc
    opt = minimize_scalar(lambda b: sum(evaluate(b)[:2]), bounds=(-0.75, 2.0), method="bounded",
                          options={"xatol": 1e-4})
    c2, pen, sc = evaluate(opt.x)
    return c2, pen, float(opt.x), c2 + pen, sc


def classify(refl: pd.DataFrame, value_col="reflectance", err_col="reflectance_err",
             likelihood: str | None = None, bin_to_reference_grid: bool | None = None,
             group_col: str = "norm_group", slope_sys_per_um: float | None = 0.0,
             band_evidence: dict | None = None, slope_mode: str = "separate") -> TaxonomyResult:
    """refl: reflectance table (wavelength_um, value, error, optional norm_group).
    slope_sys_per_um: systematic slope uncertainty from the observation-time normalisation;
    None means the slope is not constrained (slope term off).
    band_evidence: {"band_I_detected": bool, ...} from the band analysis (consistency check only).
    slope_mode: "separate" (default) or "absolute" (legacy comparison without the slope parameter)."""
    cfg = settings()["classification"]
    likelihood = likelihood or cfg.get("likelihood", "chi2")
    bin_to_reference_grid = cfg.get("bin_to_reference_grid", False) if bin_to_reference_grid is None \
        else bin_to_reference_grid
    lam_norm = settings()["reflectance"]["normalization_wavelength_um"]
    lib = load_busdemeo()
    lim_lo = max(0.75, min(r.wavelength_um.min() for r in lib.values()))
    lim_hi = min(r.wavelength_um.max() for r in lib.values())
    d = refl.copy()
    if group_col not in d:
        d[group_col] = 0
    d = d[(d["wavelength_um"] >= lim_lo) & (d["wavelength_um"] <= lim_hi) & np.isfinite(d[value_col])
          & np.isfinite(d[err_col]) & (d[err_col] > 0)]
    limitations = [
        "No visible-wavelength data (<0.75 um): classes separated mainly by visible slope cannot be distinguished.",
        f"Reference class means end at {lim_hi:.2f} um; features beyond are analysed separately (band analysis).",
        f"Spectra normalised at {lam_norm} um (DeMeo et al. 2009 near-infrared convention) instead of 0.55 um.",
        "Probabilities are relative among the Bus-DeMeo reference classes for this model; they are not "
        "probabilities that specific minerals are present.",
    ]
    if len(d) < cfg["min_overlap_points"]:
        return TaxonomyResult(status=status.INSUFFICIENT_DATA, n_points=int(len(d)),
                              limitations=limitations + [f"Only {int(len(d))} usable points in "
                                                         f"{lim_lo:.2f}-{lim_hi:.2f} um (need {cfg['min_overlap_points']})."])
    lam, R, E, G = [], [], [], []
    Cobs = None
    from .covariance import bin_with_covariance, has_visit_structure, point_covariance
    if bin_to_reference_grid and has_visit_structure(d):
        grid = next(iter(lib.values())).wavelength_um
        step = float(np.median(np.diff(grid)))
        edges = np.concatenate([grid - step / 2, [grid[-1] + step / 2]])
        Rp, pp, vp, visp = point_covariance(d, value_col, err_col)
        lam_b, R_b, Cobs, G_b = bin_with_covariance(d["wavelength_um"].values, Rp, pp, vp, visp,
                                                    d[group_col].values, edges)
        lam, R, G = list(lam_b), list(R_b), list(G_b)
        E = list(np.sqrt(np.diag(Cobs)))
        limitations.append("Errors: photometric noise plus visit-correlated normalisation error (full covariance).")
    elif bin_to_reference_grid:
        from ..preprocessing.spectrum_cleaning import bin_spectrum
        grid = next(iter(lib.values())).wavelength_um
        step = float(np.median(np.diff(grid)))
        edges = np.concatenate([grid - step / 2, [grid[-1] + step / 2]])
        for gk, gg in d.groupby(group_col):
            c, v, e, _ = bin_spectrum(gg["wavelength_um"].values, gg[value_col].values, gg[err_col].values, edges)
            lam += list(c); R += list(v); E += list(e); G += [gk] * len(c)
    else:
        lam, R, E, G = (list(d[c].values) for c in ("wavelength_um", value_col, err_col, group_col))
    order = np.argsort(lam)
    lam, R, E, G = (np.asarray(a)[order] for a in (lam, R, E, G))
    if Cobs is not None:
        Cobs = Cobs[np.ix_(order, order)]
    n_groups = int(len(np.unique(G)))
    x = lam - lam_norm
    slope_used = slope_sys_per_um is not None and slope_mode == "separate"
    if not slope_used and slope_mode == "separate":
        limitations.append("Spectral slope not used for classification: the relative brightness of the spectral "
                           "segments is not constrained by the observations.")
    if n_groups > 1:
        limitations.append(f"{n_groups} normalisation groups fitted with independent brightness scales: only the "
                           "spectral shape within each group is used.")

    resampled = {name: resample_reference(ref, lam, cfg["spherex_resolving_power"], lam_norm)
                 for name, ref in lib.items()}
    # Intra-class variance: slope-like part -> slope prior; residual -> shape tolerance (see
    # reference_library.sigma_decomposition). Slope and scale are free parameters here, so using the
    # full published sigma as shape tolerance would count slope variation twice.
    decomp = {name: sigma_decomposition(ref) for name, ref in lib.items()}
    norms = {name: float(np.interp(lam_norm, ref.wavelength_um, ref.reflectance)) for name, ref in lib.items()}
    shape_rel = [decomp[n][0] / norms[n] for n in lib if decomp[n][0] is not None]
    shape_floor = float(np.median(shape_rel)) if shape_rel else 0.02
    sl_cfg = cfg.get("slope_sigma_min", 0.03), cfg.get("slope_sigma_max", 0.10)
    no_sigma, rows = [], []
    for name, (rr, rs, inside) in resampled.items():
        shp, slp = decomp[name]
        if shp is None:
            no_sigma.append(name)
            rs = np.full_like(rr, shape_floor) * rr
            sl_class = float(sl_cfg[1])
        else:
            rs = np.full_like(rr, shp / norms[name]) * rr / np.where(rr > 0, rr, 1.0)
            mean_ref = float(np.nanmean(lib[name].reflectance[(lib[name].wavelength_um >= 0.75)]))
            sl_class = float(np.clip(slp / mean_ref, *sl_cfg))
        sl_sigma = np.hypot(sl_class, slope_sys_per_um) if slope_used else None
        c2, pen, beta, dev, sc = _fit_class(R, E, G, rr, rs, x, sl_sigma, name in W_ELIGIBLE, likelihood, slope_mode,
                                            Cobs=Cobs)
        n = len(R)
        rows.append({"class": name, "complex": complex_of(name), "chi2": c2, "slope_penalty": pen, "deviance": dev,
                     "chi2_red": c2 / max(n - n_groups - 1, 1), "beta_slope": beta, "scale": sc,
                     "class_slope_sigma": sl_class, "n": n, "sigma_assumed": name in no_sigma})
    if no_sigma:
        limitations.append(f"Classes without published intra-class sigma ({', '.join(sorted(no_sigma))}) use the "
                           "median shape sigma of all classes and the upper slope tolerance.")
    tab = pd.DataFrame(rows).dropna(subset=["deviance"])
    dmin = tab["deviance"].min()
    scale = float(max(tab.loc[tab["deviance"].idxmin(), "chi2_red"], 1.0))
    tab["probability"] = np.exp(-0.5 * (tab["deviance"] - dmin) / scale)
    tab["probability"] /= tab["probability"].sum()
    tab = tab.sort_values(["probability", "deviance"], ascending=[False, True]).reset_index(drop=True)
    tab.insert(0, "rank", np.arange(1, len(tab) + 1))
    tab["score"] = tab["probability"]            # backward-compatible alias
    cx = tab.groupby("complex")["probability"].sum().sort_values(ascending=False)
    best = tab.iloc[0]
    best_label = best["class"]
    for grp in cfg["visible_dependent_groups"]:
        if best["class"] in grp:
            gscore = tab[tab["class"].isin(grp)]["probability"].sum()
            best_label = f"{best['class']} (ambiguous within {'/'.join(grp)}; group probability {gscore:.0%})"
    if best["class"] in W_ELIGIBLE and slope_used:
        sig_b = np.hypot(best["class_slope_sigma"], slope_sys_per_um)
        if best["beta_slope"] > 2 * sig_b:
            best_label += " - high slope ('w', DeMeo et al. 2009)"

    # confidence from the separation between complexes
    cdev = tab.groupby("complex")["deviance"].min().sort_values()
    sep = float((cdev.iloc[1] - cdev.iloc[0]) / scale) if len(cdev) > 1 else np.inf
    reasons = []
    conf = status.CONF_HIGH if sep >= 9 else status.CONF_MEDIUM if sep >= 4 else status.CONF_LOW
    reasons.append(f"best complex {cdev.index[0]} vs runner-up {cdev.index[1] if len(cdev) > 1 else '-'}: "
                   f"delta deviance {sep:.1f} (scaled)")
    s_vs_d = {}
    if "D-type" in cdev and "S-complex" in cdev:
        dsd = float((cdev["D-type"] - cdev["S-complex"]) / scale)
        s_vs_d = {"delta_deviance_D_minus_S": dsd, "distinguished": bool(abs(dsd) >= 4),
                  "favoured": "S-complex" if dsd > 0 else "D-type"}
        if abs(dsd) < 4 and cdev.index[0] in ("S-complex", "D-type"):
            conf = status.CONF_LOW
            reasons.append(f"insufficient to distinguish S-complex from D-type (delta {dsd:+.1f} < 4)")
    band_region = (lam < 1.10).sum()
    if band_region < 3:
        reasons.append("1-um band region (<1.1 um) not covered")
        if cdev.index[0] not in ("C-complex", "X-complex"):
            conf = status.CONF_LOW
    if band_evidence and band_evidence.get("band_I_detected") and best["class"] in FEATURELESS_NIR:
        conf = status.CONF_LOW
        reasons.append(f"featureless class {best['class']} ranked first although a 1-um band is detected")
    if not slope_used and best["class"] in FEATURELESS_NIR:
        conf = status.CONF_LOW
        reasons.append("featureless classes are separated mainly by slope, which is not constrained here")
    if scale > 1.5:
        limitations.append(f"Best-fit chi2_red = {scale:.1f}: probabilities were computed with errors inflated "
                           f"by sqrt({scale:.1f}) to account for unexplained scatter.")
    ranking = tab.to_dict("records")
    complex_ranking = [{"rank": i + 1, "complex": k, "probability": float(v)} for i, (k, v) in enumerate(cx.items())]
    res = TaxonomyResult(
        status="CANDIDATE", candidates=ranking[: cfg["top_n_candidates"]], ranking=ranking,
        complex_ranking=complex_ranking, probability_scale=scale,
        complex_scores={k: float(v) for k, v in cx.items()}, best_class=best_label,
        best_complex=str(best["complex"]), confidence=conf, confidence_reasons=reasons,
        wavelength_range_um=(float(lam.min()), float(lam.max())), n_points=int(len(lam)), n_norm_groups=n_groups,
        slope_used=slope_used, slope_sys_per_um=slope_sys_per_um, complex_separation=sep, s_vs_d=s_vs_d,
        limitations=limitations)
    try:
        res.pca = pca_projection(lam, R, lib, lam_norm)
    except Exception as err:  # noqa: BLE001
        res.pca = {"status": f"PCA unavailable: {err}"}
    return res


def pca_projection(lam, R, lib, lam_norm, n_components=3):
    from sklearn.decomposition import PCA
    R_cfg = settings()["classification"]["spherex_resolving_power"]
    names, X = [], []
    for name, ref in lib.items():
        rr, _, inside = resample_reference(ref, lam, R_cfg, lam_norm)
        if np.isfinite(rr).all():
            names.append(name)
            X.append(rr)
    X = np.array(X)
    pca = PCA(n_components=min(n_components, len(X) - 1)).fit(X)
    ref_scores = pca.transform(X)
    obs = pca.transform(np.asarray(R)[None, :])[0]
    d = np.linalg.norm(ref_scores - obs, axis=1)
    order = np.argsort(d)
    return {"status": "OK", "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
            "observed_scores": obs.tolist(),
            "reference_scores": {n: s.tolist() for n, s in zip(names, ref_scores)},
            "nearest_classes": [(names[i], float(d[i])) for i in order[:5]],
            "note": "PCA basis built from Bus-DeMeo class means resampled to the observed SPHEREx wavelengths."}


def train_classifier(features: np.ndarray, labels: np.ndarray, groups: np.ndarray,
                     model: str = "random_forest", test_size: float = 0.25, seed: int = 0) -> dict:
    """Train a supervised classifier on an independent labelled set (e.g. resampled
    laboratory/telescopic spectra). `groups` identifies the object of each spectrum so the
    same object never appears in both training and validation sets."""
    from sklearn.metrics import classification_report
    from sklearn.model_selection import GroupShuffleSplit

    if len(np.unique(labels)) < 2 or len(labels) < 20:
        raise ValueError("Training data insufficient: need >= 20 labelled spectra and >= 2 classes.")
    split = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    tr, te = next(split.split(features, labels, groups))
    leak = set(groups[tr]) & set(groups[te])
    if leak:
        raise RuntimeError(f"Data leakage: objects in both splits: {sorted(leak)[:5]}")
    counts = pd.Series(labels[tr]).value_counts()
    if model == "random_forest":
        from sklearn.ensemble import RandomForestClassifier
        clf = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=seed)
    elif model == "svm":
        from sklearn.svm import SVC
        clf = SVC(probability=True, class_weight="balanced", random_state=seed)
    elif model == "xgboost":
        from xgboost import XGBClassifier  # optional dependency
        clf = XGBClassifier(n_estimators=300, random_state=seed)
    else:
        raise ValueError(model)
    clf.fit(features[tr], labels[tr])
    report = classification_report(labels[te], clf.predict(features[te]), output_dict=True, zero_division=0)
    return {"model": clf, "validation_report": report, "train_class_counts": counts.to_dict(),
            "imbalance_ratio": float(counts.max() / counts.min()), "n_train": len(tr), "n_validation": len(te)}
