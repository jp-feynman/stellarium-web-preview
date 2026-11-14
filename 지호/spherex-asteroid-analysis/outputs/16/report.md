# Analysis Report: 16

Generated 2026-11-14T08:50:37+00:00 - model version 0.1.0

## Identification

- Designation: 16 Psyche (A852 FA)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 295
- Spectral points: 120
- Quality flags: {'WARN': 110, 'GOOD': 6, 'BAD': 4}

## Relative Spectral Calibration (solar analogs)

- Status: applied - fluxes divided by the SPHEREx response measured on solar-analog stars
- Solar-analog stars: 14 (Gaia DR3 1021495028608838016, Gaia DR3 1325938803224554752, Gaia DR3 1565876532739593600, Gaia DR3 2972362529862291200, Gaia DR3 4662850696812855168, Gaia DR3 4769435292423335168, Gaia DR3 5050053165460308224, Gaia DR3 633604815435763712, Gaia DR3 6425579316029502080, Gaia DR3 667330101236907776, Gaia DR3 6833816717724281472, Gaia DR3 6909894018898836608, Landolt 107-998, Landolt 98-978)
- Largest correction |C - 1|: 11.8%
- Slope uncertainty of the correction (star-to-star colour scatter): SWIR 0.23 %/um, MWIR 0.14 %/um
- Reduced chi^2 of the star fit: 1.57
- Correction file: data/calibration/solar_analog_correction.csv
  - ⚠ 2 points outside the wavelength range covered by the solar-analog calibration were left uncorrected.

## Observation-Time Structure

- Visits: 21 (60 exposures, 12.36 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 16 bins / 34 points
- Brightness variability between visits: not detected (p = 0.019)
- Rotational lightcurve correction: not applied - no significant variability between visits
- Correction applied: none; Normalisation groups: 1

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | +6.18 | 0 |
| B2-B3 | +3.54 | 0 |
| B3-B4 | -9.71 | 0 |
| B4-B5 | +6.18 | 0 |
| B5-B6 | +3.53 | 0 |

  - ⚠ Spectrum assembled from 21 visits over 12.36 d (phase angle 22.8-23.0 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness consistent between visits on 16 repeat bins (p = 0.019): no correction applied. Visit-to-visit uncertainty kept in the error covariance: 0.069 mag for visits tested by repeats, 0.10 mag (untested prior) for 5 visits not linked by any repeat.

## Reflected / Thermal Separation

- Status: OK
- Beaming parameter eta: 0.9648 ± 0.1579 (fitted)
- Sub-solar temperature T_ss (K): 251.2 ± 10.3
- Reduced chi^2: 0.18
- Thermal excess S/N: 4.1
- Internal 2-um reflectance parameter (not pV): 0.2123
  - ⚠ eta fitted with literature prior eta = 0.87 + 0.01 * alpha[deg] at alpha=23.0 deg -> eta0=1.10 (-0.3/+0.55); Trilling et al. (2016).
  - ⚠ A = q pV with pV from H and D: thermal and optical constraints fitted jointly.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | X | X-complex | 26.0% | 0.42 |
| 2 | Xk | X-complex | 11.2% | 0.47 |
| 3 | T | T-type | 10.5% | 0.48 |
| 4 | Cg | C-complex | 8.8% | 0.47 |
| 5 | Cgh | C-complex | 7.6% | 0.44 |
| 6 | Cb | C-complex | 6.7% | 0.50 |
| 7 | D | D-type | 5.9% | 0.46 |
| 8 | Xe | X-complex | 5.2% | 0.44 |
| 9 | Xc | X-complex | 2.9% | 0.50 |
| 10 | C | C-complex | 2.9% | 0.54 |
| 11 | Xn | X-complex | 2.8% | 0.44 |
| 12 | S | S-complex | 2.4% | 0.57 |
| 13 | L | L-type | 2.4% | 0.48 |
| 14 | K | K-type | 2.3% | 0.52 |
| 15 | Ch | C-complex | 1.9% | 0.51 |
| 16 | Sr | S-complex | 0.2% | 0.74 |
| 17 | Sq | S-complex | 0.1% | 0.76 |
| 18 | Sv | S-complex | <0.1% | 0.91 |
| 19 | Q | Q-type | <0.1% | 0.92 |
| 20 | B | C-complex | <0.1% | 0.61 |
| 21 | Sa | S-complex | <0.1% | 1.11 |
| 22 | R | R-type | <0.1% | 1.29 |
| 23 | V | V-type | <0.1% | 2.13 |
| 24 | O | O-type | <0.1% | 2.39 |
| 25 | A | A-type | <0.1% | 2.44 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | X-complex | 48.2% |
| 2 | C-complex | 28.0% |
| 3 | T-type | 10.5% |
| 4 | D-type | 5.9% |
| 5 | S-complex | 2.8% |
| 6 | L-type | 2.4% |
| 7 | K-type | 2.3% |
| 8 | Q-type | <0.1% |
| 9 | R-type | <0.1% |
| 10 | V-type | <0.1% |
| 11 | O-type | <0.1% |
| 12 | A-type | <0.1% |

- Most probable: **X (ambiguous within X/Xc/Xe/Xk/Xn; group probability 48%)** — Confidence: Low
  - best complex X-complex vs runner-up T-type: delta deviance 1.8 (scaled)
  - most probable complex changes when single visits are left out (1 of 18 samples: C-complex)
  - most probable complex changes (X-complex -> Insufficient Data) without the 63 saturated (wing-only) points
- S-complex vs D-type: not distinguished (D minus S deviance -1.8; favours D-type)
- Spectral slope used: yes (systematic 0.038 /um)
- Relative probabilities among the 25 Bus-DeMeo reference classes, computed from chi-square with errors scaled by the best-fit reduced chi-square. They do not give the probability that a mineral is present.
- No visible-wavelength data (<0.75 um): classes separated mainly by visible slope cannot be distinguished.
- Reference class means end at 2.45 um; features beyond are analysed separately (band analysis).
- Spectra normalised at 1.2 um (DeMeo et al. 2009 near-infrared convention) instead of 0.55 um.
- Probabilities are relative among the Bus-DeMeo reference classes for this model; they are not probabilities that specific minerals are present.
- Errors: photometric noise plus visit-correlated normalisation error (full covariance).
- Classes without published intra-class sigma (Cg, O, R) use the median shape sigma of all classes and the upper slope tolerance.
- The classification is not stable against leaving out single visits: 1 of 18 leave-one-visit-out samples give C-complex instead of X-complex.
- The classification depends on 63 points with a saturated PSF core: without them the most probable complex is Insufficient Data.

## Mineral Candidates and Absorption Features

| Feature | Status | Centre (um) | Depth | Min. detectable depth (3 sigma) | Evidence / reason |
|---|---|---|---|---|---|
| Band I | NOT_DETECTED | 1.133 ± 0.229 | 0.222 ± 0.100 | 0.026 | not detected; a typical band-bearing asteroid would be detectable here |
| Band II | NOT_DETECTED | 1.837 ± 0.321 | 0.224 ± 0.105 | 0.111 | not detected; data not sensitive enough to detect a typical band |
| OH / phyllosilicate (2.7-2.9 um) | NOT_DETECTED | 2.800 ± 0.150 | 0.078 ± 0.058 | 0.174 | Not significant; upper limit on depth = depth + 3 sigma. |
| H2O ice / NH4 (3.0-3.2 um) | NOT_DETECTED | 3.100 ± 0.150 | 0.055 ± 0.049 | 0.148 | Not significant; upper limit on depth = depth + 3 sigma. |
| C-H organics (3.35-3.55 um) | NOT_DETECTED | 3.450 ± 0.100 | 0.056 ± 0.048 | 0.145 | Not significant; upper limit on depth = depth + 3 sigma. |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Carbonaceous materials | Featureless spectrum with pV = 0.094 < 0.1 | Medium |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 6.200 (uncertainty not provided)
- G: 0.2
- Source: JPL SBDB E2024-XU9
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.

## Diameter

- Status: OK
- Diameter (km): 249.9 ± 56.73
- Conditional range (no H): N/A
- Catalogue diameter (km): 222 (uncertainty not provided) (Shepard et al. (2021), The Planetary Science Journal 2, 125)
- Difference: 27.93 km (0.5 sigma)
- Confidence: Medium

## Geometric Albedo

- Status: ESTIMATED
- Geometric albedo pV (V band): 0.094 ± 0.043
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 6.200 (uncertainty not provided) — JPL SBDB E2024-XU9
- D: 249.9 ± 56.73 km — SPHEREx NEATM fit (eta fitted)
- Correlation: H propagated jointly through the thermal fit (dD/dH from refitting); D fit error treated as independent of H.
  - ⚠ Uncertainty is a lower bound: an input uncertainty was not provided by its source.

## Mass and Density

- Mass (kg): 2.399e+19 ± 2.547e+17 — D: database GM (JPL SBDB) Farnocchia et al. (2024), AJ 168, 21
- Status: ESTIMATED
- Bulk density (kg/m^3): 2934 ± 1998
- Shape assumption: spherical_assumption — V = 4/3 pi (D/2)^3

## Missing Data

- none

## Data Sources and Provenance

```json
[
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"16\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:50:12+00:00",
  "version": "orbit_id=92; soln_date=2025-02-06 14:15:44",
  "identifier": "20000016",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"16\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:50:12+00:00",
  "version": "orbit_id=92; soln_date=2025-02-06 14:15:44",
  "identifier": "20000016",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2025-04-12\", \"obs_end\": \"2026-10-15\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000016\"}",
  "retrieved_utc": "2026-11-14T08:50:12+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000016;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=295",
  "retrieved_utc": "2026-11-14T08:50:18+00:00",
  "version": "{\"version\": \"1.2\", \"source\": \"NASA/JPL Horizons API\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
