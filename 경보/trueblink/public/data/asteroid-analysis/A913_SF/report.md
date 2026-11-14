# Analysis Report: A913 SF

Generated 2026-11-14T03:19:59+00:00 - model version 0.1.0

## Identification

- Designation: 764 Gedania (A913 SF)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 315
- Spectral points: 60
- Quality flags: {'WARN': 53, 'GOOD': 6, 'BAD': 1}

## Observation-Time Structure

- Visits: 11 (30 exposures, 11.28 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 6 bins / 15 points
- Brightness variability between visits: not detected (p = 0.18)
- Rotational lightcurve correction: not applied - no significant variability between visits
- Correction applied: none; Normalisation groups: 1

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | +5.30 | 0 |
| B2-B3 | -6.86 | 0 |
| B3-B4 | +1.56 | 0 |
| B4-B5 | +5.30 | 0 |
| B5-B6 | -6.86 | 0 |

  - ⚠ Spectrum assembled from 11 visits over 11.28 d (phase angle 14.6-16.0 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness consistent between visits on 6 repeat bins (p = 0.18): no variability correction applied.

## Reflected / Thermal Separation

- Status: INSUFFICIENT_THERMAL
- Beaming parameter eta: N/A (fixed)
- Sub-solar temperature T_ss (K): N/A
- Reduced chi^2: N/A
- Thermal excess S/N: 2.0
- Internal 2-um reflectance parameter (not pV): N/A
  - ⚠ Thermal excess S/N = 2.0 < 3.0: no diameter is derived. Reflectance beyond ~3 um may include unmodelled thermal emission.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | Cgh | C-complex | 6.7% | 7.23 |
| 2 | Sq | S-complex | 6.3% | 7.29 |
| 3 | Xe | X-complex | 6.3% | 7.26 |
| 4 | K | K-type | 6.0% | 7.30 |
| 5 | Xk | X-complex | 5.5% | 7.41 |
| 6 | S | S-complex | 5.5% | 7.43 |
| 7 | X | X-complex | 5.4% | 7.36 |
| 8 | L | L-type | 5.3% | 7.38 |
| 9 | Cg | C-complex | 5.3% | 7.45 |
| 10 | Xn | X-complex | 5.2% | 7.39 |
| 11 | Q | Q-type | 5.2% | 7.47 |
| 12 | Ch | C-complex | 5.1% | 7.45 |
| 13 | Xc | X-complex | 4.9% | 7.48 |
| 14 | Cb | C-complex | 4.6% | 7.58 |
| 15 | T | T-type | 3.8% | 7.59 |
| 16 | D | D-type | 3.7% | 7.54 |
| 17 | C | C-complex | 3.2% | 7.88 |
| 18 | Sr | S-complex | 3.1% | 7.90 |
| 19 | Sa | S-complex | 2.6% | 7.62 |
| 20 | B | C-complex | 2.6% | 7.77 |
| 21 | R | R-type | 1.2% | 8.62 |
| 22 | A | A-type | 1.2% | 8.09 |
| 23 | Sv | S-complex | 0.7% | 9.13 |
| 24 | O | O-type | 0.5% | 9.41 |
| 25 | V | V-type | <0.1% | 11.34 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | X-complex | 27.4% |
| 2 | C-complex | 27.3% |
| 3 | S-complex | 18.3% |
| 4 | K-type | 6.0% |
| 5 | L-type | 5.3% |
| 6 | Q-type | 5.2% |
| 7 | T-type | 3.8% |
| 8 | D-type | 3.7% |
| 9 | R-type | 1.2% |
| 10 | A-type | 1.2% |
| 11 | O-type | 0.5% |
| 12 | V-type | <0.1% |

- Most probable: **Cgh (ambiguous within C/Cb/Cg/Cgh/Ch/B; group probability 27%)** — Confidence: Low
  - best complex C-complex vs runner-up S-complex: delta deviance 0.1 (scaled)
  - 1-um band region (<1.1 um) not covered
- S-complex vs D-type: not distinguished (D minus S deviance +1.1; favours S-complex)
- Spectral slope used: yes
- Relative probabilities among the 25 Bus-DeMeo reference classes, computed from chi-square with errors scaled by the best-fit reduced chi-square. They do not give the probability that a mineral is present.
- No visible-wavelength data (<0.75 um): classes separated mainly by visible slope cannot be distinguished.
- Reference class means end at 2.45 um; features beyond are analysed separately (band analysis).
- Spectra normalised at 1.2 um (DeMeo et al. 2009 near-infrared convention) instead of 0.55 um.
- Probabilities are relative among the Bus-DeMeo reference classes for this model; they are not probabilities that specific minerals are present.
- Errors: photometric noise plus visit-correlated normalisation error (full covariance).
- Classes without published intra-class sigma (Cg, O, R) use the median shape sigma of all classes and the upper slope tolerance.
- Best-fit chi2_red = 7.2: probabilities were computed with errors inflated by sqrt(7.2) to account for unexplained scatter.

## Mineral Candidates and Absorption Features

| Feature | Status | Centre (um) | Depth | Min. detectable depth (3 sigma) | Evidence / reason |
|---|---|---|---|---|---|
| Band I | NOT_DETECTED | 1.228 ± 0.000 | 0.136 ± 0.069 | 0.206 | not detected; data not sensitive enough to detect a typical band |
| Band II | NOT_DETECTED | 2.058 ± 0.000 | 0.119 ± 0.053 | 0.160 | not detected; data not sensitive enough to detect a typical band |
| 3-um region | NOT_EVALUABLE | N/A | N/A | N/A | thermal emission was not removed |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Unknown | Featureless spectrum; albedo needed to discriminate carbonaceous vs metal-rich vs other | None |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 9.670 (uncertainty not provided)
- G: N/A
- Source: JPL SBDB MPO964278
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.
  - ⚠ SBDB gives no G; G=0.15 convention implied by the catalogue H.

## Diameter

- Status: INSUFFICIENT_THERMAL
- Diameter (km): N/A
- Conditional range (no H): N/A
- Catalogue diameter (km): 58.28 ± 1.4 (IRAS-A-FPA-3-RDR-IMPS-V6.0)
- Difference: N/A km (N/A sigma)
- Confidence: None

## Geometric Albedo

- Status: Not estimable from available data
- Geometric albedo pV (V band): N/A
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 9.670 (uncertainty not provided) — JPL SBDB
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
  "query": "{\"sstr\": \"A913 SF\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T03:18:12+00:00",
  "version": "orbit_id=74; soln_date=2026-06-05 04:01:50",
  "identifier": "20000764",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"A913 SF\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T03:18:12+00:00",
  "version": "orbit_id=74; soln_date=2026-06-05 04:01:50",
  "identifier": "20000764",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2025-05-01\", \"obs_end\": \"2026-11-14\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000764\"}",
  "retrieved_utc": "2026-11-14T03:18:12+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000764;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=315",
  "retrieved_utc": "2026-11-14T03:18:20+00:00",
  "version": "{\"source\": \"NASA/JPL Horizons API\", \"version\": \"1.2\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
