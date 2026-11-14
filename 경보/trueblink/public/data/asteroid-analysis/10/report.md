# Analysis Report: 10

Generated 2026-11-14T08:49:46+00:00 - model version 0.1.0

## Identification

- Designation: 10 Hygiea (A849 GA)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 263
- Spectral points: 120
- Quality flags: {'WARN': 115, 'BAD': 4, 'GOOD': 1}

## Relative Spectral Calibration (solar analogs)

- Status: applied - fluxes divided by the SPHEREx response measured on solar-analog stars
- Solar-analog stars: 14 (Gaia DR3 1021495028608838016, Gaia DR3 1325938803224554752, Gaia DR3 1565876532739593600, Gaia DR3 2972362529862291200, Gaia DR3 4662850696812855168, Gaia DR3 4769435292423335168, Gaia DR3 5050053165460308224, Gaia DR3 633604815435763712, Gaia DR3 6425579316029502080, Gaia DR3 667330101236907776, Gaia DR3 6833816717724281472, Gaia DR3 6909894018898836608, Landolt 107-998, Landolt 98-978)
- Largest correction |C - 1|: 11.6%
- Slope uncertainty of the correction (star-to-star colour scatter): SWIR 0.23 %/um, MWIR 0.14 %/um
- Reduced chi^2 of the star fit: 1.57
- Correction file: data/calibration/solar_analog_correction.csv
  - ⚠ 1 points outside the wavelength range covered by the solar-analog calibration were left uncorrected.

## Observation-Time Structure

- Visits: 21 (58 exposures, 11.08 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 22 bins / 54 points
- Brightness variability between visits: not detected (p = 0.84)
- Rotational lightcurve correction: not applied - no significant variability between visits
- Correction applied: none; Normalisation groups: 1

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | +4.62 | 0 |
| B2-B3 | +3.26 | 0 |
| B3-B4 | -7.88 | 0 |
| B4-B5 | +4.62 | 0 |
| B5-B6 | +3.26 | 0 |

  - ⚠ Spectrum assembled from 21 visits over 11.08 d (phase angle 16.8-16.9 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness consistent between visits on 22 repeat bins (p = 0.84): no correction applied. Visit-to-visit uncertainty kept in the error covariance: 0.039 mag for visits tested by repeats, 0.10 mag (untested prior) for 6 visits not linked by any repeat.

## Reflected / Thermal Separation

- Status: INSUFFICIENT_THERMAL
- Beaming parameter eta: N/A (fixed)
- Sub-solar temperature T_ss (K): N/A
- Reduced chi^2: N/A
- Thermal excess S/N: 2.9
- Internal 2-um reflectance parameter (not pV): N/A
  - ⚠ Thermal excess S/N = 2.9 < 3.0: no diameter is derived. Reflectance beyond ~3 um may include unmodelled thermal emission.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | Xn | X-complex | 68.5% | 0.47 |
| 2 | B | C-complex | 14.0% | 0.40 |
| 3 | Xe | X-complex | 12.6% | 0.60 |
| 4 | Cgh | C-complex | 1.8% | 0.74 |
| 5 | Cg | C-complex | 1.4% | 0.76 |
| 6 | X | X-complex | 0.6% | 0.72 |
| 7 | Cb | C-complex | 0.4% | 0.82 |
| 8 | Xk | X-complex | 0.2% | 0.89 |
| 9 | Xc | X-complex | 0.2% | 0.92 |
| 10 | Ch | C-complex | 0.1% | 0.93 |
| 11 | C | C-complex | <0.1% | 0.95 |
| 12 | K | K-type | <0.1% | 0.98 |
| 13 | L | L-type | <0.1% | 1.03 |
| 14 | T | T-type | <0.1% | 1.02 |
| 15 | D | D-type | <0.1% | 1.17 |
| 16 | S | S-complex | <0.1% | 1.41 |
| 17 | Q | Q-type | <0.1% | 1.96 |
| 18 | Sq | S-complex | <0.1% | 1.99 |
| 19 | Sr | S-complex | <0.1% | 2.08 |
| 20 | Sv | S-complex | <0.1% | 2.98 |
| 21 | Sa | S-complex | <0.1% | 2.68 |
| 22 | R | R-type | <0.1% | 3.57 |
| 23 | V | V-type | <0.1% | 4.83 |
| 24 | O | O-type | <0.1% | 5.93 |
| 25 | A | A-type | <0.1% | 7.15 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | X-complex | 82.1% |
| 2 | C-complex | 17.8% |
| 3 | K-type | <0.1% |
| 4 | L-type | <0.1% |
| 5 | T-type | <0.1% |
| 6 | D-type | <0.1% |
| 7 | S-complex | <0.1% |
| 8 | Q-type | <0.1% |
| 9 | R-type | <0.1% |
| 10 | V-type | <0.1% |
| 11 | O-type | <0.1% |
| 12 | A-type | <0.1% |

- Most probable: **Xn (ambiguous within X/Xc/Xe/Xk/Xn; group probability 82%)** — Confidence: Low
  - best complex X-complex vs runner-up C-complex: delta deviance 3.2 (scaled)
- S-complex vs D-type: not distinguished (D minus S deviance -3.1; favours D-type)
- Spectral slope used: yes (systematic 0.036 /um)
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
| Band I | NOT_DETECTED | 0.863 ± 0.149 | 0.165 ± 0.039 | 0.118 | not detected; a typical band-bearing asteroid would be detectable here |
| Band II | NOT_DETECTED | 1.733 ± 0.000 | 0.114 ± 0.042 | 0.024 | not detected; a typical band-bearing asteroid would be detectable here |
| 3-um region | NOT_EVALUABLE | N/A | N/A | N/A | thermal emission was not removed |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Unknown | Featureless spectrum; albedo needed to discriminate carbonaceous vs metal-rich vs other | None |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 5.650 (uncertainty not provided)
- G: N/A
- Source: JPL SBDB E2026E39
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.
  - ⚠ SBDB gives no G; G=0.15 convention implied by the catalogue H.

## Diameter

- Status: INSUFFICIENT_THERMAL
- Diameter (km): N/A
- Conditional range (no H): N/A
- Catalogue diameter (km): 407.1 ± 6.8 (IRAS-A-FPA-3-RDR-IMPS-V6.0)
- Difference: N/A km (N/A sigma)
- Confidence: None

## Geometric Albedo

- Status: Not estimable from available data
- Geometric albedo pV (V band): N/A
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 5.650 (uncertainty not provided) — JPL SBDB
- D: N/A km — N/A
- Correlation: N/A
- Missing inputs: diameter (INSUFFICIENT_THERMAL)

## Mass and Density

- Mass (kg): 1.049e+20 (uncertainty not provided) — D: database GM (JPL SBDB) Scholl et al., A&A, v.179, p.311, 1987
- Status: ESTIMATED (mass uncertainty not provided)
- Bulk density (kg/m^3): 2968 ± 149
- Shape assumption: spherical_assumption — V = 4/3 pi (D/2)^3

## Missing Data

- diameter
- geometric albedo

## Data Sources and Provenance

```json
[
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"10\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:49:22+00:00",
  "version": "orbit_id=129; soln_date=2026-06-16 11:32:04",
  "identifier": "20000010",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"10\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:49:22+00:00",
  "version": "orbit_id=129; soln_date=2026-06-16 11:32:04",
  "identifier": "20000010",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2025-04-12\", \"obs_end\": \"2026-10-15\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000010\"}",
  "retrieved_utc": "2026-11-14T08:49:23+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000010;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=263",
  "retrieved_utc": "2026-11-14T08:49:30+00:00",
  "version": "{\"version\": \"1.2\", \"source\": \"NASA/JPL Horizons API\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
