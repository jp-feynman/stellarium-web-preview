"""SQLite store for integrated results.

A database file holds either OBSERVED or SIMULATED data, never both; the origin is
fixed in the `meta` table at creation and every insert is checked against it.
Simulated databases must have 'SIMULATED' or 'SYNTHETIC' in the file name.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pandas as pd

from ..common import status
from ..common.config import resolve

RESULT_COLUMNS = [
    # basic
    "asteroid_id", "provisional_designation", "official_name", "discovery_status", "observation_date",
    "right_ascension", "declination",
    # observation summary
    "spherex_observation_id", "n_spectral_points", "signal_to_noise_median", "quality_flag",
    # spectral analysis
    "spectral_class", "spectral_class_probability", "spectral_complex_probability", "spectral_complex",
    "classification_confidence", "spectral_calibration",
    "mineral_candidates", "absorption_features", "estimated_temperature", "estimated_temperature_err",
    # photometry / H
    "absolute_magnitude_H", "H_uncertainty", "absolute_magnitude_source", "photometry_source_ids",
    "filter_system", "phase_function_model", "phase_function_parameters", "photometry_epochs",
    "photometry_quality",
    # physical
    "diameter_km", "diameter_uncertainty", "diameter_source", "diameter_conditional_range_km",
    "catalog_diameter_km", "catalog_diameter_uncertainty", "catalog_diameter_source",
    "geometric_albedo_pV", "albedo_uncertainty", "albedo_band", "albedo_method", "albedo_status",
    "mass_kg", "mass_uncertainty", "mass_method", "density", "density_uncertainty", "density_unit",
    "shape_assumption",
    # analysis
    "analysis_timestamp", "model_version", "input_data_sources", "quality_status", "confidence_level",
    "missing_data", "limitations", "origin",
]


class AsteroidDatabase:
    def __init__(self, path: str | Path, origin: str = status.ORIGIN_OBSERVED):
        self.path = resolve(path)
        if origin == status.ORIGIN_SIMULATED and not any(k in self.path.name.upper() for k in ("SIMULATED", "SYNTHETIC")):
            raise ValueError("Simulated data must be stored in a file whose name contains SIMULATED or SYNTHETIC.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self._init(origin)

    def _init(self, origin):
        c = self.conn
        c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        row = c.execute("SELECT value FROM meta WHERE key='origin'").fetchone()
        if row is None:
            c.execute("INSERT INTO meta VALUES ('origin', ?)", (origin,))
        elif row[0] != origin:
            raise ValueError(f"Database {self.path.name} holds {row[0]} data; refusing to open as {origin}.")
        self.origin = origin
        cols = ", ".join(f'"{k}" TEXT' if k not in ("asteroid_id",) else f'"{k}" TEXT PRIMARY KEY'
                         for k in RESULT_COLUMNS)
        c.execute(f"CREATE TABLE IF NOT EXISTS results ({cols})")
        # Schema migration: databases created by older versions get new result columns added
        # (existing rows keep NULL for them); nothing is dropped or rewritten.
        have = {r[1] for r in c.execute("PRAGMA table_info(results)")}
        for k in RESULT_COLUMNS:
            if k not in have:
                c.execute(f'ALTER TABLE results ADD COLUMN "{k}" TEXT')
        c.execute("""CREATE TABLE IF NOT EXISTS spectra (asteroid_id TEXT, obs_id TEXT, detector INTEGER,
                     band TEXT, mjd REAL, wavelength_um REAL, bandwidth_um REAL, flux_uJy REAL,
                     flux_err_uJy REAL, snr REAL, quality_flag TEXT, reflectance REAL, reflectance_err REAL,
                     model_thermal_uJy REAL, model_reflected_uJy REAL, r_au REAL, delta_au REAL,
                     phase_deg REAL, source_file TEXT, origin TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS observations (asteroid_id TEXT, obs_id TEXT, detector INTEGER,
                     band TEXT, mjd_mid REAL, pred_ra_deg REAL, pred_dec_deg REAL, image_url TEXT,
                     inside_footprint INTEGER, ephemeris_source TEXT, origin TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS candidates (candidate_id TEXT PRIMARY KEY, mjd REAL, ra_deg REAL,
                     dec_deg REAL, snr REAL, obs_id TEXT, band TEXT, tracklet_id TEXT, status TEXT,
                     jpl_registered INTEGER, mpc_registered INTEGER, needs_followup INTEGER, note TEXT,
                     origin TEXT)""")
        c.execute("CREATE TABLE IF NOT EXISTS provenance (asteroid_id TEXT, step TEXT, record TEXT)")
        c.commit()

    def _check(self, origin):
        if origin != self.origin:
            raise ValueError(f"Refusing to write {origin} data into a {self.origin} database.")

    def upsert_result(self, record: dict):
        self._check(record.get("origin", self.origin))
        rec = {k: record.get(k) for k in RESULT_COLUMNS}
        rec["origin"] = self.origin
        vals = [json.dumps(v, default=str) if isinstance(v, (dict, list, tuple)) else (None if v is None else str(v))
                for v in rec.values()]
        q = f"INSERT OR REPLACE INTO results ({', '.join(chr(34) + k + chr(34) for k in rec)}) " \
            f"VALUES ({', '.join('?' * len(rec))})"
        self.conn.execute(q, vals)
        self.conn.commit()

    def _write_df(self, table, df, asteroid_id=None):
        if df is None or df.empty:
            return
        cols = [r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")]
        d = df.copy()
        if asteroid_id is not None:
            d["asteroid_id"] = asteroid_id
        if "origin" in d and (d["origin"] != self.origin).any():
            raise ValueError(f"Refusing to mix origins in table {table}.")
        d["origin"] = self.origin
        d = d[[c for c in cols if c in d.columns]]
        if asteroid_id is not None and "asteroid_id" in cols:
            self.conn.execute(f"DELETE FROM {table} WHERE asteroid_id=?", (asteroid_id,))
        d.to_sql(table, self.conn, if_exists="append", index=False)
        self.conn.commit()

    def write_spectrum(self, asteroid_id, df):
        self._write_df("spectra", df, asteroid_id)

    def write_observations(self, asteroid_id, df):
        d = df.drop(columns=[c for c in ("corners",) if c in df.columns])
        self._write_df("observations", d, asteroid_id)

    def write_candidates(self, df):
        self._write_df("candidates", df)

    def write_provenance(self, asteroid_id, step, record: dict):
        self.conn.execute("INSERT INTO provenance VALUES (?, ?, ?)",
                          (asteroid_id, step, json.dumps(record, default=str)))
        self.conn.commit()

    def results(self) -> pd.DataFrame:
        return pd.read_sql("SELECT * FROM results", self.conn)

    def spectrum(self, asteroid_id) -> pd.DataFrame:
        return pd.read_sql("SELECT * FROM spectra WHERE asteroid_id=?", self.conn, params=(asteroid_id,))

    def observations(self, asteroid_id) -> pd.DataFrame:
        return pd.read_sql("SELECT * FROM observations WHERE asteroid_id=?", self.conn, params=(asteroid_id,))

    def provenance(self, asteroid_id) -> pd.DataFrame:
        return pd.read_sql("SELECT * FROM provenance WHERE asteroid_id=?", self.conn, params=(asteroid_id,))

    def close(self):
        self.conn.close()
