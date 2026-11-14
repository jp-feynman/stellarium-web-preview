"""JPL Small-Body Database (SBDB), Horizons and SB-Ident clients.

Roles are kept distinct:
  * SBDB     - catalogue of orbits and physical parameters (H, G, diameter, albedo, GM...)
  * Horizons - ephemerides and observing geometry (RA/Dec, r, Delta, phase angle, rates).
               Horizons is NOT treated as a source of H.
  * SB-Ident - identification of known small bodies in a field at a given epoch.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from ..common.config import data_sources
from ..common.constants import MJD_TO_JD
from ..common.http import DataAccessError, get_json, request
from ..common.provenance import DataSource


def _f(x) -> Optional[float]:
    try:
        return None if x in (None, "", "n.a.") else float(x)
    except (TypeError, ValueError):
        return None


@dataclass
class PhysicalParameter:
    name: str
    value: Optional[float]
    sigma: Optional[float]
    units: Optional[str]
    reference: str
    notes: str = ""
    raw_value: str = ""


@dataclass
class SBDBRecord:
    found: bool
    query: str
    designation: str = ""
    fullname: str = ""
    spkid: str = ""
    kind: str = ""
    orbit_class: str = ""
    neo: Optional[bool] = None
    orbit_id: str = ""
    orbit_source: str = ""
    condition_code: str = ""
    elements: dict = field(default_factory=dict)
    phys: dict = field(default_factory=dict)        # name -> PhysicalParameter
    message: str = ""
    source: Optional[DataSource] = None

    def param(self, name: str) -> Optional[PhysicalParameter]:
        return self.phys.get(name)

    def value(self, name: str) -> Optional[float]:
        p = self.phys.get(name)
        return p.value if p else None

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k not in ("phys", "source")}
        d["phys"] = {k: v.__dict__ for k, v in self.phys.items()}
        d["source"] = self.source.to_dict() if self.source else None
        return d


class SBDBClient:
    def __init__(self):
        cfg = data_sources()["jpl"]
        self.url = cfg["sbdb_api"]
        self.timeout = cfg.get("timeout_s", 120)

    def lookup(self, designation: str) -> SBDBRecord:
        """Query SBDB by number, name, provisional designation or SPK-ID.

        A not-found result does NOT mean the object is undiscovered: the caller should
        try alternative identifiers and the MPC before labelling an object uncatalogued.
        """
        params = {"sstr": designation, "phys-par": "1", "full-prec": "1"}
        src = DataSource(name="JPL SBDB", url=self.url, query=json.dumps(params))
        data = get_json(self.url, params=params, timeout=self.timeout)
        if "object" not in data:
            msg = data.get("message", "not found")
            if "list" in data:  # ambiguous: several matches
                msg = "Ambiguous designation; candidates: " + ", ".join(
                    f"{x.get('pdes')} ({x.get('name')})" for x in data["list"][:10])
            return SBDBRecord(found=False, query=designation, message=msg, source=src)

        obj = data["object"]
        orbit = data.get("orbit", {}) or {}
        elements = {e["name"]: {"value": _f(e.get("value")), "sigma": _f(e.get("sigma")),
                                "units": e.get("units")} for e in orbit.get("elements", [])}
        phys = {}
        for p in data.get("phys_par", []) or []:
            phys[p["name"]] = PhysicalParameter(
                name=p["name"], value=_f(p.get("value")), sigma=_f(p.get("sigma")),
                units=p.get("units"), reference=p.get("ref") or "", notes=p.get("notes") or "",
                raw_value=str(p.get("value")))
        src.version = f"orbit_id={orbit.get('orbit_id', '')}; soln_date={orbit.get('soln_date', '')}"
        src.identifier = obj.get("spkid", "")
        return SBDBRecord(
            found=True, query=designation, designation=obj.get("des", ""),
            fullname=obj.get("fullname", ""), spkid=obj.get("spkid", ""), kind=obj.get("kind", ""),
            orbit_class=(obj.get("orbit_class") or {}).get("code", ""), neo=obj.get("neo"),
            orbit_id=str(orbit.get("orbit_id", "")), orbit_source=orbit.get("source", ""),
            condition_code=str(orbit.get("condition_code", "")), elements=elements, phys=phys,
            source=src)


# ---------------------------------------------------------------------------
# Horizons
# ---------------------------------------------------------------------------

HORIZONS_QUANTITIES = "1,3,9,19,20,24"   # RA/Dec, rates, V/APmag, r, Delta, phase (S-T-O)


@dataclass
class EphemerisResult:
    table: pd.DataFrame          # columns: mjd, ra_deg, dec_deg, dra_cosdec_arcsec_h, ddec_arcsec_h,
                                 # vmag, r_au, delta_au, phase_deg
    target: str
    observer_center: str
    source: DataSource


class HorizonsClient:
    def __init__(self):
        cfg = data_sources()["jpl"]
        self.url = cfg["horizons_api"]
        self.timeout = cfg.get("timeout_s", 120)

    @staticmethod
    def command_for(designation: str, spkid: str | None = None) -> str:
        if spkid:
            return f"'DES={spkid};'"    # Horizons requires the DES= form for small-body SPK-IDs
        d = designation.strip()
        if d.isdigit():
            return f"'{d};'"            # numbered asteroid (';' = small body, not a planet)
        return f"'DES={d};'"

    def observer_ephemeris(self, designation: str, mjd_list, center: str = "500@-163182",
                           spkid: str | None = None, chunk: int = 50) -> EphemerisResult:
        mjd_list = np.atleast_1d(np.asarray(mjd_list, float))
        frames = []
        sig = ""
        for i in range(0, len(mjd_list), chunk):
            sub = mjd_list[i:i + chunk]
            tlist = " ".join(f"'{m + MJD_TO_JD:.8f}'" for m in sub)
            params = {
                "format": "json", "COMMAND": self.command_for(designation, spkid),
                "EPHEM_TYPE": "OBSERVER", "CENTER": f"'{center}'", "TLIST": tlist,
                "TLIST_TYPE": "JD", "TIME_TYPE": "UT", "QUANTITIES": f"'{HORIZONS_QUANTITIES}'",
                "CSV_FORMAT": "YES", "ANG_FORMAT": "DEG", "EXTRA_PREC": "YES", "OBJ_DATA": "NO",
            }
            data = get_json(self.url, params=params, timeout=self.timeout)
            sig = json.dumps(data.get("signature", {}))
            df = self._parse(data.get("result", ""))
            df.insert(0, "mjd", sub[: len(df)])
            frames.append(df)
        table = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        src = DataSource(name="JPL Horizons", url=self.url,
                         query=f"COMMAND={self.command_for(designation, spkid)} CENTER={center} "
                               f"QUANTITIES={HORIZONS_QUANTITIES} n_epochs={len(mjd_list)}",
                         version=sig)
        return EphemerisResult(table=table, target=designation, observer_center=center, source=src)

    def range_ephemeris(self, designation: str, start: str, stop: str, step: str = "1d",
                        center: str = "500@399", spkid: str | None = None) -> EphemerisResult:
        params = {
            "format": "json", "COMMAND": self.command_for(designation, spkid),
            "EPHEM_TYPE": "OBSERVER", "CENTER": f"'{center}'", "START_TIME": f"'{start}'",
            "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'",
            "QUANTITIES": "'1,3,9,19,20,23,24'", "CSV_FORMAT": "YES", "ANG_FORMAT": "DEG",
            "OBJ_DATA": "NO", "CAL_FORMAT": "JD",
        }
        data = get_json(self.url, params=params, timeout=self.timeout)
        df = self._parse(data.get("result", ""), with_elong=True, jd_first=True)
        src = DataSource(name="JPL Horizons", url=self.url, query=json.dumps(params),
                         version=json.dumps(data.get("signature", {})))
        return EphemerisResult(table=df, target=designation, observer_center=center, source=src)

    @staticmethod
    def _parse(result: str, with_elong: bool = False, jd_first: bool = False) -> pd.DataFrame:
        if "$$SOE" not in result:
            raise DataAccessError("Horizons returned no ephemeris: " + result[:500].replace("\n", " "))
        header_line = ""
        for line in result.splitlines():
            if line.strip().startswith("Date") and "R.A." in line:
                header_line = line
                break
        body = result.split("$$SOE")[1].split("$$EOE")[0].strip()
        cols = [c.strip() for c in header_line.split(",")]
        rows = [[c.strip() for c in ln.split(",")] for ln in body.splitlines() if ln.strip()]
        raw = pd.DataFrame(rows).iloc[:, : len(cols)]
        raw.columns = cols[: raw.shape[1]]

        def col(prefix):
            for c in raw.columns:
                if c.startswith(prefix):
                    return pd.to_numeric(raw[c].replace("n.a.", np.nan), errors="coerce")
            return pd.Series(np.nan, index=raw.index)

        out = pd.DataFrame({
            "ra_deg": col("R.A."), "dec_deg": col("DEC"),
            "dra_cosdec_arcsec_h": col("dRA*cosD"), "ddec_arcsec_h": col("d(DEC)/dt"),
            "vmag": col("APmag") if col("APmag").notna().any() else col("T-mag"),
            "r_au": col("r"), "delta_au": col("delta"), "phase_deg": col("S-T-O"),
        })
        if with_elong:
            out["elongation_deg"] = col("S-O-T")
        if jd_first:
            out.insert(0, "mjd", pd.to_numeric(raw.iloc[:, 0], errors="coerce") - MJD_TO_JD)
        return out


class SBIdentClient:
    """JPL SB-Ident: which known small bodies lie in a field at a given time."""

    def __init__(self):
        cfg = data_sources()["jpl"]
        self.url = cfg["sb_ident_api"]
        self.timeout = cfg.get("timeout_s", 120)

    def identify(self, ra_deg: float, dec_deg: float, mjd: float, radius_arcsec: float = 60.0,
                 mpc_code: str = "500") -> tuple[pd.DataFrame, DataSource]:
        """Geocentric (MPC code 500) query; SPHEREx parallax (up to ~10" at 1 au) must be
        absorbed by the search radius or corrected by the caller."""
        half = radius_arcsec / 3600.0
        params = {
            "mpc-code": mpc_code, "obs-time": f"{mjd + MJD_TO_JD:.6f}",
            "fov-ra-center": f"{ra_deg:.6f}", "fov-dec-center": f"{dec_deg:.6f}",
            "fov-ra-hwidth": f"{half:.6f}", "fov-dec-hwidth": f"{half:.6f}",
            "two-pass": "true", "suppress-first-pass": "true",
        }
        src = DataSource(name="JPL SB-Ident", url=self.url, query=json.dumps(params))
        data = get_json(self.url, params=params, timeout=self.timeout)
        fields = data.get("fields_second") or data.get("fields_first") or []
        rows = data.get("data_second_pass") or data.get("data_first_pass") or []
        df = pd.DataFrame(rows, columns=fields) if rows else pd.DataFrame(columns=fields)
        return df, src
