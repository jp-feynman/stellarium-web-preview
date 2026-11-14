# Analysis Report: 624

Generated 2026-11-14T08:52:29+00:00 - model version 0.1.0

## Identification

- Designation: 624 Hektor (A907 CF)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 273
- Spectral points: 120
- Quality flags: {'WARN': 67, 'GOOD': 51, 'BAD': 2}

## Relative Spectral Calibration (solar analogs)

- Status: applied - fluxes divided by the SPHEREx response measured on solar-analog stars
- Solar-analog stars: 14 (Gaia DR3 1021495028608838016, Gaia DR3 1325938803224554752, Gaia DR3 1565876532739593600, Gaia DR3 2972362529862291200, Gaia DR3 4662850696812855168, Gaia DR3 4769435292423335168, Gaia DR3 5050053165460308224, Gaia DR3 633604815435763712, Gaia DR3 6425579316029502080, Gaia DR3 667330101236907776, Gaia DR3 6833816717724281472, Gaia DR3 6909894018898836608, Landolt 107-998, Landolt 98-978)
- Largest correction |C - 1|: 9.2%
- Slope uncertainty of the correction (star-to-star colour scatter): SWIR 0.23 %/um, MWIR 0.14 %/um
- Reduced chi^2 of the star fit: 1.57
- Correction file: data/calibration/solar_analog_correction.csv

## Observation-Time Structure

- Visits: 21 (61 exposures, 247.28 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 36 bins / 83 points
- Brightness variability between visits: detected (p = 2.6e-04, visit-offset rms 0.06 mag)
- Rotational lightcurve correction: not applied - periodic model explains 67% of the visit-to-visit variation (< 70%)
- Correction applied: visit_offsets; Normalisation groups: 9

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | +2.92 | 0 |
| B2-B3 | +3.18 | 0 |
| B3-B4 | -6.10 | 0 |
| B4-B5 | +3.80 | 0 |
| B5-B6 | +2.31 | 0 |

  - ⚠ Spectrum assembled from 21 visits over 247.28 d (phase angle 10.6-11.3 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness varies between visits: constant-brightness model rejected on 36 repeat bins (p = 2.6e-04); visit-offset rms 0.06 mag.
  - ⚠ Periodic lightcurve correction NOT applied: periodic model explains 67% of the visit-to-visit variation (< 70%).
  - ⚠ 9 normalisation groups could not be linked: their relative brightness (and the spectral slope across them) is not constrained by the data.

## Reflected / Thermal Separation

- Status: INSUFFICIENT_THERMAL
- Beaming parameter eta: N/A (fixed)
- Sub-solar temperature T_ss (K): N/A
- Reduced chi^2: N/A
- Thermal excess S/N: 0.2
- Internal 2-um reflectance parameter (not pV): N/A
  - ⚠ Thermal excess S/N = 0.2 < 3.0: no diameter is derived. Reflectance beyond ~3 um may include unmodelled thermal emission.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | D | D-type | 53.2% | 0.12 |
| 2 | S | S-complex | 29.6% | 0.19 |
| 3 | Sr | S-complex | 8.2% | 0.33 |
| 4 | Sq | S-complex | 4.6% | 0.39 |
| 5 | Q | Q-type | 1.5% | 0.52 |
| 6 | Cg | C-complex | 1.5% | 0.21 |
| 7 | Sv | S-complex | 0.6% | 0.63 |
| 8 | X | X-complex | 0.4% | 0.41 |
| 9 | Sa | S-complex | 0.2% | 0.64 |
| 10 | V | V-type | <0.1% | 0.82 |
| 11 | R | R-type | <0.1% | 0.83 |
| 12 | Xk | X-complex | <0.1% | 0.36 |
| 13 | T | T-type | <0.1% | 0.56 |
| 14 | C | C-complex | <0.1% | 0.47 |
| 15 | Cb | C-complex | <0.1% | 0.50 |
| 16 | Xc | X-complex | <0.1% | 0.48 |
| 17 | L | L-type | <0.1% | 0.45 |
| 18 | A | A-type | <0.1% | 1.71 |
| 19 | Cgh | C-complex | <0.1% | 1.14 |
| 20 | O | O-type | <0.1% | 1.69 |
| 21 | Xe | X-complex | <0.1% | 1.35 |
| 22 | K | K-type | <0.1% | 0.99 |
| 23 | Xn | X-complex | <0.1% | 1.49 |
| 24 | Ch | C-complex | <0.1% | 0.93 |
| 25 | B | C-complex | <0.1% | 1.99 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | D-type | 53.2% |
| 2 | S-complex | 43.2% |
| 3 | Q-type | 1.5% |
| 4 | C-complex | 1.5% |
| 5 | X-complex | 0.4% |
| 6 | V-type | <0.1% |
| 7 | R-type | <0.1% |
| 8 | T-type | <0.1% |
| 9 | L-type | <0.1% |
| 10 | A-type | <0.1% |
| 11 | O-type | <0.1% |
| 12 | K-type | <0.1% |

- Most probable: **D** — Confidence: Low
  - best complex D-type vs runner-up S-complex: delta deviance 1.2 (scaled)
  - insufficient to distinguish S-complex from D-type (delta -1.2 < 4)
  - most probable complex changes when single visits are left out (4 of 21 samples: S-complex)
- S-complex vs D-type: not distinguished (D minus S deviance -1.2; favours D-type)
- Spectral slope used: yes (systematic 0.002 /um)
- Relative probabilities among the 25 Bus-DeMeo reference classes, computed from chi-square with errors scaled by the best-fit reduced chi-square. They do not give the probability that a mineral is present.
- No visible-wavelength data (<0.75 um): classes separated mainly by visible slope cannot be distinguished.
- Reference class means end at 2.45 um; features beyond are analysed separately (band analysis).
- Spectra normalised at 1.2 um (DeMeo et al. 2009 near-infrared convention) instead of 0.55 um.
- Probabilities are relative among the Bus-DeMeo reference classes for this model; they are not probabilities that specific minerals are present.
- Errors: photometric noise plus visit-correlated normalisation error (full covariance).
- 9 normalisation groups fitted with independent brightness scales: only the spectral shape within each group is used.
- Classes without published intra-class sigma (Cg, O, R) use the median shape sigma of all classes and the upper slope tolerance.
- The classification is not stable against leaving out single visits: 4 of 21 leave-one-visit-out samples give S-complex instead of D-type.

## Mineral Candidates and Absorption Features

| Feature | Status | Centre (um) | Depth | Min. detectable depth (3 sigma) | Evidence / reason |
|---|---|---|---|---|---|
| Band I | NOT_EVALUABLE | N/A | N/A | N/A | band shoulders and centre not observed within one normalisation group |
| Band II | NOT_EVALUABLE | N/A | N/A | N/A | band shoulders and centre not observed within one normalisation group |
| 3-um region | NOT_EVALUABLE | N/A | N/A | N/A | thermal emission was not removed |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Unknown | Featureless spectrum; albedo needed to discriminate carbonaceous vs metal-rich vs other | None |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 7.320 (uncertainty not provided)
- G: N/A
- Source: JPL SBDB E2026E71
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.
  - ⚠ SBDB gives no G; G=0.15 convention implied by the catalogue H.

## Diameter

- Status: INSUFFICIENT_THERMAL
- Diameter (km): N/A
- Conditional range (no H): N/A
- Catalogue diameter (km): 225 (uncertainty not provided) (J.G. Williams 9-90)
- Difference: N/A km (N/A sigma)
- Confidence: None

## Geometric Albedo

- Status: Not estimable from available data
- Geometric albedo pV (V band): N/A
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 7.320 (uncertainty not provided) — JPL SBDB
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
  "query": "{\"sstr\": \"624\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:52:05+00:00",
  "version": "orbit_id=139; soln_date=2026-06-05 03:50:35",
  "identifier": "20000624",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"624\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:52:05+00:00",
  "version": "orbit_id=139; soln_date=2026-06-05 03:50:35",
  "identifier": "20000624",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2025-04-12\", \"obs_end\": \"2026-10-15\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000624\"}",
  "retrieved_utc": "2026-11-14T08:52:05+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000624;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=273",
  "retrieved_utc": "2026-11-14T08:52:12+00:00",
  "version": "{\"source\": \"NASA/JPL Horizons API\", \"version\": \"1.2\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
