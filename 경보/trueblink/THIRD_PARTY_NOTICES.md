# Third-party notices

TrueBlink's own code is licensed under the Apache License 2.0 (see `LICENSE`). It depends on the open-source software and the public data listed below. Each keeps its own licence or terms; nothing here changes them.

## Software

Versions are those installed from `package-lock.json` on 2026-11-14.

| Package | Version | Licence | Use | Source |
|---|---|---|---|---|
| three.js (`three`) | 0.180.0 | MIT | WebGL rendering of the blink, the all-sky globe and the cube view | https://github.com/mrdoob/three.js |
| React (`react`, `react-dom`) | 19.x | MIT | user interface | https://github.com/facebook/react |
| zustand | 5.x | MIT | application state | https://github.com/pmndrs/zustand |
| Vite | 7.x | MIT | development server and build | https://github.com/vitejs/vite |
| `@vitejs/plugin-react` | 5.x | MIT | React support for Vite | https://github.com/vitejs/vite-plugin-react |
| TypeScript | 5.9.x | Apache-2.0 | type checking and compilation | https://github.com/microsoft/TypeScript |
| vitest | 3.x | MIT | unit tests (development only) | https://github.com/vitest-dev/vitest |
| playwright-core | 1.x | Apache-2.0 | headless-browser checks (development only) | https://github.com/microsoft/playwright |
| tsx | 4.x | MIT | runs the TypeScript scripts: bake, measure-check, audits (development only) | https://github.com/privatenumber/tsx |
| `@types/*` (node, react, react-dom, three) | various | MIT | type definitions (development only) | https://github.com/DefinitelyTyped/DefinitelyTyped |

The MIT and Apache-2.0 licence texts of these packages are included in their distributions under `node_modules/<package>/LICENSE`. Only three.js, React, React DOM and zustand are bundled into the published site.

No fonts, icon sets, images or 3D models from third parties are bundled. The interface uses the system font stack.

## Data and services

| Data or service | Provider | Terms | How TrueBlink uses it |
|---|---|---|---|
| SPHEREx Level-2 spectral images (DR1, doi:10.26131/IRSA678; QR3, doi:10.26131/IRSA662), calibration files, all-sky cube (doi:10.26131/IRSA679) and HiPS maps | NASA / JPL-Caltech / IPAC, NASA/IPAC Infrared Science Archive (IRSA) | public, no usage restrictions (https://irsa.ipac.caltech.edu/data_use_terms.html); acknowledgement and DOIs requested | pixels read live from the AWS bucket `nasa-irsa-spherex`; exposure search through IRSA SIA; static wavelength and channel tables in `public/data/` derived from the DR1 calibration files |
| AllWISE and 2MASS images (HiPS tiles mirrored at IRSA) | NASA / JPL-Caltech / IPAC; University of Massachusetts / IPAC | public | older epochs for comparison, fetched at run time, never copied into this repository |
| Gaia Data Release 3 | ESA, Gaia Data Processing and Analysis Consortium (DPAC) | free use with the Gaia acknowledgement (see `README.md`) | positions, proper motions, parallaxes and magnitudes, queried at run time through VizieR |
| Sesame, SIMBAD, VizieR, hips2fits and HiPS services | CDS, Strasbourg Astronomical Observatory (with the Harvard and IDIA mirrors) | free use with acknowledgement of CDS | name resolution and catalogue queries at run time |
| SkyBoT | IMCCE, Paris Observatory | free use with acknowledgement of IMCCE | known Solar System objects in the field at run time |
| Bus-DeMeo class mean spectra | MIT SMASS (http://smass.mit.edu/), from DeMeo et al. 2009, Icarus 202, 160-180, doi:10.1016/j.icarus.2009.02.005 | published scientific data, cited | `public/data/busdemeo_class_means.json` (24 class means plus Xn, converted to JSON) |
| CALSPEC solar model `sun_mod_001` | Space Telescope Science Institute (CALSPEC) | public | `public/data/solar_spectrum.json`, resampled to SPHEREx resolution for asteroid reflectance |
| JPL Small-Body Database (SBDB) | NASA JPL Solar System Dynamics | public | catalogue facts of the four asteroids (type, diameter, albedo, H, G, rotation period), retrieved once during research and stored in `public/data/asteroids/*.json`; the app makes no JPL requests |

The SPHEREx, IRSA and Gaia acknowledgement sentences are reproduced in `README.md` and in the tool's About dialog.

## Separate program hosted on the same site: the live-sky app under /sky/

When the site is built with `npm run build:site`, it also hosts, under `/sky/`, a separate program: **Stellarium Web Lab + SPHEREx**, the team's adaptation of a teammate's Stellarium Web Lab v1.2.0, built on the Stellarium Web Engine by the Stellarium team (https://github.com/Stellarium/stellarium-web-engine). It is licensed under the GNU Affero General Public License v3.0 only; its licence, notices and complete source are offered from within that app and in the team repository. TrueBlink itself contains none of its code: the two programs only link to each other with URLs (TrueBlink opens `./sky/?ra=..&dec=..`, the sky app opens TrueBlink at `#ra=..&dec=..`). The `/hips/spherex/` function in this repository (`functions/hips`, `scripts/hips-rewrite.mjs`, Apache-2.0) serves SPHEREx all-sky HiPS tiles from IRSA, one wavelength at a time.

## Related work reviewed

WiseView, the image blinker of the Backyard Worlds: Planet 9 citizen-science project (Caselden, Westin, Meisner, Kuchner and Colin; https://github.com/backyardworlds/wiseview, Unlicense; ASCL 1806.004), was studied as the model for a public blink tool: URL-encoded state, a default view that already shows a mover, difference images and catalogue overlays. TrueBlink uses none of its code.

During research, the AI assistant (see `AI_USE.md`) reviewed four public repositories that other people had published for the 2026 "Planet X and SPHEREx" challenge: SPHEREx Blink (pythonhack000/spherex-blink), Driftnet (epsretriever/spherex-planet-x), SkyTrace (ZelalemAzmera/skytrace) and NOVAX (englszz/novax-space-data-lab) [VERIFY: whether these are registered 2026 entries]. They were reviewed to find pitfalls in the archive and in blink methods (for example wavelength mixing and zero-filled saturated pixels). No code, data, tiles or other assets from them are used in TrueBlink. [Team: add here if team members read them too.]
