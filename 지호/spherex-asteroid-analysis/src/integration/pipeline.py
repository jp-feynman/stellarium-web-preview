"""End-to-end pipeline for one known asteroid. Every stage can also be run on its own
(see main.py). A stage whose inputs are missing is skipped and recorded; no value is
substituted."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ..acquisition.optical_data_client import CSVPhotometryProvider, MPCObservationsProvider, collect_photometry
from ..acquisition.spherex_search import save_search_result, search_known_asteroid
from ..classification.mineral_identification import analyse_minerals
from ..classification.taxonomy import classify
from ..common import status
from ..common.config import resolve, settings
from ..extraction.spectral_extraction import extract_spectrum, save_spectrum
from ..i18n import t
from ..orbital.ephemeris import geometry_for_epochs
from ..physical.absolute_magnitude import estimate_h, h_from_sbdb
from ..physical.albedo import albedo_from_thermal_fit
from ..physical.density import compute_density, parse_extent
from ..physical.mass import mass_from_sbdb
from ..preprocessing.spectrum_cleaning import reject_outliers, select_usable
from ..preprocessing.thermal_separation import ThermalSeparator, reflectance_spectrum
from .asteroid_database import AsteroidDatabase
from .spectrum_analysis import analyse_spectrum
from .report_generator import build_report, save_report
from .result_merger import merge


@dataclass
class PipelineOutput:
    target: str
    record: dict
    files: dict = field(default_factory=dict)
    log: list = field(default_factory=list)


def _safe(name):
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)


def resolve_absolute_magnitude(sbdb, designation, photometry_csv=None, use_mpc=True, log=print):
    """SBDB H first; if absent, collect photometry from any available providers and estimate H."""
    h = h_from_sbdb(sbdb)
    if h.reliable:
        return h
    providers = []
    if use_mpc:
        providers.append(MPCObservationsProvider())
    if photometry_csv:
        providers.append(CSVPhotometryProvider(photometry_csv))
    if not providers:
        return h
    phot, sources, errors = collect_photometry(designation, providers)
    for e in errors:
        log(t("cli.step_failed", step="photometry", reason=e))
    if phot.empty:
        h.followup_requirements = h.followup_requirements or [
            "No optical photometry found in the queried sources."]
        return h
    geom, gsrc = geometry_for_epochs(designation, phot["mjd"].values, spkid=getattr(sbdb, "spkid", None),
                                     observatory_codes=phot["observatory_code"].values)
    G0 = sbdb.value("G") if sbdb is not None and sbdb.found else None
    est = estimate_h(phot, geom, G_default=G0)
    est.photometry_sources = [s.name for s in sources]
    return est


def run_analysis(target: str, start: str, end: str, max_images: int | None = None,
                 photometry_csv: str | None = None, use_mpc_photometry: bool = True,
                 out_dir: str | None = None, db_path: str | None = None, log=print) -> PipelineOutput:
    cfg = settings()
    out = resolve(out_dir or cfg["project"]["output_dir"]) / _safe(target)
    out.mkdir(parents=True, exist_ok=True)
    po = PipelineOutput(target=target, record={})

    def L(msg):
        po.log.append(msg)
        log(msg)

    # Stage 1
    L(t("cli.searching", target=target, start=start, end=end))
    search = search_known_asteroid(target, start, end)
    for m in search.messages:
        L(m)
    sbdb = search.sbdb
    obs = search.observations
    if not obs.empty:
        L(t("cli.found_exposures", n=len(obs), n_inside=int(obs["inside_footprint"].sum())))
        save_search_result(search, out / "stage1_observations.csv")
        po.files["observations"] = str(out / "stage1_observations.csv")
    else:
        L(t("cli.no_exposures", target=target))

    # Stage 2
    spectrum = pd.DataFrame()
    if not obs.empty:
        use = obs[obs["inside_footprint"]]
        L(t("cli.extracting", n=len(use) if max_images is None else min(len(use), max_images)))
        spectrum, prov2 = extract_spectrum(use, max_images=max_images)
        for w in prov2.warnings[:20]:
            L("  " + w)
        if not spectrum.empty:
            qc = spectrum["quality_flag"].value_counts()
            L(t("cli.extracted", n=len(spectrum), n_good=int(qc.get("GOOD", 0)), n_warn=int(qc.get("WARN", 0)),
                n_bad=int(qc.get("BAD", 0))))
            save_spectrum(spectrum, out / "stage2_spectrum.csv")
            po.files["spectrum"] = str(out / "stage2_spectrum.csv")

    # Stage 5 prerequisite: H
    h_res = resolve_absolute_magnitude(sbdb, target, photometry_csv, use_mpc_photometry, log=L)

    # Stages 3-5: observation-time analysis, data-supported brightness correction, thermal fit,
    # reflectance, bands, classification (shared chain, see spectrum_analysis.py)
    rot_p = sbdb.value("rot_per") if sbdb is not None and sbdb.found else None
    if rot_p is None:
        L("Rotation period unknown: no periodic lightcurve correction can be considered.")
    thermal = taxonomy = minerals = albedo = dres = temporal = calibration = None
    refl = pd.DataFrame()
    if not spectrum.empty:
        L(t("cli.thermal_fit"))
        ana = analyse_spectrum(spectrum, h_result=h_res, sbdb=sbdb, rotation_period_h=rot_p, log=L)
        temporal, thermal, dres, albedo = ana.temporal, ana.thermal, ana.diameter, ana.albedo
        taxonomy, minerals = ana.taxonomy, ana.minerals
        calibration = ana.calibration
        sep = ana.separator
        if ana.reflectance is not None:
            refl = ana.reflectance
            refl.to_csv(out / "stage3_components_reflectance.csv", index=False)
            po.files["components"] = str(out / "stage3_components_reflectance.csv")
        if temporal is not None:
            (out / "stage3_temporal_analysis.json").write_text(json.dumps(temporal.summary(), indent=2, default=str))
            po.files["temporal"] = str(out / "stage3_temporal_analysis.json")

    # Stage 6
    mass = mass_from_sbdb(sbdb)
    density = None
    if mass.mass_kg is not None:
        ext = sbdb.param("extent") if sbdb is not None and sbdb.found else None
        ax = parse_extent(ext.raw_value, str(ext.sigma) if ext and ext.sigma is not None else None) if ext else None
        # Volume priority: SPHEREx thermal diameter > SBDB volume-equivalent diameter > extent ellipsoid.
        # Extents are maximum dimensions; for irregular bodies (Eros, Ryugu) their ellipsoid volume is
        # off by 10-20% (see validation), so they are used only as a last resort.
        if dres is not None and dres.diameter_km:
            density = compute_density(mass, dres.diameter_km, dres.diameter_total_err_km,
                                      diameter_source="SPHEREx NEATM diameter")
            if dres.confidence == "Low":
                density.status = "ON_HOLD_VALIDATION"
                density.notes = (density.notes + "; " if density.notes else "") + \
                    "based on a Low-confidence SPHEREx diameter"
        elif sbdb.param("diameter") is not None and sbdb.param("diameter").value:
            p = sbdb.param("diameter")
            density = compute_density(mass, p.value, p.sigma, diameter_source=f"SBDB diameter ({p.reference})")
        elif ax:
            density = compute_density(mass, extent_axes_km=ax[0], extent_err_km=ax[1],
                                      diameter_source=f"SBDB extent ({ext.reference})")
            density.notes = (density.notes + "; " if density.notes else "") + \
                "extent-based ellipsoid: biased for irregular shapes"
    else:
        density = compute_density(mass)

    # Stage 7
    rec = merge(target, sbdb=sbdb, search=search, spectrum=spectrum, taxonomy=taxonomy, minerals=minerals,
                thermal=thermal, h_result=h_res, diameter=dres, albedo=albedo, mass=mass, density=density,
                calibration=calibration)
    db = AsteroidDatabase(db_path or cfg["project"]["database_path"], origin=status.ORIGIN_OBSERVED)
    db.upsert_result(rec)
    if not obs.empty:
        db.write_observations(target, obs)
    if not refl.empty:
        db.write_spectrum(target, refl)
    elif not spectrum.empty:
        db.write_spectrum(target, spectrum)
    db.write_provenance(target, "search", search.provenance.to_dict())
    if thermal is not None and thermal.provenance:
        db.write_provenance(target, "thermal_separation", thermal.provenance)
    if h_res is not None and h_res.provenance:
        db.write_provenance(target, "absolute_magnitude", h_res.provenance)
    if albedo is not None and albedo.provenance:
        db.write_provenance(target, "albedo", albedo.provenance)
    if calibration is not None:
        db.write_provenance(target, "solar_analog_calibration", calibration)
    db.close()

    if temporal is not None:
        db_t = AsteroidDatabase(db_path or cfg["project"]["database_path"], origin=status.ORIGIN_OBSERVED)
        db_t.write_provenance(target, "temporal_analysis", temporal.summary())
        db_t.close()
    report = build_report(target, rec, taxonomy=taxonomy, minerals=minerals, thermal=thermal, h_result=h_res,
                          diameter=dres, albedo=albedo, mass=mass, density=density, n_exposures=len(obs),
                          temporal=temporal, calibration=calibration)
    po.files["report"] = str(save_report(report, out / "report.md"))
    (out / "integrated_record.json").write_text(json.dumps(rec, indent=2, default=str))
    po.files["record"] = str(out / "integrated_record.json")

    try:
        from ..visualization import orbit_plot, spectrum_plot
        if not spectrum.empty:
            po.files["plot_spectrum"] = spectrum_plot.save(spectrum_plot.plot_spectrum(spectrum, target),
                                                           out / "spectrum.png")
        if thermal is not None and thermal.points is not None:
            po.files["plot_separation"] = spectrum_plot.save(spectrum_plot.plot_separation(thermal.points, target),
                                                             out / "separation.png")
            po.files["plot_residuals"] = spectrum_plot.save(spectrum_plot.plot_residuals(thermal.points, target),
                                                            out / "residuals.png")
        if taxonomy is not None and taxonomy.candidates:
            po.files["plot_reference"] = spectrum_plot.save(
                spectrum_plot.plot_reference_comparison(refl, taxonomy, target), out / "reference_comparison.png")
        if not obs.empty:
            po.files["plot_sky"] = spectrum_plot.save(orbit_plot.plot_sky_track(obs, spectrum, target),
                                                      out / "sky_track.png")
    except Exception as err:  # plotting must never hide results
        L(t("cli.step_failed", step="plots", reason=err))

    po.record = rec
    L(t("cli.done", target=target, status=rec["quality_status"]))
    return po
