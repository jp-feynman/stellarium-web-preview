# Taxonomy Validation: 10 Hygiea (A849 GA)

- Reference taxonomy: C (C-complex) — JPL SBDB spec_B (SMASSII, Bus & Binzel 2002): C; JPL SBDB spec_T (Tholen): C

| Criterion | Result | Explanation |
|---|---|---|
| C1 1-um band detected when supported by the data | **PASS** | Reference class has no 1-um band: no band claimed (correct). |
| C2 2-um band evaluated | **PASS** | Band II evaluated: NOT_DETECTED; not detected; a typical band-bearing asteroid would be detectable here. |
| C3 Red slope alone does not cause D-type | **PASS** | Observed spectrum: no D-type driven by slope. Counterfactual: band-bearing templates reddened to D-like slope classified as S->S-complex, Sq->S-complex, Sr->S-complex, V->V-type, Q->Q-type; D template -> D-type. |
| C4 Observation-time differences detected | **PASS** | 21 visits over 11.08 d detected; segments never observed together: B1-B2, B2-B3, B3-B4, B4-B5, B5-B6; variability tested. |
| C5 No unsupported rotational correction | **PASS** | Applied correction 'none' meets the support criteria; without repeated observations: 'none' (no repeated observations: a rotational correction cannot be constrained); without rotation period: 'none'. |
| C6 Confidence decreases when S vs D is not distinguishable | **PASS** | Baseline confidence Low; without the 1-um region -> Low; with errors x4 -> Low. |
| C7 Most probable complex matches the reference | **FAIL** | Most probable complex X-complex (82.1%), reference C-complex at rank 2; confidence Low. |
| C8 No target-specific information in the classifier | **PASS** | No target names, reference taxonomies or validation files in the analysis/classification code. |

**Summary:** PASS 7, FAIL 1, INCONCLUSIVE 0

## Analysis summary

```json
{
 "solar_analog_calibration": {
  "applied": true,
  "reason": null,
  "n_stars": 14,
  "max_abs_correction": 0.11570281931571169,
  "slope_sigma_per_um": {
   "SWIR": 0.002289740967574337,
   "MWIR": 0.001413917081249607
  }
 },
 "temporal_correction": "none",
 "norm_groups": 1,
 "slope_sys_per_um": 0.036215363137476385,
 "thermal_status": "INSUFFICIENT_THERMAL",
 "thermal_chi2_red": null,
 "diameter_km": null,
 "diameter_err_km": null,
 "taxonomy_top_class": "Xn (ambiguous within X/Xc/Xe/Xk/Xn; group probability 82%)",
 "taxonomy_confidence": "Low",
 "complex_ranking": [
  [
   "X-complex",
   82.06
  ],
  [
   "C-complex",
   17.84
  ],
  [
   "K-type",
   0.06
  ],
  [
   "L-type",
   0.03
  ],
  [
   "T-type",
   0.01
  ]
 ]
}
```