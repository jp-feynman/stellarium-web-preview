# Taxonomy Validation: 624 Hektor (A907 CF)

- Reference taxonomy: D (D-type) — JPL SBDB spec_T (Tholen): D

| Criterion | Result | Explanation |
|---|---|---|
| C1 1-um band detected when supported by the data | **PASS** | Reference class has no 1-um band: no band claimed (correct). |
| C2 2-um band evaluated | **INCONCLUSIVE** | Band II not evaluable: band shoulders and centre not observed within one normalisation group. |
| C3 Red slope alone does not cause D-type | **PASS** | Observed spectrum: no D-type driven by slope. Counterfactual: band-bearing templates reddened to D-like slope classified as S->S-complex, Sq->S-complex, Sr->S-complex, V->V-type, Q->S-complex; D template -> D-type. |
| C4 Observation-time differences detected | **PASS** | 21 visits over 247.28 d detected; segments never observed together: B1-B2, B2-B3, B3-B4, B4-B5, B5-B6; variability detected. |
| C5 No unsupported rotational correction | **PASS** | Applied correction 'visit_offsets' meets the support criteria; without repeated observations: 'none' (no repeated observations: a rotational correction cannot be constrained); without rotation period: 'visit_offsets'. |
| C6 Confidence decreases when S vs D is not distinguishable | **PASS** | Baseline confidence Low; without the 1-um region -> Low; with errors x4 -> Low. |
| C7 Most probable complex matches the reference | **PASS** | Most probable complex D-type (53.2%), reference D-type at rank 1; confidence Low. |
| C8 No target-specific information in the classifier | **PASS** | No target names, reference taxonomies or validation files in the analysis/classification code. |

**Summary:** PASS 7, FAIL 0, INCONCLUSIVE 1

## Analysis summary

```json
{
 "solar_analog_calibration": {
  "applied": true,
  "reason": null,
  "n_stars": 14,
  "max_abs_correction": 0.09225258603880104,
  "slope_sigma_per_um": {
   "SWIR": 0.002289740967574337,
   "MWIR": 0.001413917081249607
  }
 },
 "temporal_correction": "visit_offsets",
 "norm_groups": 9,
 "slope_sys_per_um": 0.002289740967574337,
 "thermal_status": "INSUFFICIENT_THERMAL",
 "thermal_chi2_red": null,
 "diameter_km": null,
 "diameter_err_km": null,
 "taxonomy_top_class": "D",
 "taxonomy_confidence": "Low",
 "complex_ranking": [
  [
   "D-type",
   53.25
  ],
  [
   "S-complex",
   43.18
  ],
  [
   "Q-type",
   1.5
  ],
  [
   "C-complex",
   1.48
  ],
  [
   "X-complex",
   0.44
  ]
 ]
}
```