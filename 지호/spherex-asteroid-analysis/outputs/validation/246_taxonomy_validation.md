# Taxonomy Validation: 246 Asporina (A885 EA)

- Reference taxonomy: A (A-type) — JPL SBDB spec_B (SMASSII, Bus & Binzel 2002): A; JPL SBDB spec_T (Tholen): A

| Criterion | Result | Explanation |
|---|---|---|
| C1 1-um band detected when supported by the data | **PASS** | Band I detected (full_band) at 1.082 um. |
| C2 2-um band evaluated | **PASS** | Band II evaluated: NOT_DETECTED; not detected; data not sensitive enough to detect a typical band. |
| C3 Red slope alone does not cause D-type | **PASS** | Observed spectrum: no D-type driven by slope. Counterfactual: band-bearing templates reddened to D-like slope classified as S->S-complex, Sq->S-complex, Sr->S-complex, V->V-type, Q->Q-type; D template -> D-type. |
| C4 Observation-time differences detected | **PASS** | 22 visits over 11.68 d detected; segments never observed together: B1-B2, B2-B3, B3-B4, B4-B5, B5-B6; variability detected. |
| C5 No unsupported rotational correction | **PASS** | Applied correction 'periodic_lightcurve' meets the support criteria; without repeated observations: 'none' (no repeated observations: a rotational correction cannot be constrained); without rotation period: 'visit_offsets'. |
| C6 Confidence decreases when S vs D is not distinguishable | **PASS** | Baseline confidence Medium; without the 1-um region -> Low; with errors x4 -> Low. |
| C7 Most probable complex matches the reference | **FAIL** | Most probable complex S-complex (89.8%), reference A-type at rank 2; confidence Medium. |
| C8 No target-specific information in the classifier | **PASS** | No target names, reference taxonomies or validation files in the analysis/classification code. |

**Summary:** PASS 7, FAIL 1, INCONCLUSIVE 0

## Analysis summary

```json
{
 "solar_analog_calibration": {
  "applied": true,
  "reason": null,
  "n_stars": 14,
  "max_abs_correction": 0.09317368448620522,
  "slope_sigma_per_um": {
   "SWIR": 0.002289740967574337,
   "MWIR": 0.001413917081249607
  }
 },
 "temporal_correction": "periodic_lightcurve",
 "norm_groups": 1,
 "slope_sys_per_um": 0.0236382239310471,
 "thermal_status": "INSUFFICIENT_THERMAL",
 "thermal_chi2_red": null,
 "diameter_km": null,
 "diameter_err_km": null,
 "taxonomy_top_class": "Sa (ambiguous within S/Sq/Sr/Sa/Sv; group probability 90%)",
 "taxonomy_confidence": "Medium",
 "complex_ranking": [
  [
   "S-complex",
   89.77
  ],
  [
   "A-type",
   10.23
  ],
  [
   "Q-type",
   0.0
  ],
  [
   "O-type",
   0.0
  ],
  [
   "K-type",
   0.0
  ]
 ]
}
```