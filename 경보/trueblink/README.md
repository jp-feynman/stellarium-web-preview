# TrueBlink for SPHEREx

TrueBlink is a static web tool that shows NASA SPHEREx infrared images of one patch of sky as a blink over time, so that things that move or change stand out. You enter sky coordinates or a name, or pick one of the five challenge targets, and the browser reads the images directly from NASA's public archive. It was built during the NASA Space Apps Challenge 2026 (14-15 November), challenge "Planet X and SPHEREx".

Live site: `https://trueblink.pages.dev/` (Cloudflare Pages, deployed 2026-11-14). Source: `https://github.com/REPLACE-ME/trueblink` (team: fill in, and set `REPOSITORY_URL` in `src/app/config.ts`).

## The idea

SPHEREx observes the sky through linear variable filters: the wavelength a detector sees changes across its face, and the telescope steps the sky across that filter from one exposure to the next. Every exposure of a given star is therefore taken at a different wavelength. If you put those exposures in time order and blink them, stars brighten and fade because of their colour, not because anything happened. A naive blink shows colour, not change.

TrueBlink compares like with like. It builds one frame per visit from the same set of spectral channels, so every date has the same effective wavelength, and it labels every frame with its date (amber) and its wavelength (cyan). When it measures a change, it does so with photometry on the native detector pixels, comparing the same wavelengths on different dates.

We tested this on real SPHEREx pixels with the project's own code (`scripts/audit/like-with-like.ts`, 2026-11-14), on six constant field stars near RW Aurigae. Time-ordered single frames differ by a typical factor of 1.24 (up to about 1.85). Matched channels across visits differ by 3.1 %. A full-visit stack in one detector is already nearly balanced (3.5 %), but a stack of a random 40 % of the exposures gives 7.3 %. So the false variability comes from blinking single frames, or stacks whose channel mix differs between dates. Details: [docs/SCIENCE.md](docs/SCIENCE.md), section 2.

## What you can do

**Explore mode** is for the public. Pick a target or type a name, and the tool opens a blink of per-visit images built from the same wavelengths. Each challenge target has a mission card: what the object is, what to look for, three guided steps (four for WISE 0855-0714), and how the measurement made in your browser compares with the catalogue value. A "What changed?" list shows the findings, each worded as a candidate. Help cards ("What am I looking at?") explain the instrument artefacts you are likely to see (saturated cores, ghosts, cosmic rays, features that jump when the telescope turns 180 degrees between visits).

**Research mode** gives full control of the sequence ("Dates (same colours)", "Same wavelength pairs", "Colour sweep (not time)", "Difference", "Then and now", and "Cold-object filter", described below), the wavelength group (all, short, long, cold objects 3.8-5.0 µm, or one array), the field of view (2, 3, 5 or 10 arcmin), the stretch and colour map, and the overlays (Gaia DR3 stars moved to each date, the target's predicted path, flagged pixels, known asteroids from IMCCE SkyBoT). Its tabs, all running on the loaded SPHEREx pixels:

- **Frames**: every exposure covering the position, time against wavelength, and which ones the current frame uses.
- **Measure**: aperture photometry on native pixels (wing photometry for saturated stars), the spectrum, a per-visit light curve against comparison stars, the ratio of the last to the first visit channel by channel and as a table split into 0.75-2.4 µm and 2.4-5.0 µm and per array, and a proper-motion fit compared with the catalogue.
- **Overlays**: flag statistics and legend (SOURCE and OUTLIER are shown but never removed), the Gaia stars in the field.
- **Asteroid**: four asteroids measured beforehand on real SPHEREx exposures ((10) Hygiea, (349) Dembowska, (433) Eros, (1929) Kollaa): reflectance compared with the Bus-DeMeo class means, a thermal model of their own heat glow, and the known Solar System objects in the current field.
- **Provenance**: releases, collections, processing tags, where each cutout came from (saved bundle, browser cache or live archive) and the list of files used, with CSV and JSON export.

**Cold-object filter** (sequence picker, URL `seq=coldFilter`, step 3 of the WISE 0855-0714 mission). For each visit, TrueBlink stacks the exposures at 4.2-4.8 µm and subtracts a scaled stack of the exposures at 3.82-4.05 µm. Ordinary stars follow the Rayleigh-Jeans tail at these wavelengths, so they cancel; objects with deep methane absorption that shine mainly beyond about 4.2 µm, such as the Y dwarf WISE 0855-0714, remain. The app uses the Rayleigh-Jeans scale (about 0.77) by default. Only visits with at least 3 exposures in both bands make a frame. On WISE 0855-0714 that is 2 of its 4 visits (2025-11-07 and 2026-05-02): the target stays at S/N 26.9 and 32.9 (42.4 and 59.9 in the 4.2-4.8 µm stack alone), a G = 16.3 field star cancels to within about 2-17 % of its flux (fainter stars are noise-dominated), and WISE 0855-0714 is the only bright source left, moving west between the two frames. It is a colour selection, not an identification: T dwarfs such as Epsilon Indi B turn dark (their light peaks near 4 µm), dusty young stars such as RW Aurigae stay bright, and residuals remain near bright or saturated stars.

Two more views: a **sky map** of the SPHEREx all-sky cube (one of 102 colours, a yearly average, so it cannot show change; pick a spot to blink it) and a **3D stack** that piles the frames along time or wavelength, so a star is a vertical thread and a mover a slanted one.

The view is stored in the URL, so a link reproduces what you see, and `embed=1` hides the top bar for embedding. The interface is in English, with Korean available from the language switch.

### Team planetarium integration (v2.1.0)

The combined site hosts this app at `analysis/` and opens a complete analysis panel from the planetarium with:

```text
analysis/#ra=101.287155&dec=-16.716116&label=시리우스&mode=research&lang=ko&embed=panel
```

RA and Dec are ICRF degrees; `fov` remains arcseconds. `label` is display text only, so a Korean object name does not trigger a catalogue name lookup or change the selected coordinates. `embed=panel` keeps the spectrum, measurement, frame and provenance controls. The return button (or Escape) cancels ongoing analysis and sends `{ type: 'spherex-analysis-close' }` to the same-origin parent. Without a parent, it opens `VITE_SKY_APP_URL` instead. Set that build variable to `../planetarium/` for the combined site. The parent must check the message origin and source before closing its drawer.

The server must serve the SIA relay at `/api/sia` (build with `VITE_API_BASE=../api`) or at `/analysis/api/sia`. Arbitrary selected coordinates require this live search and an internet connection; absent observations and network failures remain explicit states, not synthetic results. The saved challenge-target bundles remain available through the original search interface.

## How it works

- **Pixels come straight from NASA.** SPHEREx Level-2 images are public in the AWS S3 bucket `nasa-irsa-spherex`, which allows cross-origin requests. Each image file is about 66 MB, but the browser downloads only what it needs: the headers, then a small window of rows from the image, flags, variance and background planes, using HTTP Range requests. A 120 arcsec cutout takes a few requests and a few hundred kilobytes. The flags plane is Rice-compressed in the archive files and is decoded in the browser.
- **One small relay for the search.** The list of exposures that cover a position comes from IRSA's SIA service, which sends no CORS headers. A stateless relay (`functions/api`) answers only `GET /api/sia`, passes on only the SIA parameters the app uses, and caches answers for an hour; every other path returns 404.
- **Baked lists and pixel bundles for the five challenge targets.** `public/presets/<id>.json` holds the exposure lists for the five targets (and three extra fields), and `public/presets/<id>.bundle.json` + `.bundle.bin` hold their native IMAGE and FLAGS pixels (gzip, 2.9-5.2 MB each, read from the S3 bucket on 2026-11-14; all exposures for Barnard's Star, WISE 0855-0714 and RW Aurigae, 420 for Epsilon Indi B and R Draconis, chosen to keep every channel of every visit). The five targets therefore show their first frame in about a second and finish their measurements in 3-6 seconds, without the relay or the archive; a background search then offers newer exposures if the live archive has them. Other positions, other planes (VARIANCE, ZODI) and fields larger than 3 arcmin are read live from S3 and cached in the browser (IndexedDB); a 5 arcmin field of about 330 exposures took about 40 s on our test connection.
- **Wavelength at every pixel.** The tool computes the channel and wavelength of each exposure at the target from the archive's own wavelength tables, and only combines frames that share channels.
- **Positions move.** Targets with high proper motion are moved to each observation date before cutting. The challenge's coordinates for WISE 0855-0714 are about 2 arcmin (20 SPHEREx pixels) from where the object was during the SPHEREx survey.
- **No data is not zero.** Missing or saturated pixels stay NaN and are drawn hatched; they are never filled with zeros. The SOURCE and OUTLIER flag bits are never treated as bad pixels (SOURCE marks about half of all pixels).
- **One frame is never evidence.** In the WISE 0855-0714 field, a bright compact spot appeared in one visit's frame. We traced it to a single 4.67 µm exposure; the other 36 exposures of that visit show nothing there, and there is no star at that position: a cosmic-ray or particle hit. Per-visit frames now reject single-channel values far outside the other channels (a conservative cross-channel clip). This is also why changes are measured with photometry over many exposures at matched wavelengths, never from one frame.

Rendering uses three.js (WebGL 2) with a 2D canvas fallback. The interface uses React and zustand. The core science code (FITS reading, WCS, stacking, photometry, astrometry, asteroid models) is plain TypeScript with unit tests. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module contracts and [docs/SCIENCE.md](docs/SCIENCE.md) for the science.

## Quick start

You need Node.js 20.19 or newer (Vite 7 requires it). The project was built and tested with Node 26.

```bash
npm install
npm run dev        # development server at http://localhost:5173 (Vite proxies /api/sia to IRSA)
npm test           # unit tests (vitest), offline
npm run build      # type check and production build into dist/
npm run preview    # serve dist/ locally (relays /api/sia like the dev server)
```

Optional:

```bash
npm run test:live                    # tests against the real archive (network, slow; POSIX shell)
npm run bake                         # refresh the baked exposure lists and pixel bundles (tsx scripts/bake-presets.ts)
npm run relay                        # self-hosted relay on port 8787; build with VITE_API_BASE=https://<host>/api
npm run smoke -- https://<site>      # post-deploy check of the page, bundles, relay and S3
```

Deployment is described step by step in [docs/DEPLOY.md](docs/DEPLOY.md).

## How to verify our claims yourself

Every number we quote was measured with this repository's own code on real SPHEREx DR1 and QR3 pixels. You can repeat the runs:

```bash
npm test                                               # unit tests (offline): 374 passed, 4 skipped (live relay tests)
npx tsc --noEmit                                        # type check: no output

npx tsx scripts/measure-check.ts barnard               # also: epsIndB, wise0855, rwaur, rdra
# Reads up to 200 real cutouts per target from the S3 bucket and Gaia DR3 from VizieR, runs the app's
# measurement module in Node and prints motion, brightness ratios and comparison stars.
# Cutouts are cached in node_modules/.measure-cache/<id>-200-240.v8.

npx tsx scripts/audit/like-with-like.ts rwaur node_modules/.measure-cache/rwaur-200-240.v8
# The like-with-like experiment: field stars compared four ways (matched channels, full-visit stack,
# 40 % stack, time-ordered single frames). Pixels come from the baked bundles; the cache supplies Gaia stars.

npx tsx scripts/audit/ratio-rows.ts rwaur node_modules/.measure-cache/rwaur-200-240.v8
# The per-array brightness ratios (shows RW Aurigae's colour change).
```

What you should see (2026-11-14; later runs may include newer exposures). The browser column is what the app shows from the baked bundles; the command-line check uses a wider 240 arcsec field and up to 200 cutouts, so decimals differ.

| Target | In the browser | Command-line check | Catalogue |
|---|---|---|---|
| Barnard's Star, proper motion | 10.34 ± 0.95 arcsec/yr | 10.33 ± 0.94 | 10.39 (Gaia DR3) |
| Epsilon Indi B, proper motion | about 4.6 arcsec/yr | 4.57 ± 0.08 | 4.68 (Gaia DR3) |
| WISE 0855-0714, proper motion (arrays 5 and 6 only) | 7.84 ± 1.00 arcsec/yr | 7.84 ± 1.00 | 8.15 (Kirkpatrick et al. 2021) |
| Barnard's Star, brightness | no change measured: ratio 0.97 ± 0.015, "stayed the same within 17 %" (one comparison star) | 0.98 ± 0.03 | not variable |
| Epsilon Indi B, brightness | stayed the same within 6 % | 1.04 ± 0.03 | - |
| WISE 0855-0714, brightness | too noisy to tell (1.20 ± 0.47) | - | - |
| RW Aurigae, brightness 2026-09 / 2025-09 | depends on colour: about half as bright at 3.8-5 µm (arrays 5 and 6: 0.47 and 0.49), 27 % brighter at 1.1-1.6 µm; 0.75-2.4 µm +6.2 % (3-5.5 px ring) or +2.7 % (5-7.5 px ring); 2.4-5.0 µm 51 % fainter; comparison stars changed by 7.1 % | arrays 5 and 6: 0.48 and 0.49; array 1: 1.55 (another ring) | strongly variable |
| R Draconis, brightness | low confidence (saturated, no clean comparison star) | low confidence | Mira variable |

The robust statement for RW Aurigae is "about half as bright at 4-5 µm". At the shortest wavelengths it became brighter by an amount that depends on where it is measured (a few per cent to tens of per cent), because its core is saturated.

## Project layout

```
src/core/       plain TypeScript, no DOM, unit-tested
  fits/         Level-2 file layout, HTTP Range reads, Rice decoder
  wcs/ wave/    sky coordinates (TAN + SIP) and wavelength per pixel
  archive/      exposure search (SIA), visit grouping, presets
  coords/ resolve/   coordinate parsing, name resolution (CDS Sesame)
  frames/ stack/     cutouts, reprojection, like-with-like sequences, cold-object filter (stack/spectral.ts)
  phot/ astrometry/  aperture photometry, centroids, proper-motion fits
  catalogs/     Gaia, SIMBAD, SkyBoT, external survey images
  solar/        asteroid reflectance, thermal model, Bus-DeMeo groups
  bundle/ cache/     pixel bundles for the presets, IndexedDB cutout cache
src/gl/         three.js views: BlinkStage, SkyGlobe, CubeView
src/app/        React interface, store, URL state, English and Korean text
  pipeline/     search -> load -> reproject -> sequence, on real data
  measure/ research/ asteroid/ views/   Research tabs, findings, sky map and 3D stack
functions/api/  Cloudflare Pages Function: the /api/sia relay
functions/hips/ Cloudflare Pages Function: /hips/spherex/<channel>/, one SPHEREx wavelength as an ordinary HiPS
scripts/        bake-presets.ts, measure-check.ts, relay.mjs, serve.mjs, hips-rewrite.mjs, build-site.mjs, smoke.mjs, audit/ (science checks)
public/data/    small tables: wavelength lookups, channels, solar spectrum, asteroid class means
public/presets/ baked exposure lists and pixel bundles for the challenge targets
tests/          unit tests; tests/live hits the real archive (LIVE=1)
e2e/            headless-browser checks (playwright-core)
docs/           architecture, science, deployment, submission text, Korean guides
```

`docs/VISION_PLAN.md` is a separate roadmap for a later analysis engine. It is planning only; nothing in it is part of the tool described here.

## Live sky (separate app, optional)

The deployed site can also host, under `/sky/`, a separate program: the team's **Stellarium Web Lab + SPHEREx** planetarium (a teammate's Stellarium Web Lab v1.2.0 on the Stellarium Web Engine by the Stellarium team, adapted by the team; AGPL-3.0, source offered from within that app and in the team repository). It draws the same SPHEREx all-sky imagery, one wavelength at a time, on the real-time sky above a place on Earth and on an all-sky map. That imagery is a year-long average, so it cannot show change; blinking is what TrueBlink is for. When `/sky/` is present, TrueBlink shows **See it in the live sky** for the current field; the sky app links back with "blink this spot". TrueBlink contains none of the sky app's code. This repository adds `functions/hips` (`/hips/spherex/<channel>/`), which presents each SPHEREx wavelength as an ordinary HiPS for that viewer. How to build and deploy both: [docs/DEPLOY.md](docs/DEPLOY.md#combined-site-trueblink-plus-the-live-sky-app-under-sky).

## Data sources and citations

| Data or service | Provider | Citation | Used for |
|---|---|---|---|
| SPHEREx DR1 Spectral Images | NASA / JPL-Caltech / IPAC, at IRSA | doi:[10.26131/IRSA678](https://doi.org/10.26131/IRSA678) | every image in the blink (surveys 1 and 2, April 2025 to May 2026) |
| SPHEREx Quick Release 3 Spectral Images | NASA / JPL-Caltech / IPAC, at IRSA | doi:[10.26131/IRSA662](https://doi.org/10.26131/IRSA662) | the newest visits, from May 2026 |
| SPHEREx DR1 Spectral All-Sky Cube | NASA / JPL-Caltech / IPAC, at IRSA | doi:[10.26131/IRSA679](https://doi.org/10.26131/IRSA679) | the all-sky navigator (through IRSA's HiPS tiles) |
| Gaia Data Release 3 | ESA, Gaia DPAC | Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1, doi:10.1051/0004-6361/202243940 | star positions and proper motions |
| AllWISE | NASA / JPL-Caltech / IPAC, at IRSA | doi:10.26131/IRSA1 [VERIFY: this DOI is for the AllWISE catalogue; cite the image set if a separate DOI exists] | 2010 infrared images as a long time baseline |
| 2MASS | University of Massachusetts / IPAC, at IRSA | doi:10.26131/IRSA2 [VERIFY: as for AllWISE] | 1998-2001 near-infrared images |
| CDS Sesame, SIMBAD, VizieR, HiPS | CDS, Strasbourg Astronomical Observatory | https://cds.unistra.fr/ | names to coordinates, catalogue queries |
| SkyBoT | IMCCE, Paris Observatory | https://ssp.imcce.fr/webservices/skybot/ | known asteroids and comets in the field |
| SPHEREx Explanatory Supplement v2.1 | IRSA | https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf | instrument facts, flags, artefacts |

Gaia and SIMBAD are reached through the CDS VizieR and SIMBAD mirrors (Harvard and IDIA) when the Strasbourg hosts are unavailable.

Papers whose methods we implemented: DeMeo, Binzel, Slivan and Bus (2009), "An extension of the Bus asteroid taxonomy into the near-infrared", Icarus 202, 160-180, doi:10.1016/j.icarus.2009.02.005 (class mean spectra from MIT SMASS); Lebofsky et al. (1986), Icarus 68, 239, the refined Standard Thermal Model; the near-Earth asteroid thermal model (NEATM) of Harris (1998), Icarus 131, 291. WISE 0855-0714's catalogue motion: Kirkpatrick et al. (2021), ApJS 253, 7. Mission papers: Bock et al. 2026, ApJ 999, 139, doi:10.3847/1538-4357/ae2be2; Akeson et al. 2026, ApJS 285, 67, doi:10.3847/1538-4365/ae8843.

**SPHEREx acknowledgement.** This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

**IRSA acknowledgement.** This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.

**Gaia acknowledgement.** This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.

Libraries and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Limits and honesty

- TrueBlink shows and measures; it does not discover. Anything it highlights is a candidate that is consistent with motion or variability and needs checking. It makes no claim about Planet X.
- At most sky positions, SPHEREx has two visits per year, six months apart (two or three in DR1 + QR3 so far; many more near the ecliptic poles). Even Barnard's Star shifts by less than one 6.15 arcsec pixel between visits, so motion often appears as a dark-bright pair in a difference image rather than a jump.
- The point-spread function is undersampled (1.2-1.5 pixels wide), so the brightest pixel of a constant star changes depending on where it falls on the pixel grid (it holds 23-66 % of the flux on array 3). Single-pixel changes are not variability; TrueBlink uses aperture photometry instead.
- Barnard's Star, RW Aurigae and R Draconis saturate the detectors. Their cores are flagged or missing; the tool measures them on a ring around the core and labels the result relative. R Draconis's results are low confidence (its halo also covers the nearby comparison stars).
- WISE 0855-0714 is detectable only at 3.8-5.0 µm, at about 4 sigma per exposure, and in 2025-2026 it passes within a few arcseconds of a background star (Gaia G = 16.3; closest measured 4.2 arcsec) that dominates the shorter wavelengths.
- The cold-object filter selects by colour; it does not identify. A red galaxy, a dusty young star (RW Aurigae stays bright), a variable star or an artefact can survive it, T dwarfs such as Epsilon Indi B turn dark, and bright or saturated stars leave residuals. A source it shows is a candidate to check.
- A single exposure is never evidence: cosmic-ray hits and other one-off events look like new sources (see "One frame is never evidence" above). Artefacts tied to the detector (ghosts, crosstalk, persistence) move to the other side of a bright star when the telescope turns 180 degrees between visits, and can look like a moving object.
- Absolute fluxes from our aperture photometry may be a few per cent low (Gaussian aperture correction; the real PSF has broader wings). Ratios between dates are not affected.
- Asteroid classification is limited to broad groups; SPHEREx's 0.75-2.4 µm range cannot separate C-type from X-type asteroids, and rotation adds scatter of several per cent.
- Anything not measured from real SPHEREx data carries a visible DEMO label. The app runs on the real pipeline; synthetic images appear only in development and tests, labelled DEMO.
- Brightness findings are split into 0.75-2.4 µm and 2.4-5.0 µm, so a colour-dependent change such as RW Aurigae's is reported as one. A change smaller than its error reads "too noisy to tell". For saturated stars the finding says how the short-wavelength number depends on the ring used; such numbers are relative.
- External survey images: on 2026-11-14 the CDS image services were down, so "Then and now" shows its AllWISE frame through a fallback that reads IRSA's HiPS tiles, and 2MASS frames are unavailable.

## AI assistance

Anthropic's Claude, used through Claude Code during the hackathon, did most of the work on this repository: research of the archive and its documentation, help in shaping and choosing the design (including the like-with-like blink and the cold-object filter), the architecture and module contracts, nearly all of the code and tests, and drafts of the documents. A separate AI-assisted planning effort produced `docs/VISION_PLAN.md`. Every source file starts with a comment saying so. What the AI did and what the team did is set out in [AI_USE.md](AI_USE.md). No AI-generated images or video are used.

## Licence

Apache License 2.0. See [LICENSE](LICENSE). Data products remain under their providers' terms; SPHEREx and other IRSA data are public with no usage restrictions.
