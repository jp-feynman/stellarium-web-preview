# Stage status (2026-11-14)

Test suite: 95 tests pass offline (`pytest`). Against live IRSA/JPL services (`pytest --run-network -m
network`, 2026-11-14): 7 pass and 1 is an expected failure (xfail), "433 Eros most probable complex
matches the reference", which documents the open problem described below.

Status values:
- **Unit-tested**: tests pass on synthetic or fixture data.
- **Real-data verified**: run on live SPHEREx DR1 / JPL data and checked against independent values.

| Stage | Unit-tested | Real-data verified | Notes |
|---|---|---|---|
| 1 Search (MOST + Horizons from SPHEREx) | yes | **yes** | Eros: 218 exposures (2026-02-01..21). SPHEREx-centred Horizons positions agree with MOST to 0.2″ and with the measured image peak to about 0.1 px. Fixed sources (calibration stars): ObsCore position query + DataLink, Gaia DR3 astrometry |
| 2 Spectral extraction | yes | **yes** | PSF fluxes agree with r = 4 px aperture sums to 1–3%. Saturated PSF cores are recorded per point (`core_flags`, reason "saturated PSF core"); on the calibration stars such wing-only points scatter 7–8% in B1/B2 against 2–3% for clean points |
| 2c Relative spectral calibration (solar analogs) | yes | **yes** | 14 solar analogs, 1657 clean points, 199/216 bins; split-sample test χ²/N = 0.91. Applied to every OBSERVED spectrum (`docs/METHODS.md` §2c) |
| 3 Reflected / thermal separation | yes | **yes** | Eros: periodic lightcurve from repeats, NEATM χ²_red 0.87; Psyche χ²_red 0.18 |
| 4 Taxonomy / minerals | yes | **partly** | 5 validation asteroids, identical settings: the most probable complex matches the SBDB reference for 2 (Psyche, Hektor; both Low confidence), not for 3 (Eros, Asporina, Hygiea). See the table below |
| 5 Diameter / H / albedo | yes | **yes (D) / partly (pV)** | Eros D = 17.6 ± 2.1 km against NEAR 16.84 km (+0.4σ); Psyche 250 ± 57 km against 222 km (+0.5σ). Main-belt and Trojan targets at r > 2.5 au: thermal excess too weak, no D |
| 6 Mass / density | yes | **yes** (catalogue inputs) | ρ = M/V with SBDB GM and volume-equivalent D matches spacecraft values within 0.1–1.4% for Ceres, Vesta, Psyche, Lutetia, Ryugu and Eros, and within 3% for Bennu |
| 7 Integration / report / DB | yes | **yes** | Pipeline, report, database and dashboard run end-to-end on all five targets; the report and the record state whether the solar-analog correction was applied |

## Multi-asteroid taxonomy validation (DR1, identical settings, 2026-11-14)
Reference taxonomy from JPL SBDB (`spec_B`, else `spec_T`; visible-wavelength classes, compared at
complex level). Windows: Eros 2026-02-01..21 with 160 exposures (`config/validation_targets.yaml`); the
others 2025-04-12..2026-10-15 with 120 exposures. Solar-analog correction applied; saturated points used
with their measured 8% error (`temporal.saturated_points: inflated`). Files:
`outputs/validation/<id>_taxonomy_validation.{md,json}`, `outputs/validation/batch_summary.json`.

| Target | Reference | Most probable (complex probability) | Confidence | Reference complex rank | Criteria |
|---|---|---|---|---|---|
| 433 Eros | S | V-type 94.1% (S-complex 5.1%) | Medium | 2 | C7 FAIL, others PASS |
| 16 Psyche | X (Tholen M) | X-complex 48.2% (C 28.0%, T 10.5%) | Low | 1 | all PASS |
| 246 Asporina | A | S-complex 89.8%, class Sa (A-type 10.2%) | Medium | 2 | C7 FAIL, others PASS |
| 624 Hektor | D | D-type 53.2% (S-complex 43.2%) | Low | 1 | C2 INCONCLUSIVE, others PASS |
| 10 Hygiea | C | X-complex 82.1%, class Xn (C 17.8%) | Low | 2 | C7 FAIL, others PASS |

Per target:
- **433 Eros.** Band I is detected (within-segment test, centre 0.977 µm), which is typical of S-types; V-type
  bands are centred near 0.92 µm. The result depends on the 39 points with saturated PSF cores: with their
  nominal (understated) errors the same data gave S-complex 98.9% (High), and with them left out V-type
  (see "Saturation"). Eros is a 1.3–2 mag rotator observed at different rotational phases per wavelength, and
  it saturates at bright phases. The stability checks (lightcurve ±10%, leave-one-visit-out, without
  saturated points) all keep V-type, so this is a consistent bias of the remaining data, not a single bad
  visit. Open problem.
- **16 Psyche.** 63 of 120 points have a saturated core (B1 21/23, B2 19/19, B3 17/18). With the 8% error
  they still give X-complex, at Low confidence; without them no reflectance spectrum can be made (fewer
  than 4 points in the 1.6–2.5 µm continuum window).
- **246 Asporina.** Band I detected at 1.08 µm (olivine-like). A-types differ from Sa mainly by their
  very red visible slope, which SPHEREx does not cover (< 0.75 µm), so Sa/A is not separable here; the
  A-type keeps 10%.
- **624 Hektor.** Faint (~6 mJy), unsaturated, 9 normalisation groups (visit offsets not linkable);
  the D/S separation rests on the slope within groups. 4 of 21 leave-one-visit-out samples give S-complex,
  hence Low.
- **10 Hygiea.** The B1 points come from separate visits (one visit per wavelength range) whose
  brightness differs by up to ±8%; the narrow "Xn" feature is made by one visit at 0.89–0.96 µm. With the
  saturated points excluded instead of down-weighted, leaving that visit out gives C-complex.

Earlier summary (before the solar-analog calibration and the saturation handling): Eros S 98.9% (High),
Psyche X 84%, Hektor D 60%, Asporina Sa 85%, Hygiea X. The Eros and Psyche results then rested on
saturated photometry with understated errors.

## Relative spectral calibration with solar analogs
Method and full numbers: `docs/METHODS.md` §2c. Build: `python main.py solar-analog-calibration --start
2025-03-01 --end 2026-11-14 --max-images-per-star 150` (about 2 h, 2250 cutouts); re-derive from the
saved star spectra without network: `--from-saved`.
- Stars: Marsset et al. (2020) Table 1 stars with V ≥ 10.5 (98-978, 107-998, 110-361) and 12 stars of
  the Gaia DR3 golden sample of solar analogues (Creevey et al. 2023), G 11.3–11.8, chosen reproducibly
  (`config/solar_analogs.yaml`). The eight brighter Marsset stars saturate SPHEREx B1/B2 and are not used.
  110-361 was dropped by the star-level outlier rule (MWIR − SWIR level −5.5%, 7σ; b = +2°).
- Result: relative to 1.2 µm, B1 +2–3% with a dip at 0.89–0.93 µm and +4–5.5% at 1.03–1.12 µm (the
  pattern seen earlier in several asteroids); B2 +3.5–5.8% above 1.35 µm; B3 +2.5–11%; B4–B6
  +3.4–12.5%. Slope uncertainty 0.23 %/µm (SWIR), MWIR level uncertainty 0.24%.
- Independent checks: the two star halves (|β| < 30° / ≥ 30°) agree (χ²/N = 0.91 over 134 bins). The
  correction improves the fit to the literature class mean for Hygiea, Asporina and Hektor and leaves Eros
  unchanged; it changes no complex-level result. The narrow B1 structure matches the residuals of the
  bright Hygiea (r = 0.5–0.7) but not of the faint Hektor (r = 0.04): part of it may depend on brightness,
  which stars of a single brightness range cannot test.

## Saturation of bright targets in B1–B3
The SPHEREx PSF is undersampled, so the brightest pixel holds 40–80% of the flux and saturates first
(`OVERFLOW`/`SUR_ERROR` in FLAGS). Points with a rejected PSF-core pixel, per band (earlier DR1 runs):

| Target | B1 flux | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| 16 Psyche | ~300 mJy | 21/23 | 19/19 | 17/18 | 10/23 | 3/19 | 2/18 |
| 433 Eros | ~80 mJy | 10/27 | 14/32 | 11/21 | 11/27 | 6/32 | 10/21 |
| 10 Hygiea | ~100 mJy | 2/18 | 3/29 | 3/12 | 2/19 | 1/29 | 0/13 |
| 246 Asporina | ~13 mJy | 1/36 | 2/19 | 0/5 | 2/36 | 4/19 | 0/5 |
| 624 Hektor | ~6 mJy | 2/29 | 4/27 | 0/5 | 1/29 | 1/26 | 0/4 |

(For Hygiea, Asporina and Hektor the rejected core pixels are mostly not saturation: their B1/B2 peaks
reach at most 75, 14 and 6 MJy/sr, while flagged peaks of Eros and Psyche reach 150–220 MJy/sr.)

Accuracy of wing-only photometry, measured on the calibration stars (same star and band, saturated
against clean points relative to the fitted model): rms 7.0% (B1), 7.8% (B2), 5.9% (B3) against 2.2%,
2.5%, 3.1%; star-dependent offsets from −15% to +5% (χ²/N of the per-star differences 6.7).

Handling (`temporal.saturated_points`):
- `inflated` (default): saturated points are used everywhere with an 8% error floor; the classification
  is repeated without them, and the confidence is Low if the most probable complex changes.
- `lightcurve_only`: used only for the observation-time analysis.
- `exclude`: not used. This selects points by flux. For Eros the lightcurve phase coverage fell from
  100% to 60% and the fitted SWIR amplitude rose from 1.26 to 1.63 mag.
- `all`: nominal errors everywhere (the behaviour before 2026-11-14).

Eros under the four treatments (same photometry): `all` S-complex 98.9% (High); `inflated` V-type
94.1% (Medium); `lightcurve_only` V-type 98.6–99.5% (High); `exclude` V-type 95.6–96.8% (Medium).

## Stability checks added to the classification (spec §11.2)
Each check sets the confidence to Low when the most probable complex changes; results are stored with
the taxonomy (`lightcurve_sensitivity`, `visit_jackknife`, `saturation_sensitivity`).
- Lightcurve model: the applied periodic correction scaled by 0.9 and 1.1.
- Leave-one-visit-out: each visit with points in 0.75–2.45 µm removed in turn.
- Saturation: the classification repeated without the saturated points.

## Bugs found by real-data testing (all fixed and covered by tests)
1. Horizons rejected bare SPK-IDs (they need `DES=<spkid>;`). The SPHEREx-centred refinement had
   been silently skipped.
2. The thermal-excess S/N ignored the shared continuum error. The noise-only spread was 3.3σ instead of 1σ.
3. A free η could run to its bound and give a biased D. It now falls back to a fixed η with the prior propagated.
4. The density volume preferred the extent ellipsoid. That is wrong for irregular bodies (Eros +11%, Ryugu −18%).
5. A missing D uncertainty broke the albedo uncertainty (Psyche).
6. The SPHEREx `OUTLIER` flag marks the moving asteroid itself (49% of core pixels versus 1.3% of
   background). It had been rejecting the asteroid's own pixels.
7. The EPSF was integrated over the pixel twice. Fluxes were 5–15% low with a band-dependent bias,
   and χ²_red was about 100.
8. No trail model: a moving object was fitted with a point-source PSF.
9. `synphot` was missing, so sbpy silently fell back to a blackbody Sun (10–20% shape error). The
   fallback is now shown in reports.
10. Mineral candidates were reported at Medium confidence from a spectrum with neither thermal
    emission nor rotation removed.
11. Taxonomy scores used bare χ² with class σ, which favoured broad classes; classes without σ were
    penalised (an exact R spectrum came out Sr). Fixed with a σ floor and reference-grid binning,
    and calibrated on the class means.
12. The η prior was swamped by over-trusted data when χ²_red ≫ 1. The data errors are now rescaled
    consistently before being weighed against the prior.
13. Old databases lacked new result columns. An automatic schema migration now adds them.
14. "No variability detected between visits" was treated as "no variability": visits that no
    repeated observation could link got zero visit-to-visit uncertainty. On 10 Hygiea one isolated B1
    visit (0.85–0.97 µm) then produced a false 1-µm band. The spread of the fitted visit offsets
    (0.1 mag rms for visits no repeat links) is now kept in the error covariance;
    `test_isolated_faint_visit_does_not_create_a_false_band` fails with the old treatment.
15. A full-band candidate whose minimum lay outside the band-centre range counted as a detection.
    The minimum must now lie within 0.85–1.12 µm (Band I) or 1.75–2.35 µm (Band II).
16. An interrupted cutout download could leave a half-written file in the cache. Files are now
    written under a temporary name and renamed; downloads run 5 at a time.
17. The classical solar analogs of asteroid spectroscopy (V 8–10.6) saturate SPHEREx B1–B3: Landolt
    115-271 (V 9.7) had `OVERFLOW` in the peak pixel in 39 of 72 exposures, and Landolt 98-978
    (V 10.6) kept 1 clean B1 point and no clean B2 point out of 50. The calibration now also uses
    fainter solar analogues from the Gaia DR3 golden sample, and a calibration point may carry no
    FLAGS plane other than `SOURCE` in its PSF core.
18. Gaia DR3 `source_id`s (19 digits) were corrupted when a table row was read as a float64 Series:
    16 of the 23 configured identifiers pointed at other Gaia sources up to a few hundred numbers away
    (neighbouring stars in the same HEALPix cell). They were caught before any of them was
    photometered. Identifiers are now read column-wise, and the build checks each star's G and
    position against the values recorded at selection time (`verify_star_identity`).
19. The seeded random choice of golden-sample stars was not reproducible because TAP returns rows in
    no guaranteed order. Candidates are now sorted by `source_id` first; two runs give the same stars.
20. Saturated PSF cores were used without notice and with understated errors. A saturated peak pixel
    is rejected, so the flux comes from the PSF wings alone. Points now record their core FLAGS planes,
    and the analysis uses them with the 8% error measured on the calibration stars (see "Saturation").
21. A target whose spectrum could not be analysed (Psyche without its saturated points) was scored as a
    failed validation (`C0 FAIL`). Unanswerable criteria are now INCONCLUSIVE, with the reason, and the
    observation-time criteria and C8 are still scored.
22. `validate-batch` overwrote the summary of targets not in the current run; it now updates entries per
    target.

## Open limitations and next steps
- **Fast, elongated and bright rotators (433 Eros).** Each wavelength is measured at a different
  rotational phase, and the brightest phases saturate. The classification is not robust to how the
  saturated points are treated (S with nominal errors, V otherwise). Possible next steps: an external
  lightcurve or shape model; spectral modelling of the simultaneous SWIR/MWIR detector pairs; a
  consistency check between the measured band centre and the most probable class (Eros: 0.98 µm,
  S-like) - to be validated on the class means before use.
- **Saturated targets (16 Psyche).** Without the wing-only points no spectrum is possible. A PSF model
  validated on saturated stars, or an aperture method for saturated cores, would be needed.
- **Visit structure (10 Hygiea).** B1 is assembled from separate visits whose relative brightness is not
  tested by any repeat; one visit decides the narrow feature.
- **Calibration.** The calibration stars cover G 11.3–11.8 (golden-sample limit 12.3). Whether the narrow
  B1 structure depends on brightness needs fainter solar analogs (e.g. GSP-Phot candidates, which are not
  published as a list).
- **Visible slope.** A-types and Sa, and several C/X subclasses, differ mainly below 0.75 µm, which SPHEREx
  does not cover.
- The star cutout cache (`data/raw/spherex_cutouts_solar_analogs/`, 8.7 GB) can be deleted; the correction
  can be re-derived from `data/calibration/solar_analogs/*.csv` with `--from-saved`.
