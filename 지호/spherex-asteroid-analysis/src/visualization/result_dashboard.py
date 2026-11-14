"""Streamlit dashboard. Run:  streamlit run src/visualization/result_dashboard.py
All visible text comes from the i18n catalogue (English)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402
import streamlit as st  # noqa: E402

from src.common import status  # noqa: E402
from src.common.config import resolve, settings  # noqa: E402
from src.i18n import t  # noqa: E402
from src.integration.asteroid_database import AsteroidDatabase  # noqa: E402

st.set_page_config(page_title=t("dashboard.title"), layout="wide")
st.title(t("dashboard.title"))

cfg = settings()["project"]
db_choice = st.sidebar.radio(t("dashboard.data_origin"), [t("common.observed"), t("common.simulated")])
simulated = db_choice == t("common.simulated")
db_path = cfg["simulated_database_path"] if simulated else cfg["database_path"]
st.sidebar.caption(f"{t('dashboard.database')}: {db_path}")
if simulated:
    st.warning(t("common.simulated"))

with st.sidebar.expander(t("dashboard.run_label")):
    tgt = st.text_input(t("dashboard.search_label"), key="run_target", placeholder=t("dashboard.search_placeholder"))
    d0 = st.text_input(t("dashboard.run_start"), "2025-05-01")
    d1 = st.text_input(t("dashboard.run_end"), "2025-09-30")
    nmax = st.number_input(t("dashboard.run_max_images"), 1, 2000, 60)
    if st.button(t("dashboard.run_button"), disabled=simulated or not tgt):
        from src.integration.pipeline import run_analysis
        with st.spinner(t("dashboard.running")):
            logbox = st.empty()
            lines = []
            run_analysis(tgt, d0, d1, max_images=int(nmax), log=lambda m: (lines.append(str(m)),
                                                                          logbox.code("\n".join(lines[-15:]))))

origin = status.ORIGIN_SIMULATED if simulated else status.ORIGIN_OBSERVED
if not resolve(db_path).exists():
    st.info(t("dashboard.empty_db"))
    st.stop()
db = AsteroidDatabase(db_path, origin=origin)
res = db.results()
if res.empty:
    st.info(t("dashboard.empty_db"))
    st.stop()

query = st.text_input(t("dashboard.search_label"), placeholder=t("dashboard.search_placeholder"))
ids = res["asteroid_id"].tolist()
sel = query.strip() if query.strip() else ids[0]
if sel not in ids:
    match = [i for i in ids if sel.lower() in str(i).lower() or sel.lower() in str(
        res.set_index("asteroid_id").loc[i, "official_name"]).lower()]
    if not match:
        st.error(t("dashboard.not_found", target=sel))
        st.stop()
    sel = match[0]
row = res.set_index("asteroid_id").loc[sel]


def jl(x):
    try:
        return json.loads(x)
    except (TypeError, ValueError):
        return x


tabs = st.tabs([t("dashboard.tab_overview"), t("dashboard.tab_spectrum"), t("dashboard.tab_classification"),
                t("dashboard.tab_physical"), t("dashboard.tab_orbit"), t("dashboard.tab_population"),
                t("dashboard.tab_provenance"), t("dashboard.tab_export")])

with tabs[0]:
    st.subheader(str(row.get("official_name") or sel))
    c = st.columns(4)
    c[0].metric(t("dashboard.col_class"), str(row.get("spectral_class") or status.NA))
    c[1].metric(t("dashboard.col_diameter"), str(row.get("diameter_km") or status.NA))
    c[2].metric(t("dashboard.col_albedo"), str(row.get("geometric_albedo_pV") or status.NA))
    c[3].metric(t("dashboard.col_density"), str(row.get("density") or status.NA))
    st.write(f"**{t('common.confidence')}:** {row.get('confidence_level')} — **{t('dashboard.col_quality')}:** "
             f"{row.get('quality_status')}")
    st.write(f"**{t('report.section_missing')}:** {', '.join(jl(row.get('missing_data')) or []) or 'none'}")
    cal = jl(row.get("spectral_calibration"))
    if isinstance(cal, dict):
        st.write(f"**{t('report.section_calibration')}:** " + (
            f"{t('report.calibration_applied')} ({cal.get('n_stars')} stars)" if cal.get("applied")
            else f"{t('report.calibration_not_applied')} - {cal.get('reason', status.NA)}"))
    with st.expander(t("common.limitations")):
        for x in jl(row.get("limitations")) or []:
            st.write("- " + x)
    st.caption(t("dashboard.help_albedo"))

spec = db.spectrum(sel)
with tabs[1]:
    if spec.empty:
        st.info(t("common.no_results"))
    else:
        import matplotlib.pyplot as plt
        from src.visualization.spectrum_plot import plot_residuals, plot_separation, plot_spectrum
        fig, ax = plt.subplots(figsize=(9, 4))
        plot_spectrum(spec, sel, ax=ax, simulated=simulated)
        st.pyplot(fig)
        if "model_total_uJy" in spec or spec["model_thermal_uJy"].notna().any():
            sp = spec.copy()
            sp["model_total_uJy"] = sp["model_thermal_uJy"].fillna(0) + sp["model_reflected_uJy"].fillna(0)
            fig2, ax2 = plt.subplots(figsize=(9, 4))
            plot_separation(sp, sel, ax=ax2, simulated=simulated)
            st.pyplot(fig2)
        st.dataframe(spec, width="stretch")

with tabs[2]:
    st.write(f"**{t('report.field_class')}:** {row.get('spectral_class')}  —  **{t('report.field_complex')}:** "
             f"{row.get('spectral_complex')}  —  **{t('common.confidence')}:** {row.get('classification_confidence')}")
    probs = jl(row.get("spectral_class_probability"))
    st.subheader(t("dashboard.taxonomy_ranking"))
    if isinstance(probs, list) and probs:
        rk = pd.DataFrame(probs).sort_values("rank")
        rk["probability_pct"] = (100 * rk["probability"]).round(2)
        st.dataframe(rk.rename(columns={"rank": t("report.field_rank"), "class": t("report.field_class"),
                                        "complex": t("report.field_complex"),
                                        "probability_pct": t("report.field_probability") + " (%)"})
                     .drop(columns=["probability"]), width="stretch", hide_index=True)
        top = rk.head(10).set_index("class")["probability_pct"]
        st.bar_chart(top, horizontal=True, sort=False)
    elif isinstance(probs, dict):            # results stored by older versions
        st.bar_chart(pd.Series(probs, name=t("report.field_probability")))
    cxp = jl(row.get("spectral_complex_probability"))
    if isinstance(cxp, list) and cxp:
        st.write(f"**{t('report.section_complex_ranking')}**")
        cdf = pd.DataFrame(cxp)
        cdf["probability"] = (100 * cdf["probability"]).round(2)
        st.dataframe(cdf.rename(columns={"rank": t("report.field_rank"), "complex": t("report.field_complex"),
                                         "probability": t("report.field_probability") + " (%)"}),
                     width="stretch", hide_index=True)
    st.caption(t("dashboard.help_scores") + " " + t("report.note_probability"))
    st.write(f"**{t('dashboard.col_minerals')}**")
    mc = jl(row.get("mineral_candidates"))
    st.dataframe(pd.DataFrame(mc) if isinstance(mc, list) else pd.DataFrame({"value": [mc]}))
    feats = jl(row.get("absorption_features"))
    if isinstance(feats, list):
        st.dataframe(pd.DataFrame(feats))

with tabs[3]:
    keys = ["absolute_magnitude_H", "H_uncertainty", "absolute_magnitude_source", "phase_function_model",
            "diameter_km", "diameter_uncertainty", "diameter_source", "diameter_conditional_range_km",
            "catalog_diameter_km", "catalog_diameter_uncertainty", "catalog_diameter_source",
            "geometric_albedo_pV", "albedo_uncertainty", "albedo_band", "albedo_status", "estimated_temperature",
            "mass_kg", "mass_uncertainty", "mass_method", "density", "density_uncertainty", "density_unit",
            "shape_assumption"]
    st.table(pd.DataFrame({t("common.value"): [row.get(k) if row.get(k) is not None else status.NA for k in keys]},
                          index=keys))

with tabs[4]:
    obs = db.observations(sel)
    if obs.empty:
        st.info(t("common.no_results"))
    else:
        import matplotlib.pyplot as plt
        from src.visualization.orbit_plot import plot_sky_track
        fig, ax = plt.subplots(figsize=(6, 5))
        plot_sky_track(obs, spec if "measured_ra_deg" in spec else None, sel, ax=ax)
        st.pyplot(fig)
        st.dataframe(obs, width="stretch")

with tabs[5]:
    from src.visualization.orbit_plot import plot_population
    st.pyplot(plot_population(res))
    view = res[["asteroid_id", "spectral_class", "mineral_candidates", "diameter_km", "geometric_albedo_pV",
                "mass_kg", "density", "quality_status"]].rename(columns={
                    "asteroid_id": t("dashboard.col_id"), "spectral_class": t("dashboard.col_class"),
                    "mineral_candidates": t("dashboard.col_minerals"), "diameter_km": t("dashboard.col_diameter"),
                    "geometric_albedo_pV": t("dashboard.col_albedo"), "mass_kg": t("dashboard.col_mass"),
                    "density": t("dashboard.col_density"), "quality_status": t("dashboard.col_quality")})
    st.subheader(t("dashboard.integrated_table"))
    st.dataframe(view, width="stretch")

with tabs[6]:
    pv = db.provenance(sel)
    for _, r in pv.iterrows():
        with st.expander(r["step"]):
            st.json(jl(r["record"]))

with tabs[7]:
    st.download_button(t("dashboard.export_csv"), res.to_csv(index=False), file_name="asteroid_results.csv")
    if not spec.empty:
        st.download_button(t("dashboard.export_spectrum"), spec.to_csv(index=False), file_name=f"{sel}_spectrum.csv")
    rp = resolve(cfg["output_dir"]) / "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in sel) / "report.md"
    if rp.exists():
        st.download_button(t("dashboard.export_report"), rp.read_text(), file_name=f"{sel}_report.md")
