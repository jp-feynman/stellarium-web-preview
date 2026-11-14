# Project page text (ready to paste)

All text on the project page and in linked material must be in English. Fields follow the 2026 Project Submission Guide. Replace every `REPLACE-ME`, fill every [TEAM] bracket truthfully, and resolve every [VERIFY] before pasting; do not paste the bracketed notes themselves. Only the last saved submission is judged. Seoul deadline: 2026-11-15 23:59 KST; the organisers advise finishing by 23:55.

---

## 1. Project name

1. **TrueBlink** (recommended; the app shows it as "TrueBlink for SPHEREx")
2. **TrueBlink for SPHEREx**
3. **Like with Like: a SPHEREx blink comparator**
4. **SPHEREx Then and Now**

If the team picks another name, change `APP_NAME` and `APP_SHORT_NAME` in `src/app/config.ts` to match.

---

## 2. High-Level Project Summary

(About 1,000 characters; this text is 998. Three paragraphs: what we developed, how it addresses the challenge, why it is important.)

> We developed TrueBlink, a free web tool that blinks NASA SPHEREx infrared images of any patch of sky over time. Type coordinates or a name, or pick a challenge target, and your browser reads the pixels straight from NASA's public archive. Explore mode guides the public through the five targets; Research mode adds photometry, spectra, motion fits, catalogue overlays and a cold-object filter.
>
> SPHEREx sees each star through a filter whose wavelength changes across the detector, so every exposure is at a different wavelength and a time-ordered blink shows colour, not change. TrueBlink builds each frame from the same wavelengths on every date, labels date and wavelength, and measures change on the original pixels.
>
> This makes SPHEREx's motion and variability checkable by anyone. With our code, the motions of Barnard's Star, Epsilon Indi B and WISE 0855-0714 match the catalogues within 4 %, and RW Aurigae's change in brightness depends on colour. Results are candidates, never discoveries.

---

## 3. Link to Project Demo

`https://REPLACE-ME` (30-second screen capture, public or unlisted, no login; storyboard in section 9)

## 4. Link to Final Project

`https://trueblink.pages.dev/` (live site). Source: `https://github.com/REPLACE-ME/trueblink`.

---

## 5. Detailed Project Description

(About 2,000 characters; this text is about 2,100. The guide asks: what does it do, how does it work, what benefits does it have, what do you hope to achieve, what tools and languages did you use.)

> **What it does.** TrueBlink turns SPHEREx's spectral images into an honest time-lapse. For any position it finds every SPHEREx exposure (DR1 and QR3), groups them into visits about six months apart, and blinks one frame per visit built from the channels every visit shares; amber labels give the date, cyan labels the wavelength. A cold-object filter subtracts a scaled 3.8-4.05 µm image from each visit's 4.2-4.8 µm image: ordinary stars cancel, very cold brown dwarfs remain. Research mode adds difference images, photometry on native pixels, spectra, matched-wavelength ratios, motion fits against Gaia DR3, flag maps, a list of every file used, four asteroids, a sky map and a 3D stack.
>
> **How it works.** A static website. The browser reads only the needed rows of each 66 MB Level-2 file from NASA's public S3 bucket with HTTP Range requests, decodes the compressed flags, reprojects each exposure with the full WCS and moves fast-moving stars to each date. A small relay forwards only the IRSA exposure search; the five challenge targets ship with their pixels and open without it. Missing pixels stay missing.
>
> **What we measured (2026-11-14, real DR1 and QR3 pixels, in the browser).** Barnard's Star 10.34 ± 0.95 arcsec/yr (Gaia 10.39); Epsilon Indi B about 4.6 (4.68); WISE 0855-0714, seen only at 3.8-5.0 µm, 7.84 ± 1.00 (8.15). RW Aurigae became about half as bright at 4-5 µm and brighter at the shortest wavelengths. The cold-object filter keeps WISE 0855-0714 at S/N 27 and 33 while field stars cancel. For constant stars, time-ordered single frames differ by a typical factor of 1.24; matched channels by 3.1 %.
>
> **Benefits and hopes.** No install, no account, almost no running cost; anyone can check a claim against the source pixels. We hope it helps people vet movers and variables as new releases arrive.
>
> **Limits.** Bright stars saturate, the PSF is undersampled, and one frame is never evidence (we traced a one-exposure cosmic-ray hit near WISE 0855). Results are candidates, not discoveries.
>
> **Tools.** TypeScript, React, three.js, zustand, Vite, vitest; Cloudflare Pages.

---

## 6. Use of Super Intelligence (SI)

> We used Anthropic's Claude, through the Claude Code tool, during the hackathon (14-15 November 2026, KST); the organisers confirmed that AI may be used to propose solution ideas when its use is disclosed. Claude researched the SPHEREx archive and its documentation (including analysis scripts run on real SPHEREx files), helped us shape and choose the design (including the like-with-like blink and the cold-object filter), designed the architecture and module contracts, wrote and tested nearly all of the code, and drafted the documents and this text. A second AI-assisted planning effort produced docs/VISION_PLAN.md, a roadmap for a later analysis engine that is not built and not part of this submission. [TEAM: who set the goals and constraints in our planning meetings (a blink tool, public and researcher modes, spectra, moving objects, a sky map, three.js, low running cost), and when.] [TEAM: who reviewed the AI's proposals and decided; who tested, deployed and presented.] Every source file starts with a comment stating AI assistance; AI_USE.md in the repository and the tool's About dialog describe the use. No AI-generated images or video are used: all pictures show real data, and the demo is a screen capture of the real tool. No NASA branding was generated.

Keep this text consistent with `AI_USE.md` section 3 after the team fills it in.

---

## 7. NASA Data

One per line, as `[label](url)`:

```
[SPHEREx Data Release 1 Spectral Images (IRSA, doi:10.26131/IRSA678)](https://doi.org/10.26131/IRSA678)
[SPHEREx Quick Release 3 Spectral Images (IRSA, doi:10.26131/IRSA662)](https://doi.org/10.26131/IRSA662)
[SPHEREx DR1 Spectral All-Sky Cube (IRSA, doi:10.26131/IRSA679)](https://doi.org/10.26131/IRSA679)
[SPHEREx at IRSA](https://irsa.ipac.caltech.edu/Missions/spherex.html)
[SPHEREx public S3 bucket nasa-irsa-spherex (AWS Open Data)](https://nasa-irsa-spherex.s3.amazonaws.com/)
[IRSA Simple Image Access service](https://irsa.ipac.caltech.edu/SIA)
[SPHEREx Explanatory Supplement v2.1](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf)
[SPHEREx all-sky HiPS map at IRSA](https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube)
[AllWISE images via IRSA HiPS](https://irsa.ipac.caltech.edu/data/hips/list)
[IRSA SPHEREx tutorial notebooks](https://caltech-ipac.github.io/irsa-tutorials/spherex/)
[JPL Small-Body Database (asteroid catalogue facts)](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html)
```

## 8. Space Agency Partner Data and Other References

```
[ESA Gaia Data Release 3](https://www.cosmos.esa.int/web/gaia/dr3)
[Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1: Gaia DR3](https://doi.org/10.1051/0004-6361/202243940)
[Gaia mission data at MAST](https://archive.stsci.edu/missions-and-data/gaia)
[CDS Sesame, SIMBAD and VizieR (Strasbourg Astronomical Observatory)](https://cds.unistra.fr/)
[IMCCE SkyBoT, Paris Observatory](https://ssp.imcce.fr/webservices/skybot/)
[Bock et al. 2026, the SPHEREx mission](https://doi.org/10.3847/1538-4357/ae2be2)
[Akeson et al. 2026, the SPHEREx data pipeline](https://doi.org/10.3847/1538-4365/ae8843)
[Kirkpatrick et al. 2021, ApJS 253, 7: the 20 pc census (WISE 0855-0714 motion)](https://doi.org/10.3847/1538-4365/abd107)
[DeMeo et al. 2009, Icarus 202, 160: Bus-DeMeo asteroid taxonomy](https://doi.org/10.1016/j.icarus.2009.02.005)
[MIT SMASS Bus-DeMeo class mean spectra](http://smass.mit.edu/)
[Lebofsky et al. 1986, Icarus 68, 239: refined Standard Thermal Model](https://ui.adsabs.harvard.edu/abs/1986Icar...68..239L)
[Harris 1998, Icarus 131, 291: near-Earth asteroid thermal model (NEATM)](https://doi.org/10.1006/icar.1997.5865)
[CALSPEC solar spectrum sun_mod_001 (STScI)](https://archive.stsci.edu/hlsps/reference-atlases/cdbs/current_calspec/)
[WiseView, Backyard Worlds: Planet 9 (model for the blink idea; no code used)](http://byw.tools/wiseview)
[Source code, AI disclosure and licences (Apache-2.0, AI_USE.md, THIRD_PARTY_NOTICES.md)](https://github.com/REPLACE-ME/trueblink)
```

[VERIFY: the Kirkpatrick et al. 2021 and Harris 1998 DOI links open the right papers.]

Partner agency named: ESA (Gaia).

---

## 9. 30-second demo storyboard (screen capture only)

Record the real deployed site at 1920x1080 or 1280x720. No AI-generated footage; voice optional. Burn in English captions (white text, dark band, bottom of the frame). Keep total length 29-30 seconds. Use a fixed stretch so frames do not flash; blink speed 600 ms or slower. Rehearse once so each target has already loaded from its bundle before the cut.

| Time (s) | Screen | Caption |
|---|---|---|
| 0-5 | Landing page in Explore mode, the five challenge-target buttons visible; type "Barnard's Star" in the search box and press Enter | "TrueBlink: NASA SPHEREx infrared images of any patch of sky, over time." |
| 5-12 | Barnard's Star blinking "Dates (same colours)" with "Expected path" on (Overlays): the star steps north; the mission card's Result line reads "We measured ... The catalogue says ..." (10.34 against 10.39 arcsec/yr on our build; use what the deployed site shows) | "Same wavelengths on every date. Measured on NASA's pixels: Barnard's Star moves as the catalogue says." |
| 12-20 | Open WISE 0855-0714 (it opens on mission step 2, "Cold objects (3.8-5.0 µm)"); click step 3 in the mission card ("Cold-object filter"): two frames, 2025-11-07 and 2026-05-02; field stars cancel and WISE 0855-0714 is the only bright source, moving west between them [VERIFY on the deployed site] | "Cold-object filter: 4.2-4.8 µm minus scaled 3.8-4.05 µm. Ordinary stars cancel; the coldest known brown dwarf remains." |
| 20-26 | RW Aurigae, Research mode, Measure tab: the finding "The change depends on colour" and the "Ratio by wavelength range" table (arrays 5 and 6 near 0.5, arrays 1 and 2 above 1) | "RW Aurigae: about half as bright at 4-5 µm, brighter at short wavelengths. Checked against comparison stars." |
| 26-30 | Click quickly through the Research tabs (Frames, Measure, Overlays, Asteroid, Provenance), end on Provenance listing the S3 files; overlay the URL | "Every number from real SPHEREx pixels. Candidates, not discoveries. REPLACE-ME" |

Captions must be burned in (some players hide subtitle tracks). Upload as public or unlisted on YouTube and check the link in a private window.

## 10. Alternative: 7-slide outline

Use only if the video cannot be finished. Seven slides at most, including the title.

1. **Title.** TrueBlink; team name; challenge "Planet X and SPHEREx"; live URL. Screenshot of the tool.
2. **The problem.** SPHEREx's linear variable filter: every exposure is a different wavelength, so a time-ordered blink shows colour. For constant stars, single frames in time order differ by a typical factor of 1.24 (up to about 1.85); matched channels by 3.1 %.
3. **Our approach.** One frame per visit from the same channels; date in amber, wavelength in cyan; photometry on native pixels; pixels read from NASA's S3 bucket in the browser; the five targets ship with their pixels.
4. **Motion.** Barnard's Star blink and difference dipole; 10.34 ± 0.95 against Gaia's 10.39 arcsec/yr. Epsilon Indi B about 4.6 against 4.68; WISE 0855-0714 7.84 ± 1.00 against 8.15 (arrays 5 and 6 only).
5. **Cold objects and colour change.** Cold-object filter frames of WISE 0855-0714 (2 visits; stars cancel, the brown dwarf remains at S/N 27 and 33); its limits (T dwarfs turn dark, dusty young stars stay bright). RW Aurigae's "Ratio by wavelength range" table: about half as bright at 4-5 µm, brighter at the shortest wavelengths by an amount that depends on the ring.
6. **Two audiences.** Explore mode cards and guided steps; Research tabs (Frames, Measure, Overlays, Asteroid, Provenance), sky map and 3D stack; English and Korean.
7. **Honesty and next steps.** Saturation, undersampled PSF, blends, a one-exposure cosmic-ray hit we traced; candidates, not discoveries. Next: new releases, motion-compensated stacking for faint movers, the analysis engine in our roadmap (planned, not built). Data credits and AI disclosure.

---

## 11. How TrueBlink meets the judging criteria

| Criterion (2026 wording, abbreviated) | What we point to |
|---|---|
| **Impact** | Anyone can open real SPHEREx data at any position with no install and no account. The like-with-like method removes false variability from wavelength mixing (constant stars: typical factor 1.24 between time-ordered single frames, 3.1 % at matched channels). English and Korean interface. |
| **Creativity** | Treating SPHEREx's filter as the central problem of a blink tool; date and wavelength labels on every frame; a cold-object filter built from SPHEREx's own narrow channels; browser-only reading of 66 MB archive files by byte ranges; a 3D stack of the frames along time or wavelength. |
| **Validity** (incl. usability) | 374 unit tests pass (4 live-archive tests skipped offline); motions of three targets within 4 % of the catalogues on real data, and scripts anyone can rerun (`scripts/measure-check.ts`, `scripts/audit/like-with-like.ts`); NaN never zero-filled; flags handled per the Explanatory Supplement; refusals when a measurement is not possible, and "too noisy to tell" when a change is smaller than its error; guided Explore mode; works on a phone [VERIFY on the deployed site]. |
| **Relevance** (NASA data as a core component) | Every pixel is SPHEREx DR1 or QR3 Level-2 data read from NASA's archive; the five challenge targets are one click away; DOIs and the SPHEREx acknowledgement are shown in the tool. |
| **Presentation** | 30-second screen-capture demo with English captions; live link; README with a "verify our claims" section, science explainer and deployment guide in the repository. |

## 12. The challenge's "potential considerations"

All of these are optional: the challenge page says "You may (but are not required to) consider the following". Wording below is shortened from the challenge page.

| Consideration on the challenge page | How TrueBlink handles it |
|---|---|
| New SPHEREx data arrives fast; make the tool easy to update with new releases | Met. The app reads the list of SPHEREx collections from IRSA on every search instead of hard-coding release names, so new releases appear without a code change. For the five targets, a background search offers exposures newer than the baked list, and the baked lists and bundles are refreshed with one command (`npx tsx scripts/bake-presets.ts`) or a GitHub Actions workflow. |
| Display the 102 bands creatively; add together the data of each of the six detector arrays to improve signal-to-noise; extra kudos for spectra on the fly | Met. Per-visit frames combine all six arrays, short-wave or long-wave groups, single arrays, or arrays 5+6 for cold objects, always from matched channels. The cold-object filter subtracts one band from another to isolate very cold, methane-absorbing objects. The Measure tab plots a spectrum from every exposure on the fly. A wavelength sweep shows one visit stepped through its channels, labelled as colour, not time. |
| Add together or subtract images taken at different times, to find moving objects | Met. Per-visit stacks, difference against a chosen reference visit, "Then and now", and the 3D stack where a mover is a slanted thread. |
| Let users choose the field of view | Met. A field selector offers 2, 3, 5 and 10 arcmin, and the URL accepts other sizes [VERIFY: the selector on the deployed site]. |
| Overlay data from other telescopes such as Gaia or WISE | Met. Gaia DR3 stars moved to each frame's date, SIMBAD objects, known asteroids (SkyBoT); an AllWISE image as the older epoch in "Then and now" (read from IRSA's HiPS tiles when CDS image services are down, as on 2026-11-14). 2MASS images were unavailable for that reason. |
| Query the tool with coordinates in the URL so it can be embedded | Met. The URL hash holds the position, field, sequence, band, mode, language and frame (`#ra=..&dec=..`); `embed=1` hides the top bar for embedding. |
| Display metadata such as contamination flags | Met. Flag overlays and a flag legend; per-frame notes; an exposure table with release, detector, wavelength and file link; the source of each cutout (saved bundle, cache or archive); SOURCE and OUTLIER are shown but never treated as bad. |
| Use existing tools for handling and displaying astronomical data (Astropy, Aladin) | Partly. We use CDS services (Sesame, SIMBAD, VizieR, HiPS) and IRSA's HiPS maps directly. Astropy was used in our preparatory analysis to check the browser code; Aladin Lite is not used because the blink needs float pixels and a shared stretch across dates. |

Also from the Resources tab: CSA NEOSSat data (optional) is not used; the CADC service did not respond during the hackathon.

## 13. Future work (say so; do not present as built)

`docs/VISION_PLAN.md` is a roadmap, made in a separate AI-assisted planning effort, for a later analysis engine that would search pre-analysed sky regions for moving, variable and unusual-spectrum candidates. None of it is built. If it is mentioned on the project page or in the presentation, call it future work.
