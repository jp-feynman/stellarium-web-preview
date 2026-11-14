# SPHEREx Asteroid Spectral and Physical Analysis System

Research software that finds asteroids in NASA SPHEREx spectral images, extracts their
0.75–5.0 µm spectra, separates reflected sunlight from thermal emission (NEATM), proposes
spectral-type and mineral candidates, estimates diameter, absolute magnitude H and
geometric albedo, and links mass and density from dynamical measurements.

Principles enforced in code:
- Observed SPHEREx data first. Synthetic data is labelled `SIMULATED` and kept in separate files and databases.
- No invented values. Missing results are `N/A`, `Unknown`, `Insufficient Data`, `H unavailable`, or
  `Not estimable from available data`.
- Every result records its inputs, formula, model version (with a hash of the config) and data sources.
- Albedo is computed only from a thermal-model diameter plus a reliable V-band H.
- No telescope or observatory is a default source of optical photometry.
- The UI is in English, with every string in `src/i18n/locales/en.yaml`.

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest                         # offline unit tests
pytest --run-network           # adds live IRSA / JPL tests

# full pipeline for (4) Vesta over its first SPHEREx season (limit to 60 exposures)
python main.py analyze --target 4 --start 2025-05-01 --end 2025-09-30 --max-images 60
python main.py dashboard       # Streamlit UI at http://localhost:8501

# relative spectral calibration from SPHEREx photometry of solar analogs (once per data release;
# about 4 MB per cached cutout in data/raw/spherex_cutouts_solar_analogs/)
python main.py solar-analog-calibration --start 2025-03-01 --end 2026-11-14 --max-images-per-star 150
```

The stored correction (`data/calibration/solar_analog_correction.csv`) is applied to every OBSERVED
spectrum in the shared analysis chain; without it nothing is corrected and the report says so.

Outputs go to `outputs/<target>/`: the stage CSVs, `report.md`, `integrated_record.json` and PNG
plots. Integrated results are stored in `outputs/asteroids.sqlite`.

## Stages and commands

| # | Stage | Command | Module |
|---|-------|---------|--------|
| 1 | Find SPHEREx exposures of an asteroid | `search` | `src/acquisition/spherex_search.py` |
| 2 | 0.75–5.0 µm forced PSF photometry | `extract` | `src/extraction/spectral_extraction.py` |
| 3 | Reflected / thermal separation (NEATM) | `separate` | `src/preprocessing/thermal_separation.py` |
| 4 | Type and mineral candidates | `classify` | `src/classification/` |
| 5 | Diameter, H, albedo | `separate`, `h-estimate`, `albedo` | `src/physical/` |
| 6 | Mass and density | `mass-density` | `src/physical/mass.py`, `density.py` |
| 7 | Integration, report, dashboard | `analyze`, `dashboard` | `src/integration/`, `src/visualization/` |
| – | Relative spectral calibration from solar-analog stars | `solar-analog-calibration` | `src/preprocessing/solar_analog_calibration.py`, `src/acquisition/fixed_source_search.py` |
| – | Validation against known bodies | `validate` | `src/validation/validation.py` |
| – | Taxonomy validation (C1–C8, e.g. 433 Eros) | `validate-taxonomy --target 433` | `src/validation/taxonomy_validation.py` |
| – | Follow-up requirements (any facility) | `followup` | `src/orbital/followup_planning.py` |

Documentation: [docs/INSTALL.md](docs/INSTALL.md), [docs/DATA_ACCESS.md](docs/DATA_ACCESS.md),
[docs/METHODS.md](docs/METHODS.md) (science, assumptions, limitations), and
[docs/STAGE_STATUS.md](docs/STAGE_STATUS.md) (what is verified against real data).
