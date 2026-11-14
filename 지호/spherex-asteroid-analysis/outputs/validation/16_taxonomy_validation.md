# Taxonomy Validation: 16 Psyche (A852 FA)

- Reference taxonomy: X (X-complex) — JPL SBDB spec_B (SMASSII, Bus & Binzel 2002): X; JPL SBDB spec_T (Tholen): M

| Criterion | Result | Explanation |
|---|---|---|
| C1 1-um band detected when supported by the data | **PASS** | Reference class has no 1-um band: no band claimed (correct). |
| C2 2-um band evaluated | **PASS** | Band II evaluated: NOT_DETECTED; not detected; data not sensitive enough to detect a typical band. |
| C3 Red slope alone does not cause D-type | **PASS** | Observed spectrum: no D-type driven by slope. Counterfactual: band-bearing templates reddened to D-like slope classified as S->S-complex, Sq->S-complex, Sr->S-complex, V->V-type, Q->S-complex; D template -> D-type. |
| C4 Observation-time differences detected | **PASS** | 21 visits over 12.36 d detected; segments never observed together: B1-B2, B2-B3, B3-B4, B4-B5, B5-B6; variability tested. |
| C5 No unsupported rotational correction | **PASS** | Applied correction 'none' meets the support criteria; without repeated observations: 'none' (no repeated observations: a rotational correction cannot be constrained); without rotation period: 'none'. |
| C6 Confidence decreases when S vs D is not distinguishable | **PASS** | Baseline confidence Low; without the 1-um region -> Low; with errors x4 -> Low. |
| C7 Most probable complex matches the reference | **PASS** | Most probable complex X-complex (48.2%), reference X-complex at rank 1; confidence Low. |
| C8 No target-specific information in the classifier | **PASS** | No target names, reference taxonomies or validation files in the analysis/classification code. |

**Summary:** PASS 8, FAIL 0, INCONCLUSIVE 0

## Analysis summary

```json
{
 "solar_analog_calibration": {
  "applied": true,
  "reason": null,
  "n_stars": 14,
  "max_abs_correction": 0.11810290152317715,
  "slope_sigma_per_um": {
   "SWIR": 0.002289740967574337,
   "MWIR": 0.001413917081249607
  }
 },
 "temporal_correction": "none",
 "norm_groups": 1,
 "slope_sys_per_um": 0.037929739703278224,
 "thermal_status": "OK",
 "thermal_chi2_red": 0.1808910233317195,
 "diameter_km": 249.93270302696553,
 "diameter_err_km": 56.72938606720829,
 "taxonomy_top_class": "X (ambiguous within X/Xc/Xe/Xk/Xn; group probability 48%)",
 "taxonomy_confidence": "Low",
 "complex_ranking": [
  [
   "X-complex",
   48.17
  ],
  [
   "C-complex",
   27.96
  ],
  [
   "T-type",
   10.45
  ],
  [
   "D-type",
   5.9
  ],
  [
   "S-complex",
   2.77
  ]
 ]
}
```