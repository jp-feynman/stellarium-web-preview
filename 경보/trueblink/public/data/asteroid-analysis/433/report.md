# Analysis Report: 433

Generated 2026-11-14T08:48:31+00:00 - model version 0.1.0

## Identification

- Designation: 433 Eros (A898 PA)
- Status: Catalogued (JPL SBDB)

## SPHEREx Observations

- Exposures: 218
- Spectral points: 160
- Quality flags: {'WARN': 142, 'BAD': 10, 'GOOD': 8}

## Relative Spectral Calibration (solar analogs)

- Status: applied - fluxes divided by the SPHEREx response measured on solar-analog stars
- Solar-analog stars: 14 (Gaia DR3 1021495028608838016, Gaia DR3 1325938803224554752, Gaia DR3 1565876532739593600, Gaia DR3 2972362529862291200, Gaia DR3 4662850696812855168, Gaia DR3 4769435292423335168, Gaia DR3 5050053165460308224, Gaia DR3 633604815435763712, Gaia DR3 6425579316029502080, Gaia DR3 667330101236907776, Gaia DR3 6833816717724281472, Gaia DR3 6909894018898836608, Landolt 107-998, Landolt 98-978)
- Largest correction |C - 1|: 12.2%
- Slope uncertainty of the correction (star-to-star colour scatter): SWIR 0.23 %/um, MWIR 0.14 %/um
- Reduced chi^2 of the star fit: 1.57
- Correction file: data/calibration/solar_analog_correction.csv

## Observation-Time Structure

- Visits: 24 (75 exposures, 14.33 d)
- Detector families: B1+B4, B2+B5, B3+B6
- Repeated observations: 29 bins / 80 points
- Brightness variability between visits: detected (p = 0.0e+00, visit-offset rms 0.40 mag)
- Rotational lightcurve correction: applied - supported by repeats
- Correction applied: periodic_lightcurve; Normalisation groups: 1

| Adjacent segments | Median time difference (d) | Shared visits |
|---|---|---|
| B1-B2 | -1.63 | 0 |
| B2-B3 | -1.90 | 0 |
| B3-B4 | +3.53 | 0 |
| B4-B5 | -1.63 | 0 |
| B5-B6 | -3.02 | 0 |

  - ⚠ Spectrum assembled from 24 visits over 14.33 d (phase angle 58.9-60.3 deg).
  - ⚠ Adjacent spectral segments never observed together (B1-B2, B2-B3, B3-B4, B4-B5, B5-B6): their relative brightness depends on variability between visits.
  - ⚠ Brightness varies between visits: constant-brightness model rejected on 29 repeat bins (p = 0.0e+00); visit-offset rms 0.40 mag.
  - ⚠ Rotational lightcurve (P = 5.27 h) fitted to repeated observations only (peak-to-peak 1.53 mag, Delta-BIC 4534); all points normalised to the rotation-averaged brightness.

## Reflected / Thermal Separation

- Status: OK
- Beaming parameter eta: 1.183 ± 0.2029 (fitted)
- Sub-solar temperature T_ss (K): 339.6 ± 14.6
- Reduced chi^2: 0.87
- Thermal excess S/N: 15.4
- Internal 2-um reflectance parameter (not pV): 0.274
  - ⚠ eta fitted with literature prior eta = 0.87 + 0.01 * alpha[deg] at alpha=59.5 deg -> eta0=1.47 (-0.3/+0.55); Trilling et al. (2016).
  - ⚠ A = q pV with pV from H and D: thermal and optical constraints fitted jointly.

## Spectral Type Candidates

| Rank | Class | Complex | Relative probability | chi²_red |
|---|---|---|---|---|
| 1 | V | V-type | 94.1% | 0.99 |
| 2 | S | S-complex | 3.3% | 1.22 |
| 3 | Sr | S-complex | 1.8% | 1.27 |
| 4 | R | R-type | 0.7% | 1.33 |
| 5 | D | D-type | <0.1% | 1.53 |
| 6 | Sq | S-complex | <0.1% | 1.61 |
| 7 | Xn | X-complex | <0.1% | 1.54 |
| 8 | Q | Q-type | <0.1% | 1.75 |
| 9 | Sa | S-complex | <0.1% | 1.74 |
| 10 | Cgh | C-complex | <0.1% | 1.63 |
| 11 | O | O-type | <0.1% | 1.73 |
| 12 | X | X-complex | <0.1% | 1.75 |
| 13 | Sv | S-complex | <0.1% | 1.81 |
| 14 | Xe | X-complex | <0.1% | 1.69 |
| 15 | K | K-type | <0.1% | 1.87 |
| 16 | B | C-complex | <0.1% | 1.63 |
| 17 | L | L-type | <0.1% | 1.91 |
| 18 | Cg | C-complex | <0.1% | 2.05 |
| 19 | Xk | X-complex | <0.1% | 2.28 |
| 20 | A | A-type | <0.1% | 2.41 |
| 21 | Cb | C-complex | <0.1% | 2.54 |
| 22 | T | T-type | <0.1% | 2.67 |
| 23 | Ch | C-complex | <0.1% | 2.62 |
| 24 | Xc | X-complex | <0.1% | 2.99 |
| 25 | C | C-complex | <0.1% | 3.23 |

**Ranking by complex**

| Rank | Complex | Relative probability |
|---|---|---|
| 1 | V-type | 94.1% |
| 2 | S-complex | 5.1% |
| 3 | R-type | 0.7% |
| 4 | D-type | <0.1% |
| 5 | X-complex | <0.1% |
| 6 | Q-type | <0.1% |
| 7 | C-complex | <0.1% |
| 8 | O-type | <0.1% |
| 9 | K-type | <0.1% |
| 10 | L-type | <0.1% |
| 11 | A-type | <0.1% |
| 12 | T-type | <0.1% |

- Most probable: **V - high slope ('w', DeMeo et al. 2009)** — Confidence: Medium
  - best complex V-type vs runner-up S-complex: delta deviance 6.7 (scaled)
- S-complex vs D-type: distinguished (D minus S deviance +8.9; favours S-complex)
- Spectral slope used: yes (systematic 0.058 /um)
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
| Band I | DETECTED | 0.977 (uncertainty not provided) | 0.148 ± 0.042 | 0.126 | within_segment |
| Band II | NOT_DETECTED | 2.304 ± 0.297 | 0.432 ± 0.054 | 0.034 | not detected; a typical band-bearing asteroid would be detectable here |
| OH / phyllosilicate (2.7-2.9 um) | NOT_DETECTED | 2.800 ± 0.150 | -0.064 ± 0.100 | 0.299 | Not significant; upper limit on depth = depth + 3 sigma. |
| H2O ice / NH4 (3.0-3.2 um) | NOT_DETECTED | 3.100 ± 0.150 | -0.039 ± 0.073 | 0.220 | Not significant; upper limit on depth = depth + 3 sigma. |
| C-H organics (3.35-3.55 um) | NOT_DETECTED | 3.450 ± 0.100 | -0.050 ± 0.163 | 0.489 | Not significant; upper limit on depth = depth + 3 sigma. |

| Mineral candidate | Evidence | Confidence |
|---|---|---|
| Mafic silicates (olivine and/or pyroxene) | Band I (within_segment) | Medium |

## Absolute Magnitude H

- Status: CATALOG
- H (mag): 10.400 (uncertainty not provided)
- G: 0.46
- Source: JPL SBDB E2026L10
- Method: H-G (catalog)
  - ⚠ SBDB gives no H uncertainty; derived albedo uncertainty excludes the H term and is a lower bound.

## Diameter

- Status: OK
- Diameter (km): 17.61 ± 2.108
- Conditional range (no H): N/A
- Catalogue diameter (km): 16.84 ± 0.06 (Yeomans et al. (2000) Science v.289,pp.2085-2088)
- Difference: 0.7696 km (0.4 sigma)
- Confidence: Medium

## Geometric Albedo

- Status: ESTIMATED
- Geometric albedo pV (V band): 0.394 ± 0.094
- Method: pV = (1329 10^(-H/5) / D)^2
- H: 10.400 (uncertainty not provided) — JPL SBDB E2026L10
- D: 17.61 ± 2.108 km — SPHEREx NEATM fit (eta fitted)
- Correlation: H propagated jointly through the thermal fit (dD/dH from refitting); D fit error treated as independent of H.
  - ⚠ Uncertainty is a lower bound: an input uncertainty was not provided by its source.

## Mass and Density

- Mass (kg): 6.687e+15 ± 1.498e+12 — D: database GM (JPL SBDB) Yeomans et al. (2000) Science v.289,pp.2085-2088
- Status: ESTIMATED
- Bulk density (kg/m^3): 2339 ± 840
- Shape assumption: spherical_assumption — V = 4/3 pi (D/2)^3

## Missing Data

- none

## Data Sources and Provenance

```json
[
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"433\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:47:45+00:00",
  "version": "orbit_id=659; soln_date=2021-05-24 17:55:05",
  "identifier": "20000433",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL SBDB",
  "url": "https://ssd-api.jpl.nasa.gov/sbdb.api",
  "query": "{\"sstr\": \"433\", \"phys-par\": \"1\", \"full-prec\": \"1\"}",
  "retrieved_utc": "2026-11-14T08:47:45+00:00",
  "version": "orbit_id=659; soln_date=2021-05-24 17:55:05",
  "identifier": "20000433",
  "origin": "OBSERVED"
 },
 {
  "name": "IRSA MOST",
  "url": "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most",
  "query": "{\"catalog\": \"spherex\", \"output_mode\": \"Brief\", \"obs_begin\": \"2026-02-01\", \"obs_end\": \"2026-02-21\", \"ephem_step\": \"0.25\", \"input_type\": \"naifid_input\", \"obj_naifid\": \"20000433\"}",
  "retrieved_utc": "2026-11-14T08:47:46+00:00",
  "version": "",
  "identifier": "",
  "origin": "OBSERVED"
 },
 {
  "name": "JPL Horizons",
  "url": "https://ssd.jpl.nasa.gov/api/horizons.api",
  "query": "COMMAND='DES=20000433;' CENTER=500@-163182 QUANTITIES=1,3,9,19,20,24 n_epochs=218",
  "retrieved_utc": "2026-11-14T08:47:50+00:00",
  "version": "{\"version\": \"1.2\", \"source\": \"NASA/JPL Horizons API\"}",
  "identifier": "",
  "origin": "OBSERVED"
 }
]
```
