# Taxonomy Validation: 433 Eros

- Reference taxonomy: S (S-complex) — JPL SBDB spec_B (SMASSII, Bus & Binzel 2002): S; JPL SBDB spec_T (Tholen): S

| Criterion | Result | Explanation |
|---|---|---|
| C1 1-um band detected when supported by the data | **PASS** | Band I detected (within_segment) at 0.977 um. |
| C2 2-um band evaluated | **PASS** | Band II evaluated: NOT_DETECTED; not detected; a typical band-bearing asteroid would be detectable here. |
| C3 Red slope alone does not cause D-type | **PASS** | Observed spectrum: no D-type driven by slope. Counterfactual: band-bearing templates reddened to D-like slope classified as S->S-complex, Sq->S-complex, Sr->S-complex, V->V-type, Q->S-complex; D template -> D-type. |
| C4 Observation-time differences detected | **PASS** | 24 visits over 14.33 d detected; segments never observed together: B1-B2, B2-B3, B3-B4, B4-B5, B5-B6; variability detected. |
| C5 No unsupported rotational correction | **PASS** | Applied correction 'periodic_lightcurve' meets the support criteria; without repeated observations: 'none' (no repeated observations: a rotational correction cannot be constrained); without rotation period: 'visit_offsets'. |
| C6 Confidence decreases when S vs D is not distinguishable | **PASS** | Baseline confidence Medium; without the 1-um region -> Low; with errors x4 -> Low. |
| C7 Most probable complex matches the reference | **FAIL** | Most probable complex V-type (94.1%), reference S-complex at rank 2; confidence Medium. |
| C8 No target-specific information in the classifier | **PASS** | No target names, reference taxonomies or validation files in the analysis/classification code. |

**Summary:** PASS 7, FAIL 1, INCONCLUSIVE 0

## Analysis summary

```json
{
 "solar_analog_calibration": {
  "applied": true,
  "reason": null,
  "n_stars": 14,
  "max_abs_correction": 0.12202729562802173,
  "slope_sigma_per_um": {
   "SWIR": 0.002289740967574337,
   "MWIR": 0.001413917081249607
  }
 },
 "temporal_correction": "periodic_lightcurve",
 "norm_groups": 1,
 "slope_sys_per_um": 0.05795388936226832,
 "thermal_status": "OK",
 "thermal_chi2_red": 0.8743809871834973,
 "diameter_km": 17.60963674922785,
 "diameter_err_km": 2.1078372831556687,
 "taxonomy_top_class": "V - high slope ('w', DeMeo et al. 2009)",
 "taxonomy_confidence": "Medium",
 "complex_ranking": [
  [
   "V-type",
   94.09
  ],
  [
   "S-complex",
   5.14
  ],
  [
   "R-type",
   0.72
  ],
  [
   "D-type",
   0.04
  ],
  [
   "X-complex",
   0.0
  ]
 ]
}
```