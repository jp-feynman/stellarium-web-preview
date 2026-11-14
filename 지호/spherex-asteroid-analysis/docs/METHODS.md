# Scientific methods, assumptions and limitations

## 1. Moving-object identification
Asteroid positions are predicted with JPL Horizons, using the SPHEREx spacecraft (−163182) as the
observer, at the mid-time of each exposure. Fixed-source catalogue matching is never used.
Predicted and measured positions are compared, and a match needs an offset below
`search.max_position_offset_arcsec` (12″, about 2 pixels).
Unidentified detections are labelled as follows:
- `Unmatched Candidate`: a single detection.
- `Uncatalogued Candidate`: linked into a linear-motion tracklet of at least 3 points.

Neither label is a discovery claim. Confirming either one needs follow-up astrometry and an orbit.

## 2. Spectral extraction
SPHEREx images through Linear Variable Filters, so each exposure gives one wavelength per detector
at the source position. The spectrum is assembled from many exposures.
- Background: sigma-clipped median in an annulus of 6–12 px. It removes zodiacal light and other
  smooth emission together.
- Flux: weighted least-squares amplitude of the zone-matched EPSF on a 7×7 stamp. The flux is
  F = A·Ω_pix, with Ω_pix from `OMEGA_MEDIAN`. Errors are scaled by √χ²_red when the PSF under-fits.
- The EPSF is an *effective* PSF (Anderson & King 2000), already integrated over the pixel. It is
  sampled at native-pixel centres with bicubic interpolation. An earlier version also summed
  5×5 sub-samples, which integrated over the pixel twice. On real DR1 data (433 Eros and field
  stars) that gave fluxes 5–15% low, with a band-dependent bias, and χ²_red of about 100. After
  the fix, PSF fluxes agree with r = 4 px aperture sums to 1–3%.
- Moving objects: the PSF is averaged along the trail during the exposure. Midpoint samples are
  spaced ≤ 0.1 px, using the Horizons rates and the MJD-BEG/END span.
- The SPHEREx `OUTLIER` flag ("Detect Outliers") is raised by the moving object itself, because it
  appears in only one of the overlapping exposures. On Eros it covers 49% of core pixels versus
  1.3% of background pixels. It is therefore ignored inside the PSF stamp, but still rejects
  pixels in the background annulus (`extraction.moving_object_flags`).
- Wavelength: the official CWAVE/CBAND calibration when configured. Otherwise the WCS-WAVE lookup,
  flagged `APPROX_LOOKUP`.
- Saturation: the SPHEREx PSF is undersampled (40–80% of the flux in the brightest pixel), and that
  pixel saturates for bright sources (`OVERFLOW`, `SUR_ERROR` or `NONLINEAR` in `FLAGS`). Saturated
  pixels are rejected, so the flux then comes from the unsaturated PSF wings. Each point records the
  FLAGS planes set in its PSF core (`core_flags`), and saturated points carry the reason "saturated
  PSF core". `extraction.saturated_core_policy` makes them BAD (default) or keeps them as WARN.
  The default comes from the calibration stars: for the same star and band, saturated points scatter
  by 7.0% (B1), 7.8% (B2) and 5.9% (B3) rms about the model fitted to the clean points, against
  2.2%, 2.5% and 3.1% for clean points, with star-dependent offsets of −15% to +5% (χ²/N of the
  per-star differences 6.7). Wing-only photometry is therefore not accurate enough for few-percent
  spectral features.
- Quality: GOOD, WARN (e.g. a SOURCE-flagged pixel in the core, trailing, approximate wavelength)
  or BAD. All reasons are stored.
- Limitations:
  - The median pixel solid angle is used, not a per-pixel map.
  - The PSF is resampled by nearest sub-sample (1/5 px).
  - Rotational lightcurve variation between exposures adds scatter, which the reduced-χ² scaling
    absorbs.

## 2b. Observation-time structure and brightness correction
A SPHEREx spectrum is assembled from many visits, each lasting minutes. In each exposure one SWIR
and one MWIR detector see the same field (D1+D4, D2+D5, D3+D6), so a visit samples one detector
family. The families are observed hours to days apart: for 433 Eros, B1, B2 and B3 were never
observed together. Rotation (Eros: ~1.3 mag), geometry and calibration changes between visits can
therefore masquerade as spectral slope or band depth (`src/preprocessing/temporal_analysis.py`).

- **Detection.** The analysis reports the visits (gap > 30 min), the families, the time offsets
  between adjacent segments, and the λ–time correlation.
- **Repeated observations.** These are the same wavelength (within λ/80) measured in different
  visits. They measure brightness changes independently of the spectral shape, through the model
  ln f − ln g = μ_bin + s_visit. The constant-brightness model is tested (variability detected if
  p < 10⁻³).
- **Periodic lightcurve.** Given the period (SBDB rot_per), a zero-mean two-harmonic Fourier model
  is fitted to the repeats only. It is applied only if all of these hold:
  - at least 6 repeat bins;
  - rotational-phase coverage of at least 60%;
  - ΔBIC of at least 10;
  - it explains at least 70% of the variance that free visit offsets explain;
  - SWIR and MWIR agree. If they don't (Eros: p = 6×10⁻⁵), each arm is tested and normalised to
    its own rotation average.
- **Fallbacks.** With repeats but no supported period model, relative visit offsets are applied
  within connected components, which then form independent normalisation groups. Without any
  repeats, nothing is corrected and the cross-visit consistency is reported as untested.
- **Errors.** Correction uncertainties are propagated as visit-correlated errors (full covariance,
  `src/classification/covariance.py`). On Eros, treating them as independent drowned the
  within-visit shape (χ²_red 0.14).
- **Effect on Eros.** The thermal fit went from χ²_red 47 (joint lightcurve inside the thermal fit)
  to 0.77 (repeat-based correction). D = 15.6 ± 1.8 km against the NEAR value of 16.84 km.

## 2c. Relative spectral calibration with solar-analog stars
Reflectance divides the asteroid flux by a solar model (E490, averaged over each SPHEREx bandpass).
Any wavelength-dependent error of the SPHEREx flux calibration or of the PSF photometry, and any
mismatch of the solar model at SPHEREx resolution, goes straight into the reflectance. Ground-based
asteroid spectroscopy removes these by dividing by a solar-analog star observed with the same
instrument. The same is done here with SPHEREx data (`src/preprocessing/solar_analog_calibration.py`,
`python main.py solar-analog-calibration`).

- **Stars.** The 11 solar analogs of the SMASS and MITHNEOS surveys, from Table 1 of Marsset et al.
  (2020, ApJS 247, 73), listed in `config/solar_analogs.yaml`. Each is matched to Gaia DR3 (within
  0.3–2.1″ of the table position; G − V = −0.12 to −0.19; BP − RP = 0.77–0.82 against a solar 0.82).
  Marsset et al. find that the stellar mean slopes of these stars spread by 1.4 %/µm (1σ) over
  0.8–2.4 µm.
- **Search and photometry.** SPHEREx L2 images containing the star come from an ObsCore position
  query; the science-file URL of each comes from its DataLink record
  (`src/acquisition/fixed_source_search.py`). The position is propagated from Gaia DR3 (J2016.0) with
  the proper motion. Photometry uses the same forced-PSF code as for asteroids, without a trail.
- **Model.** For every point i of star s, ln q_si = ln(F_si / F_sun(λ_si)) = a_s + c_d(b) + noise:
  a_s is a free scale per star and c_d(b) a response term per detector d and wavelength bin b
  (width λ/2R). The gauge is the reflectance normalisation: the weighted mean of c over the bins
  within 1.2 ± 0.05 µm is zero, so the correction never changes the normalisation. The fit is
  weighted least squares (photometric error plus a 1% floor), with iterative 4σ clipping and errors
  scaled by √χ²_red. A bin counts as determined with at least 3 points from at least 2 stars.
- **Star-to-star differences.** The analogs are not identical to the Sun. A linear trend of each
  star's residuals (SWIR and MWIR separately) gives the colour spread; its standard deviation / √N
  is the slope uncertainty of the mean correction. It is added in quadrature to the classification's
  systematic slope uncertainty. The per-star MWIR − SWIR mean residual measures how well the MWIR
  level is tied to the 1.2-µm gauge; its spread / √N is added to the MWIR bin errors.
- **Application.** The correction is applied in the shared analysis chain right after quality
  selection, to OBSERVED spectra only: F' = F / C(λ), C = exp(c) interpolated within each detector,
  with σ'² = (σ/C)² + (F σ_C/C²)². Points outside the calibrated range are left uncorrected and
  counted. The report, the integrated record (`spectral_calibration`) and the database provenance
  state whether it was applied, from how many stars, and with what slope uncertainty.
- **Independence.** The correction is built from stars only. No asteroid data, target names or
  reference taxonomies enter it. Using the validation asteroids themselves to define a common
  pattern would make the validation circular, so that is not done.
- **Star-level outliers.** A star whose SWIR residual slope or MWIR − SWIR level lies more than
  4 robust standard deviations (1.4826 MAD over the stars) from the others is not a usable solar
  proxy and is dropped before the final fit (`solar_analog_star_clip_sigma`).
- **Result (DR1, built 2026-11-14).** 15 stars, 150 images each (25 per detector). Landolt 110-361
  was dropped (MWIR − SWIR level −5.5% against a median of −0.3%, robust σ 0.8%; it lies at
  b = +2°). 14 stars, 1657 clean points, χ²_red 1.57, 199 of 216 bins determined with a median
  error of 0.8–1.1%. Slope uncertainty of the mean correction 0.23 %/µm (SWIR) and 0.14 %/µm (MWIR);
  MWIR level uncertainty 0.24%. Per-star SWIR residual slopes spread by ±1.3 %/µm, in line with
  the 1.4 %/µm of Marsset et al. (2020).
  - Shape, relative to 1.2 µm: B1 +2–3% at 0.80–0.88 µm, a dip to +0.1–1.0% at 0.89–0.93 µm and
    +4–5.5% at 1.03–1.12 µm; B2 ≈ 0 at 1.15–1.31 µm and +3.5–5.8% from 1.35 µm; B3 +2.5–11%;
    B4–B6 +3.4–12.5%. Fluxes are divided by C, so the long-wavelength reflectance and thermal
    fluxes go down by these amounts.
  - Split test: curves from the stars at |β| < 30° and at |β| ≥ 30° agree (134 common bins,
    χ²/N = 0.91, median difference 1.1%).
  - Effect on the validation asteroids (literature class mean, scale and slope free): the fit
    improves for 10 Hygiea (χ²_red 1.09 → 0.95), 246 Asporina (1.22 → 1.10) and 624 Hektor
    (0.18 → 0.12) and is unchanged for 433 Eros (1.05 → 1.07) with saturated points excluded; no
    complex-level classification changes. The narrow B1 structure correlates with the residuals of
    the bright Hygiea (r = 0.5–0.7) but not with those of the faint Hektor (r = 0.04), so part of
    it may depend on brightness; that cannot be tested with stars of one brightness (G 11.3–11.8).

## 3. Reflected and thermal separation (NEATM, Harris 1998)
For each point, with its own r, Δ and α:
`F = F_sun(λ)/r² · Φ_HG(α) · K(λ)/Δ² + NEATM(λ; D, η, A, ε)`, where K(λ) = p_λ R² = K0[1 + s(λ − 2 µm)].

Model details:
- The continuum is fitted on 1.6–2.5 µm and extrapolated. The 2.5–3.5 µm region is excluded from
  the fit to protect the 3-µm features.
- With H: the Bond albedo is A = q·pV, with pV = (1329·10^(−H/5)/D)², so D and pV are constrained
  together.
- Without H: the fit is repeated over a pV grid, and only a conditional D range is reported. No
  albedo is given.
- η is fitted with a literature phase-angle prior (default `eta_mode: phase_prior`):
  η₀(α) = 0.87 + 0.01·α[deg], with an asymmetric 1σ range of −0.30/+0.55. This comes from
  Trilling et al. (2016, AJ 152, 172; arXiv:1608.03673), from Warm Spitzer 3.6/4.5 µm NEATM fits
  of NEOs, which is the same wavelength regime as SPHEREx. The alternative
  `eta_prior_relation: mainzer2011` uses Mainzer et al. (2011, ApJ 743, 156):
  η = 0.00963·α + 0.761, from WISE 12/22 µm, with the Trilling scatter since no object-to-object
  scatter is quoted there.
  - The prior enters the least-squares fit as one extra residual, so weak thermal data leave η
    near η₀ and strong data can move it.
  - If the model leaves unexplained scatter (χ²_red > 1.5), the data errors are rescaled to
    χ²_red = 1 before being weighed against the prior. This is the same scaling the covariance
    uses. Without it, poorly fitting data are over-trusted and swamp the prior: for Eros, η went
    from 0.53 to 0.97 and D from 12.0 to 15.8 km once the rescaling was applied.
  - The relation was derived from NEOs. For main-belt objects it is an assumption, and phase
    angles outside 0–100° are flagged.
  - The legacy mode (`eta_mode: fixed`) fixes η = 1.0 ± 0.3.
- Fits are refused when the thermal excess has S/N < 3. Fits are flagged when χ²_red > 3 or a
  parameter sits on a bound.
- The thermal-excess S/N uses the full covariance of the extrapolated continuum, because the
  thermal points share one continuum. Errors are also inflated by the continuum-fit scatter.
  Treating the points as independent had given a noise-only S/N spread of 3.3 instead of 1.
- If a free η runs to its bound (the D–η degeneracy), the fit is repeated with η fixed and its
  prior propagated.
- Rotational lightcurve: when SBDB gives a rotation period, a zero-mean two-harmonic Fourier term
  in magnitudes multiplies the whole model. Without it, an elongated body's lightcurve (Eros: up
  to ~1 mag between exposures) is aliased into the spectral shape. D then refers to the
  rotation-averaged cross-section, and reflected and thermal light are assumed to share the
  lightcurve.
- The internal 2-µm reflectance parameter K0/R² is stored separately and is never reported as pV.

Limitations:
- The 3.5–5 µm range sits on the Wien side of the thermal emission for most objects, so D and η are
  strongly correlated there.
- Objects farther than about 2.5 au show little thermal signal at 5 µm.
- The model assumes a spherical body and the NEATM temperature distribution.
- TPM is not implemented. It would need thermal inertia, a spin state and a shape model.
- The solar spectrum is sbpy E490_2014. If sbpy is missing, a 5772 K blackbody is used and flagged.

## 4. Taxonomy and minerals

**Current method (supersedes the description below where they differ).**
- Following DeMeo et al. (2009, §3.1), slope and shape are separated. For each class the model is
  s_g·T(λ)·[1 + β(λ − 1.2 µm)], with a free scale per normalisation group and a free slope β. The
  slope then enters as a separate term β²/(σ_slope,class² + σ_slope,sys²).
- **High-slope ("w") classes.** S, Sq, Sr, Sv, V and Q have high-slope "w" variants in DeMeo et al.
  For these classes a redder slope is not penalised; it is reported as "w".
- **Class scatter.** The published intra-class σ is split into a slope part and a shape residual:
  σ(λ) ≈ a + b(λ − 0.55). The full σ would double-count slope variation, which made the broad
  D class absorb a 1-µm band.
- **Systematic slope error.** σ_slope,sys comes from the per-family normalisation uncertainty. It
  is None (slope term off) when consistency between visits is untested.
- **Confidence.** It comes from the deviance gap between the best and the runner-up complex
  (≥ 9: High, ≥ 4: Medium). It is capped at Low when:
  - S-complex and D-type are within 4;
  - the 1-µm region (< 1.1 µm) is not covered;
  - a featureless class wins although a 1-µm band is detected;
  - the slope is unconstrained and a featureless class wins.
- **Trade-off.** On exact class means this recovers 73% of classes and 88% of complexes, against
  92% for slope-inside-shape. The misses are near neighbours. In exchange, a red continuum alone
  cannot produce a featureless class.
- **Band analysis.** Band I and Band II are always reported as DETECTED, NOT_DETECTED or
  NOT_EVALUABLE, with the minimum detectable depth (3σ) and whether a typical band-bearing class
  would be detectable with the same sampling. The evidence comes from two tests:
  - the full band within one normalisation group, with a Monte Carlo false-alarm threshold (shoulder
    maxima and a band minimum bias the depth of pure noise) and the centre inside 0.85–1.12 µm or
    1.75–2.35 µm;
  - a within-segment curvature test (B1 or B3 points with full covariance), which is insensitive to
    unlinked brightness changes.
  On all 25 class means (S/N 50 and 5, 3 noise draws) this gives no false detections in featureless
  classes, and band patterns that match the class descriptions.

The earlier description follows.
- References: the Bus-DeMeo class means (0.45–2.45 µm), convolved to R = 40, interpolated onto the
  observed wavelengths and renormalised at 1.25 µm. The Bus-DeMeo PCA coefficients and boundaries
  are **not** reused.
- Ranking: every class is listed by relative probability, highest first, and probabilities are
  also summed per complex.
  - The observed spectrum is binned onto the 0.05 µm reference grid first.
  - The χ² uses a free scale factor, with both the measurement error and the intra-class σ.
    Classes without a published σ (Cg, O, R) get the median σ of all classes.
  - P_i ∝ exp(−(χ²_i − χ²_min)/(2s)), with s = max(χ²_red of the best class, 1), so a poorly
    fitting spectrum does not yield spurious 100%/0% certainty.
  - This configuration was chosen by recovering the 25 class means (3 noise draws, S/N 50):
    83% of classes and 92% of complexes were recovered. The misses are pairs that differ mainly
    in the visible (Sv/Sr, Xc/Xe, T/Xk, Ch/Xe). A Gaussian deviance (χ² + Σ ln σ²) recovered only
    47–51%, because the class σ is correlated across wavelength.
  - The probabilities are relative among the reference classes. They are not probabilities that
    a mineral is present.
- Classes that are told apart mainly by their visible slope are reported as ambiguous groups:
  C/B subclasses, X subclasses and S subclasses.
- Bands:
  - Band I and Band II: continuum removal, polynomial band centre with a Monte-Carlo error, depth,
    and BAR (band area ratio).
  - 3-µm windows: 2.7–2.9 µm (OH), 3.0–3.2 µm (H₂O/NH₄) and 3.35–3.55 µm (C–H), measured on the
    thermally corrected reflectance.
  - A band counts as detected only with depth/σ ≥ 3 and a width of at least 1.5 resolution elements.
- Mineral candidates come from indicative Cloutis/Gaffey criteria. They are consistency statements,
  not identifications.
- ML (RF/SVM/XGBoost) is available only with an independent labelled set. Training and validation
  are split by object, a leakage check runs, and class imbalance is reported.

## 5. Absolute magnitude H
The order of sources is:
1. JPL SBDB H, with its reference.
2. Other catalogues.
3. An estimate from multi-epoch photometry from any provider (MPC archive, or a user CSV from any
   facility).

The estimate uses `V_red = m − 5 log10(rΔ) = H − 2.5 log10 Φ(α)`, with H-G (Bowell et al. 1989) or
H-G1-G2 through sbpy. The rules are:
- G is fitted only if the phase angles span at least 10°.
- Rotational scatter is either configured or inferred from the residuals (and flagged).
- At least 5 points over at least 3 nights are needed.
- Only V-band data is used unless verified band corrections are enabled.

If the requirements are not met, the status is `Insufficient optical photometry` and the follow-up
requirements are listed. No facility is pre-selected.

## 6. Albedo
`pV = (1329·10^(−H/5)/D)²`, computed only for a V-band H and a thermal-model D.
- Errors: the H uncertainty is propagated both directly and through the H-dependent thermal fit,
  using dD/dH from refits at H ± σ_H.
- Values outside 0.01–1.0, or with relative error above 0.5, are shown as `ON_HOLD_VALIDATION`.
  They are never clipped.
- Geometric albedo, Bond albedo and spectral reflectance are kept as separate quantities.

## 7. Mass and density
Mass comes only from dynamical results: a database GM (M = GM/G), Kepler III for binaries, or
published perturbation and spacecraft-tracking results with references. It is never derived from
diameter or taxonomy.

Density is ρ = M/V. The volume comes from, in order of preference:
1. the SPHEREx thermal diameter;
2. the SBDB volume-equivalent diameter;
3. as a last resort, the triaxial extent.

SBDB extents are maximum dimensions, so their ellipsoid volume is biased for irregular bodies.
In validation it was +11% for Eros and −18% for Ryugu. Sphere-based volumes are flagged
`spherical_assumption`. Errors are propagated assuming independent inputs.

## 8. Validation
`python main.py validate` compares the system's calculations against SBDB values for objects
measured by spacecraft (Ceres, Vesta, Psyche, Lutetia, Bennu, Ryugu, Eros). Differences are
reported and interpreted, never tuned away. Catalogue pV values often come from H and D values
other than those listed in the same record.

## 9. Taxonomy validation (433 Eros)
`python main.py validate-taxonomy --target 433` scores eight criteria (C1–C8) against the reference
taxonomy in `config/validation_targets.yaml`, cross-checked with SBDB spec_B. That reference is
read only by `src/validation`, and C8 verifies statically that the analysis and classification code
contains no target names or reference taxonomies. Counterfactuals use the observation's own
sampling and error structure:
- band-bearing templates reddened to the slope of the D-type mean (must not become D), with a D
  template as control;
- repeats removed, or no rotation period (no rotational correction may be applied);
- the 1-µm region removed, or errors ×4 (confidence must not rise; it must be Low without the band
  region).
