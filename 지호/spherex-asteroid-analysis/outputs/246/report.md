# Analysis Report: 246

Generated 2026-11-14T08:51:34+00:00 - model version 0.1.0

## Identification

- Designation: 246 Asporina (A885 EA)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 282
- Spectral points: 120
- Quality flags: {'WARN': 102, 'GOOD': 15, 'BAD': 3}

## Relative Spectral Calibration (solar analogs)

- Status: applied - fluxes divided by the SPHEREx response measured on solar-analog stars
- Solar-analog stars: 14 (Gaia DR3 1021495028608838016, Gaia DR3 1325938803224554752, Gaia DR3 1565876532739593600, Gaia DR3 2972362529862291200, Gaia DR3 4662850696812855168, Gaia DR3 4769435292423335168, Gaia DR3 5050053165460308224, Gaia DR3 633604815435763712, Gaia DR3 6425579316029502080, Gaia DR3 667330101236907776, Gaia DR3 6833816717724281472, Gaia DR3 6909894018898836608, Landolt 107-998, Landolt 98-978)
- Largest correction |C - 1|: 9.3%
- Slope uncertainty of the correction (star-to-star colour scatter): SWIR 0.23 %/um, MWIR 0.14 %/um
- Reduced chi^2 of the star fit: 1.57
- Correction file: data/calibration/solar_analog_correction.csv
  - ⚠ 1 points outside the wavelength range covered by the solar-analog calibration were left uncorrected.

## Observation-Time Structure

- Visits: 22 (59 exposures, 11.68 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 39 bins / 81 points
- Brightness variability between visits: detected (p = 5.0e-44, visit-offset rms 0.11 mag)
- Rotational lightcurve correction: applied - supported by repeats
- Correction applied: periodic_lightcurve; Normalisation groups: 1

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | +3.09 | 0 |
| B2-B3 | +2.99 | 0 |
| B3-B4 | -3.87 | 0 |
| B4-B5 | +1.53 | 0 |
| B5-B6 | +2.34 | 0 |

  - ⚠ Spectrum assembled from 22 visits over 11.68 d (phase angle 19.4-19.6 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness varies between visits: constant-brightness model rejected on 39 repeat bins (p = 5.0e-44); visit-offset rms 0.11 mag.
  - ⚠ Rotational lightcurve (P = 16.222 h) fitted to repeated observations only (peak-to-peak 0.35 mag, Delta-BIC 246); all points normalised to the rotation-averaged brightness.

## Reflected / Thermal Separation

- Status: INSUFFICIENT_THERMAL
- Beaming parameter eta: N/A (fixed)
- Sub-solar temperature T_ss (K): N/A
- Reduced chi^2: N/A
- Thermal excess S/N: -0.1
- Internal 2-um reflectance parameter (not pV): N/A
  - ⚠ Thermal excess S/N = -0.1 < 3.0: no diameter is derived. Reflectance beyond ~3 um may include unmodelled thermal emission.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | Sa | S-complex | 89.8% | 0.84 |
| 2 | A | A-type | 10.2% | 0.94 |
| 3 | Q | Q-type | <0.1% | 2.50 |
| 4 | Sq | S-complex | <0.1% | 3.17 |
| 5 | S | S-complex | <0.1% | 3.45 |
| 6 | O | O-type | <0.1% | 3.62 |
| 7 | Sr | S-complex | <0.1% | 4.81 |
| 8 | K | K-type | <0.1% | 4.17 |
| 9 | D | D-type | <0.1% | 5.47 |
| 10 | R | R-type | <0.1% | 5.56 |
| 11 | B | C-complex | <0.1% | 3.90 |
| 12 | Cg | C-complex | <0.1% | 5.47 |
| 13 | X | X-complex | <0.1% | 5.40 |
| 14 | Xn | X-complex | <0.1% | 4.60 |
| 15 | Cgh | C-complex | <0.1% | 5.09 |
| 16 | Xe | X-complex | <0.1% | 5.09 |
| 17 | V | V-type | <0.1% | 7.33 |
| 18 | L | L-type | <0.1% | 6.31 |
| 19 | Xk | X-complex | <0.1% | 7.48 |
| 20 | Cb | C-complex | <0.1% | 7.36 |
| 21 | C | C-complex | <0.1% | 8.46 |
| 22 | Ch | C-complex | <0.1% | 8.59 |
| 23 | T | T-type | <0.1% | 9.53 |
| 24 | Xc | X-complex | <0.1% | 9.45 |
| 25 | Sv | S-complex | <0.1% | 11.21 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | S-complex | 89.8% |
| 2 | A-type | 10.2% |
| 3 | Q-type | <0.1% |
| 4 | O-type | <0.1% |
| 5 | K-type | <0.1% |
| 6 | D-type | <0.1% |
| 7 | R-type | <0.1% |
| 8 | C-complex | <0.1% |
| 9 | X-complex | <0.1% |
| 10 | V-type | <0.1% |
| 11 | L-type | <0.1% |
| 12 | T-type | <0.1% |

- Most probable: **Sa (ambiguous within S/Sq/Sr/Sa/Sv; group probability 90%)** — Confidence: Medium
  - best complex S-complex vs runner-up A-type: delta deviance 4.3 (scaled)
- S-complex vs D-type: distinguished (D minus S deviance +97.3; favours S-complex)
- Spectral slope used: yes (systematic 0.024 /um)
- Relative probabilities among the 25 Bus-DeMeo reference classes, computed from chi-square with errors scaled by the best-fit reduced chi-square. They do not give the probability that a mineral is present.
- No visible-wavelength data (<0.75 um): classes separated mainly by visible slope cannot be distinguished.
- Reference class means end at 2.45 um; features beyond are analysed separately (band analysis).
- Spectra normalised at 1.2 um (DeMeo et al. 2009 near-infrared convention) instead of 0.55 um.
- Probabilities are relative among the Bus-DeMeo reference classes for this model; they are not probabilities that specific minerals are present.
- Errors: photometric noise plus visit-correlated normalisation error (full covariance).
- Classes without published intra-class sigma (Cg, O, R) use the median shape sigma of all classes and the upper slope tolerance.

## Mineral Candidates and Absorption Features

| Feature | Status | Centre (um) | Depth | Min. detectable depth (3 sigma) | Evidence / reason |
|---|---|---|---|---|---|
| Band I | DETECTED | 1.082 ± 0.020 | 0.311 ± 0.033 | 0.024 | full_band |
| Band II | NOT_DETECTED | 2.058 ± 0.000 | 0.052 ± 0.039 | 0.118 | not detected; data not sensitive enough to detect a typical band |
| 3-um region | NOT_EVALUABLE | N/A | N/A | N/A | thermal emission was not removed |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Olivine | Band I centre 1.082 um, BAR None | Medium |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 8.620 (uncertainty not provided)
- G: N/A
- Source: JPL SBDB E2026E71
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.
  - ⚠ SBDB gives no G; G=0.15 convention implied by the catalogue H.

## Diameter

- Status: INSUFFICIENT_THERMAL
- Diameter (km): N/A
- Conditional range (no H): N/A
- Catalogue diameter (km): 50.89 ± 0.439 (urn:nasa:pds:neowise_diameters_albedos::2.0[mainbelt] (http://adsabs.harvard.edu/abs/2014ApJ...791..121M))
- Difference: N/A km (N/A sigma)
- Confidence: None

## Geometric Albedo

- Status: Not estimable from available data
- Geometric albedo pV (V band): N/A
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 8.620 (uncertainty not provided) — JPL SBDB
- D: N/A km — N/A
- Correlation: N/A
- Missing inputs: diameter (INSUFFICIENT_THERMAL)

## Mass and Density

- Mass (kg): N/A —  
- Status: Unknown (Mass unknown)
- Bulk density (kg/m^3): N/A
- Shape assumption: N/A — 

## Missing Data

- diameter
- geometric albedo
- mass

## Data Sources and Provenance

```json
[
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"246\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:51:07+00:00",
  "version": "orbit_id=92; soln_date=2026-06-05 03:20:47",
  "identifier": "20000246",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"246\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:51:07+00:00",
  "version": "orbit_id=92; soln_date=2026-06-05 03:20:47",
  "identifier": "20000246",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2025-04-12\", \"obs_end\": \"2026-10-15\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000246\"}",
  "retrieved_utc": "2026-11-14T08:51:07+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000246;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=282",
  "retrieved_utc": "2026-11-14T08:51:13+00:00",
  "version": "{\"version\": \"1.2\", \"source\": \"NASA/JPL Horizons API\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
