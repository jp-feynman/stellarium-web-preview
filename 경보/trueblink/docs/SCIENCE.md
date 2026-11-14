# The science behind TrueBlink

A short explainer for the team and for curious users. Instrument facts come from the SPHEREx Explanatory Supplement v2.1. Target numbers in sections 2-4 were measured on 2026-11-14 with TrueBlink's own code on real DR1 and QR3 Level-2 pixels (the commands are given with each table). Numbers from our earlier Python analysis are labelled as such. Catalogue values are cited.

## 1. How SPHEREx observes

SPHEREx is a NASA infrared survey telescope launched on 2025-03-12. It has a 20 cm telescope in a low Earth orbit and maps the whole sky in 102 colours between 0.75 and 5.0 µm.

- **Six detector arrays.** A dichroic beam splitter sends the light to two sets of three arrays, so each exposure produces six images of 2040 x 2040 pixels. A pixel is 6.15 arcsec; each array covers 3.5 degrees. Arrays 1 and 4, 2 and 5, and 3 and 6 see the same patch of sky at the same moment, at two different wavelengths.
- **Linear variable filters.** In front of each array is a filter whose wavelength changes smoothly from one edge of the array to the other. Each array is divided into 17 strips, called channels; six arrays times 17 channels gives 102 channels. Resolving power is about 40 in arrays 1-4 and 112-128 in arrays 5 and 6.
- **Stepping across the filter.** Each exposure lasts 113.6 seconds. Between exposures the telescope moves by one channel width, so the same star lands on the next strip and is seen at the next wavelength. A visit to one position is a run of 55-80 exposures over 2-3 weeks, which builds a full spectrum.
- **Visits every six months.** The sky is mapped twice a year. The first data release (DR1) covers 2025-04-24 to 2026-05-14 and gives most positions two visits; the third quick release (QR3), from May 2026, adds a third. Between visits the telescope's orientation on the sky flips by 180 degrees.
- **Deep fields.** Near the north and south ecliptic poles SPHEREx observes almost every day. The north pole has more than 20,000 deep-survey frames in the first year. R Draconis, 8.6 degrees from the north pole, has 2,493 images in DR1 and QR3 (IRSA SIA, 2026-11-14), 1,954 of them from the deep survey.

## 2. Why like with like matters

Put the exposures of one star in time order and every frame is at a different wavelength. A red star brightens as the wavelength increases, a cool brown dwarf jumps between methane bands, and the blink flickers for reasons that have nothing to do with time. In our preparatory analysis, Epsilon Indi B's brightness changed by a factor of 8 inside a single array from wavelength alone.

TrueBlink therefore never blinks raw exposures in time order by default. Its default frame for each visit ("Dates (same colours)") is an average over the spectral channels that every kept visit has, each channel given equal weight, so every date has the same effective wavelength. Visits that share too few channels with the others are left out and named in the frame notes. Each frame carries its date (amber) and its wavelength range (cyan). Measurements compare the same channel on different dates.

### Our own test of the claim (2026-11-14)

`scripts/audit/like-with-like.ts` decodes the baked pixel bundles (real DR1 and QR3 Level-2 pixels, `public/presets/*.bundle.*`) and measures, in each detector, the first and the last visit of the target and of the Gaia DR3 field stars in four ways: matched channels (like with like), a naive per-visit stack of all exposures, the same naive stack after keeping a random 40 % of the exposures (what an exposure cap does), and single exposures paired in time order (a naive blink).

| Field, objects | Matched channels | Naive full-visit stack | Naive 40 % stack | Single frames in time order | Single frames, same channel |
|---|---|---|---|---|---|
| RW Aurigae field: 6 Gaia stars (G 14.8-17.4), 32 star-detector pairs, 2025-09-10 vs 2026-09-09 | median 3.1 % from 1 | 3.5 % | 7.3 % (1 trial in 10: 17 % or more) | typical factor 1.24; worst pair per star and detector typically 1.85 | 1.11 |
| R Draconis itself, array 1 (0.75-1.1 µm, wing photometry), 2025-06-27 vs 2026-08-22 | 1.04 | 1.05 | not run | typical factor 4.4, up to 10 | 1.39 |

What this shows, honestly:

In one sentence: for six constant stars near RW Aurigae, time-ordered single frames differ by a typical factor of 1.24 (up to about 1.85), matched channels across visits by 3.1 %; a full-visit stack in one detector is already nearly balanced (3.5 %), and a 40 % subset gives 7.3 %.

- **Single exposures blinked in time order produce false variability.** Constant field stars change by a typical factor of 1.24 between frames and by about 1.85 in the worst pair, against 1.11 when the same channel is paired (the rest is noise and pixel phase). For a star with a steep spectrum the effect is much larger: R Draconis in array 1 changes by a typical factor of 4.4, while matched channels give 1.04.
- **A full visit stack inside one detector is nearly balanced already**, because every visit sweeps all 17 channels of each array. The naive full-visit stack was only slightly worse than matched channels for constant stars (3.5 % against 3.1 %). The bias grows when the channel mix differs between dates, as with an exposure cap (7.3 % typical, 17 % or more in one trial in ten).
- These are the only like-with-like numbers we quote. They come from TrueBlink's own code on the pixels shipped in this repository, and anyone can rerun them (command above, cache file from `scripts/measure-check.ts rwaur`).

Limits of the "same channel" rule: the third and fourth surveys are offset by about half a channel, so the same channel number on two dates can differ by up to half a channel width (about 1 % in wavelength). The balanced frames report this as an "effective wavelength" note when the dates differ by more than 0.5 %, but they do not drop such channels; the measurement module matches by channel number only. Pixels where up to a quarter of the channels are missing (for example a saturated core) are averaged over the channels that remain, so their effective wavelength can differ slightly between dates.

## 3. What the five challenge targets show

Measured on 2026-11-14 with TrueBlink's own measurement code in two ways: in the browser, from the baked pixel bundles (what the app shows in its mission cards, "What changed?" list and Research > Measure), and on the command line (`npx tsx scripts/measure-check.ts <id>`: up to 200 DR1 and QR3 Level-2 cutouts per target, a 240 arcsec window). Both use Gaia DR3 stars as comparison stars and fit the motion per visit with the Gaia parallax removed. Catalogue values are Gaia DR3 except WISE 0855-0714 (Kirkpatrick et al. 2021, via SIMBAD). The two runs use different fields and exposures, so their decimals differ; where they differ in substance, the table says so.

| Target | Motion (browser; command line) | Brightness, last visit / first visit | Catalogue | Comment |
|---|---|---|---|---|
| **Barnard's Star** (red dwarf, 1.83 pc = 6.0 light-years) | 10.34 ± 0.95 arcsec/yr; 10.33 ± 0.94 (5 visits, 2025-08-25 to 2026-08-24, towards the north) | No brightness change measured: ratio 0.97 ± 0.015 in 101 shared channels, "stayed the same within 17 %" (one Gaia comparison star in the field, which changed by 5.6 %). Command line: 0.98 ± 0.03. | 10.39 arcsec/yr | Saturated: position and brightness come from the wings, so brightness is relative only. |
| **Epsilon Indi B** (two T dwarfs, Ba T1 + Bb T6, unresolved; 3.69 pc = 12 light-years) | about 4.6 arcsec/yr; 4.57 ± 0.08 (5 visits, 2025-05-01 to 2026-09-27, towards the south-east) | Stayed the same within 6 %. Command line: 1.04 ± 0.03. | 4.68 arcsec/yr (photocentre of the pair, Gaia RUWE 4.3) | Not saturated; the clearest motion measurement of the five. |
| **WISE 0855-0714** (Y dwarf, 2.28 pc = 7.4 light-years) | 7.84 ± 1.00 arcsec/yr from arrays 5 and 6 only (4 visits, 2025-05-06 to 2026-05-02, towards the west) | Too noisy to tell: 1.20 ± 0.47. | 8.15 arcsec/yr | Detected only at 3.8-5.0 µm; spectrum brightest near 4.55 µm. A Gaia star (G = 16.3) comes within 4.2 arcsec (2026-05-02) and supplies the light seen at shorter wavelengths. The challenge's coordinates are about 2 arcmin from where it was in 2025-2026. |
| **RW Aurigae** (young T Tauri star, 156 pc) | - | The change depends on colour (2026-09-09 against 2025-09-10, wing photometry). Browser, per array: 1.22, 1.27, 0.98, 0.57, 0.47, 0.49 (arrays 1-6): about half as bright at 3.8-5 µm, 27 % brighter at 1.1-1.6 µm. Averaged over 2.4-5.0 µm: 51 % fainter. Averaged over 0.75-2.4 µm: +6.2 % with a 3-5.5 px ring, +2.7 % with a 5-7.5 px ring. Comparison stars changed by 7.1 %. Command line (wider field, another ring): array 1 1.55, arrays 5 and 6 0.48 and 0.49. | strongly variable (V 9.2-13.6) | Robust: about half as bright at 4-5 µm. At the shortest wavelengths it became brighter by an amount that depends on where it is measured (a few per cent to tens of per cent), because the core is saturated. |
| **R Draconis** (Mira variable, period 246 d) | - | Low confidence: saturated (core radius about 8 px, wing photometry further out) and no clean comparison star (field stars sit in its halo). The browser shows a colour finding marked low confidence; the numbers depend on which exposures are loaded. | V 6.7-13.2, period 246.1 d (AAVSO VSX) | Use it as an example of saturation and wavelength mixing, not as a measurement. |

Distances are 1/parallax from the catalogue values in `tests/fixtures/targets.json`.

How the findings are worded. Brightness ratios are computed separately for 0.75-2.4 µm (arrays 1-3) and 2.4-5.0 µm (arrays 4-6), each with its own comparison-star floor, and Research > Measure lists them per range and per array. When the ranges disagree beyond their errors, the finding reads "The change depends on colour". A change smaller than its error reads "Too noisy to tell". For saturated targets the finding states how the 0.75-2.4 µm number depends on the ring used (the ratio is recomputed with a ring 2 px further out). With no measurable comparison star the finding is marked low confidence and says so.

## 4. The cold-object filter

**Idea.** Ordinary stars are thousands of kelvin hot, so between 3.8 and 5 µm their light follows the Rayleigh-Jeans tail and the brightness at 4.2-4.8 µm is a predictable fraction of the brightness at 3.82-4.05 µm. Cold brown dwarfs such as WISE 0855-0714 (a few hundred kelvin) lose most of their light between about 3 and 4 µm to methane absorption and shine through a window beyond about 4.2 µm, so subtracting a scaled short image from a long one cancels ordinary stars and leaves cold objects. This is the idea behind the WISE W1-W2 colour that found the coldest brown dwarfs, done here with SPHEREx's own narrow channels.

**What TrueBlink does** (`src/core/stack/spectral.ts`, `buildSpectralDifferenceSequence`; in the app the sequence "Cold-object filter", URL `seq=coldFilter`, step 3 of the WISE 0855-0714 mission). For each visit it stacks the single exposures at 4.2-4.8 µm and those at 3.82-4.05 µm (sigma-clipped mean, at least 3 exposures in each band), and subtracts the second, multiplied by a scale, from the first. The app uses the Rayleigh-Jeans scale (λ_short / λ_long)², about 0.77 for these bands (flux densities in MJy/sr). The core module can instead fit the scale on the field's bright stars; on WISE 0855-0714 the fit agrees (0.78-0.79), but in the Epsilon Indi B and RW Aurigae fields the target itself pulls it (0.52-0.62 and 1.25-1.37) and leaves 15-40 % of field stars behind, which is why the app uses the Rayleigh-Jeans value. Visits with too few exposures in one band are left out and named in the frame notes. Each frame records both exposure counts and the scale used. The result is one frame per visit, so the frames can be blinked.

**What it gives on WISE 0855-0714** (baked bundle, 2026-11-14). Only 2 of its 4 visits have at least 3 exposures in both bands, so there are 2 frames (2025-11-07 and 2026-05-02; 2025-05-06 and 2025-12-12 are left out and named). The target is at S/N 26.9 and 32.9, against 42.4 and 59.9 in the 4.2-4.8 µm stack alone. Field stars cancel to within about 2-17 % of their flux for a G = 16.3 star; fainter stars (G 18-19) are dominated by noise. WISE 0855-0714 is the only bright source left, and it moves west between the two frames.

**On the other targets.** Epsilon Indi B (T dwarfs) turns dark (strongly negative), because a T dwarf's light peaks near 4 µm, inside the subtracted band. RW Aurigae, a dusty young star, stays bright as a ring around its saturated core, and stars inside its glow keep 28-53 % of their flux. The frames carry a note saying both.

**Limits.** It is a colour selection, not an identification. Anything that is red at these wavelengths can survive: dusty young stars such as RW Aurigae, reddened stars, some galaxies, a star that varied between the two bands' exposures within a visit, or a cosmic-ray hit in one band. Objects whose light peaks near 4 µm, such as the T dwarfs of Epsilon Indi B, turn dark instead of remaining. Bright or saturated stars leave residuals (dark and bright rings, saturated cores that are NaN in one band), because their profiles and saturation differ between the two bands. Everything it shows is a candidate to check in the matched-wavelength frames and the Measure tab.

## 5. How motion and brightness are measured

**Positions.** Cutouts are read on native pixels. Targets with known proper motion are moved to each exposure's date first (Gaia proper motion and parallax for an observer at the Earth's centre; the offset of SPHEREx's low orbit from the Earth's centre is negligible for stars). Centroids are measured on native pixels (for saturated stars, on a ring around the saturated core), averaged per visit with errors from the scatter within the visit, and fitted with a straight line after removing the catalogue parallax. Errors are scaled up when the scatter exceeds them. A motion counts as measured only if it exceeds three times the larger of its error and the median motion of comparison stars measured the same way.

**Brightness.** Aperture photometry on native pixels (radius 2 px, background from a 4-8 px annulus after subtracting the archive's zodiacal-light model), converted with 1 MJy/sr = 23.5044 µJy/arcsec² times the pixel solid angle from the WCS. Errors come from the archive's variance plane when it is loaded, otherwise from the annulus scatter, plus 3 % of the flux. Saturated stars are measured on a ring outside the saturated core; those numbers are relative only. Brightness changes are ratios at matched wavelengths: the same channel, later visit divided by earlier visit, combined with outlier rejection, separately for 0.75-2.4 µm and 2.4-5.0 µm (and per array in the Measure tab). A change counts as significant only above three times the larger of its error, the median change of comparison stars, and 2 %; a ratio whose error is too large reads "too noisy to tell".

**Caveats.**

- *Undersampled PSF.* A star's image is only 1.2-1.5 pixels wide (FWHM), so the peak pixel of a constant star changes with its sub-pixel position. Never judge variability from single pixels or from a difference image alone.
- *Saturation.* Barnard's Star, RW Aurigae and R Draconis saturate. Missing cores stay NaN and are drawn hatched, never filled with zeros. The tool measures them from the wings and says the result is relative.
- *Small motions.* Between two visits six months apart even Barnard's Star moves less than one pixel (about 0.85 px). A mover then shows up as a dark-bright pair (a dipole) in a difference image rather than a jump.
- *Blended neighbours.* WISE 0855 is close to a background star; aperture fluxes and centroids are pulled toward it. Gaia stars within 8 arcsec at any epoch are reported as blended neighbours.
- *Artefacts that jump.* Crosstalk ghosts, the beam-splitter ghost and persistence are fixed to the detector. Because the telescope turns 180 degrees between visits, they appear on the opposite side of a bright star at the next visit and can look like a moving object. Cosmic rays below about 100 electrons, or in the first ten seconds of an exposure, are not flagged.
- *One frame is never evidence.* In the WISE 0855-0714 field, the 2025-11-07 per-visit frame showed a bright compact spot near the edge (RA 133.739, Dec -7.238). It came from one exposure only (4.67 µm, 11.3 MJy/sr) while the other 36 exposures of that visit read about zero there, and no Gaia star or known asteroid is at that position: a cosmic-ray or particle hit. A second one-exposure event of the same kind appeared on 2026-05-02. Because a per-visit frame averaged the channels with a plain mean, such a hit looked like a new source. Per-visit frames now drop a single-channel value when it lies more than 8 robust sigma from the other channels (only with at least 8 channels, and never more than 10 % of them). Single-exposure views ("Same wavelength pairs") are not clipped and can still show such hits.
- *Flags.* About half of all pixels carry the SOURCE flag and about 2 % the OUTLIER flag. Both mark real sky, so TrueBlink never treats them as bad pixels.
- *Backgrounds.* Helium airglow at 1.083 µm can make array 1 channels 16-17 and array 2 channel 1 up to 30 times brighter than the zodiacal light (Explanatory Supplement) and is not removed by the pipeline.

## 6. Asteroids

SPHEREx sees many asteroids, and their spectra have two parts.

- **Reflected sunlight** dominates below about 3.5 µm. Dividing the measured flux by the solar spectrum (after scaling to unit distance and zero phase angle) gives the reflectance spectrum, which carries the mineral bands at 1 and 2 µm.
- **Thermal emission** from the warm surface rises steeply beyond 3.5 µm. A thermal model relates it to size and albedo: the Standard Thermal Model of Lebofsky et al. (1986) uses a fixed beaming parameter η = 0.756, and its near-Earth variant (NEATM, Harris 1998) lets η vary. TrueBlink fits η per visit and draws the model as a band for η 0.8-1.2.

The Research mode Asteroid tab shows four asteroids measured beforehand on real SPHEREx exposures: (10) Hygiea, (349) Dembowska, (433) Eros and (1929) Kollaa. In the browser it divides the measured points by the solar spectrum, compares the 0.85-2.45 µm reflectance with the Bus-DeMeo class means (DeMeo et al. 2009) and reports a broad group, or refuses when the fit is poor. With the rotation (light-curve) correction on: Hygiea comes out C/X-like (catalogue type C), Dembowska R (catalogue R); Eros and Kollaa are refused (reduced chi-squared about 11 for their catalogue classes S and V). The thermal fit gives a beaming parameter of 0.85-0.89 for Hygiea's two visits and 1.05 for Eros; for Dembowska and Kollaa it is refused. A class match means the reflectance is consistent with that group, not that the surface is made of a given material. In our earlier Python analysis Hygiea's 1.2 µm albedo came out 0.073 against a literature value of 0.072.

What cannot be concluded:

- SPHEREx starts at 0.75 µm, so C-type and X-type asteroids cannot be told apart, and subclasses such as Cg, Xc or Xe cannot be assigned. Only broad groups are meaningful.
- Asteroids rotate, so their brightness changes by 4-15 % between exposures. Without a light-curve correction this adds scatter to the spectrum.
- The thermal fit is uncertain: in our earlier analysis the beaming parameter ranged from 0.83 to 1.49, and two visits of Dembowska disagreed. A change of 20 % in that parameter changes the predicted flux at 4-5 µm by about a factor of 2. Sizes from SPHEREx alone are indicative only.
- Bright asteroids (Vesta, Ceres, Iris, often Hebe) saturate.
- A distant Planet-Nine-like body would move 10-14 arcmin between visits and would be 2-4 magnitudes too faint for single SPHEREx exposures. TrueBlink cannot find one and does not claim to.

## Further reading

- SPHEREx Explanatory Supplement: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf
- SPHEREx anomaly image gallery: https://spherex.caltech.edu/page/anomalyimages
- IRSA SPHEREx page: https://irsa.ipac.caltech.edu/Missions/spherex.html
