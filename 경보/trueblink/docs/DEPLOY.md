# Deploying TrueBlink

Step-by-step instructions for people who have never deployed a website. Plan on about 30 minutes the first time.

TrueBlink is a static site (the `dist/` folder that `npm run build` makes) plus one small relay for the IRSA exposure search. The images are not relayed: each visitor's browser reads them straight from NASA's public S3 bucket. Judging runs until 2027-01-26, so the link has to keep working for about ten weeks with nobody looking after it. Cloudflare Pages is the recommended host because it never puts the site to sleep and runs the relay as part of the same site.

**Short version.** (1) `git init`, first commit, push to a new public GitHub repository. (2) Cloudflare Pages > Connect to Git: build command `npm run build`, output `dist`, environment variable `NODE_VERSION=26`, no `VITE_API_BASE`. (3) `npm run smoke -- https://<project-name>.pages.dev` must print "All checks passed". (4) Before submitting: `npm run bake` (same as `npx tsx scripts/bake-presets.ts`), `npm test`, commit, push, smoke again. The sections below explain each step.

## What the site needs

| Part | Where it runs | What happens without it |
|---|---|---|
| Static files (`dist/`) | any static host | nothing works |
| `GET /api/sia` relay to `https://irsa.ipac.caltech.edu/SIA` | Cloudflare Pages Function (`functions/api/[[route]].ts`), or `scripts/relay.mjs` on any Node host | new positions cannot be searched. The five challenge targets still open, because their exposure lists and pixel bundles are baked into `public/presets/`. |
| Pixels from `nasa-irsa-spherex.s3.amazonaws.com` | the visitor's browser | the five challenge targets still show their baked pixels; everything else has no images |
| Name resolution and catalogues (CDS, IMCCE) and HiPS sky tiles (IRSA) | the visitor's browser | names cannot be resolved (coordinates still work); overlays and the sky map are missing |

The relay is deliberately narrow. It answers only `GET /api/sia`, passes on only the SIA parameters the app uses (`COLLECTION` with `spherex_*` names, `POS`, `RESPONSEFORMAT`, `MAXREC`, `TIME`, `BAND`), refuses answers over 16 MB, waits at most 25 s for IRSA, sends a generic User-Agent and none of the visitor's headers, and adds `Access-Control-Allow-Origin: *`. Successful answers are cached for an hour (`Cache-Control: public, max-age=3600`); errors are never cached. There is no JPL Horizons route: the app does not need one, and JPL asks that its APIs not be embedded in web sites.

## Step 1. Put the code on GitHub

Space Apps requires the project to be made during the hackathon, so the repository's first commit must be made during the hackathon window (before 2026-11-15 23:59 KST). Do not copy in an older repository's history.

1. Sign in at https://github.com and open https://github.com/new.
2. Repository name: `trueblink`. Visibility: **Public** (the judges must open it without logging in). Do **not** tick "Add a README", ".gitignore" or "license": the project already has them.
3. Choose **Create repository**. Leave the page open; it shows the repository address.
4. In a terminal, in the project folder (the one that contains `package.json`):

   ```bash
   git init
   git add .
   git status            # node_modules/ and dist/ must NOT be listed (.gitignore excludes them)
   git commit -m "TrueBlink for SPHEREx (NASA Space Apps Challenge 2026)"
   git branch -M main
   git remote add origin https://github.com/<your-account>/trueblink.git
   git push -u origin main
   ```

   If `git commit` complains that it does not know who you are, run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` once and repeat the commit.
5. Reload the GitHub page: you should see the files and the README. The baked data in `public/presets/` (about 30 MB, largest file 5.3 MB) is well within GitHub's limits.

GitHub Actions starts the **CI** workflow (`.github/workflows/ci.yml`: type check, unit tests, build) on every push. A green tick next to the commit means it passed.

## Step 2. Create the Cloudflare Pages site

You need a free Cloudflare account (https://dash.cloudflare.com/sign-up). No credit card and no API key are needed.

1. Log in at https://dash.cloudflare.com and open **Workers & Pages** in the left menu.
2. Choose **Create** (or **Create application**). Cloudflare's menus change from time to time: you want **Pages**, then **Connect to Git** / **Import an existing Git repository**. If the page only offers Workers, look for the link "Looking to deploy Pages? Get started".
3. Connect your GitHub account when asked, allow access to the `trueblink` repository, select it and choose **Begin setup**.
4. Enter exactly:

   | Setting | Value |
   |---|---|
   | Project name | `trueblink` (becomes `https://trueblink.pages.dev`; if taken, Cloudflare adds a suffix) |
   | Production branch | `main` |
   | Framework preset | **None** (choosing **Vite** is also fine; the two lines below are what matter) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | leave empty |
   | Environment variables | `NODE_VERSION` = `26` |

   Node 26 is the version this project was built and tested with (TypeScript check, the full unit test suite, build, and the relay against live IRSA). Vite 7 needs Node 20.19 or newer; 22 or 24 should also work but were not tested.
   Do **not** set `VITE_API_BASE` here. Without it the app calls `./api/sia` on its own site, which is the Pages Function.
5. Choose **Save and Deploy**. The first build takes two to four minutes. `npm run build` runs the TypeScript check first, so a type error stops the deployment: open the build log, fix the error, push again.
6. Cloudflare finds the `functions/` folder at the repository root on its own and serves `functions/api/[[route]].ts` at `/api/*`. There is nothing to configure.
7. The site is now at `https://<project-name>.pages.dev`. Every push to `main` redeploys it; pushes to other branches get their own preview address.

The file `public/_headers` sets caching for the static files: content-hashed scripts under `/assets/` are cached for a year, `/presets/*` and `/data/*` for a day, and `index.html` is always revalidated, so a new deployment shows up at once. It sets no header that limits cross-origin requests, so S3, IRSA, CDS and IMCCE requests are unaffected. No redirect or rewrite rule is needed: the app keeps its state in the URL hash (`#name=...`), which never reaches the server, so every link loads `index.html`.

## Step 3. Check the deployed site

From the project folder:

```bash
npm run smoke -- https://<project-name>.pages.dev
```

It needs no extra packages. Expected output (numbers vary):

```
PASS  The page opens - HTTP 200, 964 bytes, 31 ms
PASS  Baked exposure list (presets/barnard.json) - 358 exposures, baked 2026-11-14, 4 ms
PASS  Baked pixel bundle (presets/barnard.bundle.json and .bin) - 358 cutouts, 2.9 MB binary, 5 ms
PASS  Relay answers /api/sia?MAXREC=0 with the SPHEREx collections - spherex_dr1, spherex_qr3; 600 ms
PASS  Exposure search through the relay (WISE 0855-0714) - 258 rows from spherex_dr1, 2325 ms, Cache-Control: public, max-age=3600
PASS  SPHEREx S3 bucket answers a Range request (from this network) - 206, FITS header, CORS *, 720 ms

All checks passed.
```

The command exits with an error if any line says FAIL. What a FAIL means:

- **"got the app page instead of the relay"**: the function was not deployed. The folder must be called `functions` (lower case) and sit next to `package.json`. Redeploy.
- **"Baked exposure list ... got an HTML page"**: the build output directory is not `dist`, or `public/presets/` was not committed.
- **"SPHEREx S3 bucket"**: your own network blocks AWS. The site may be fine; try from another network or a phone hotspot.

You can also open `https://<project-name>.pages.dev/api/sia?MAXREC=0` in a browser: it should show an XML document naming `spherex_dr1` and `spherex_qr3`. `https://<project-name>.pages.dev/api/tap` should say `Not found. This relay only serves /api/sia.`

## Fallback: GitHub Pages, with or without a separate relay

Use this only if Cloudflare Pages is not possible. GitHub Pages serves static files only, so it cannot run the relay.

1. On GitHub: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
2. **Actions** tab > **GitHub Pages fallback** > **Run workflow** (`.github/workflows/pages.yml`).
   - Leave **api_base** empty for a site with no relay. Then only the five challenge targets (and the other baked presets) open; searching any other position fails after one request with "The archive search relay is not set up on this site." and a message offering the five targets.
   - Or enter the address of a relay hosted elsewhere, ending in `/api`, for example a Cloudflare Pages site (`https://<project-name>.pages.dev/api`) or a Node relay (below). Then every search works.
3. The site appears at `https://<your-account>.github.io/trueblink/`. The build uses relative paths, so the sub-folder is fine. Check it with `npm run smoke -- https://<your-account>.github.io/trueblink/ --no-relay` (or `--relay <relay>/api`).

### Running the relay yourself

`scripts/relay.mjs` is the same relay as a dependency-free Node server (Node 18 or newer):

```bash
PORT=8787 HOST=0.0.0.0 npm run relay        # HOST defaults to 127.0.0.1 (this machine only)
curl 'http://localhost:8787/api/sia?MAXREC=0'
```

A public site on `https://` can only call a relay on `https://`, so put the relay behind HTTPS (most Node hosts do this for you). Then build the site with its address:

```bash
VITE_API_BASE=https://<relay-host>/api npm run build
```

and upload `dist/` to any static host. Avoid free hosts that put idle servers to sleep: the first search after a sleep would time out.

## Combined site: TrueBlink plus the live-sky app under /sky/

The site can also host a separate program, the team's **Stellarium Web Lab + SPHEREx** sky app (AGPL-3.0, in `../skylab-spherex`), under `/sky/`. TrueBlink then shows a "See it in the live sky" button that opens it at the current field; without `/sky/` the button stays hidden. The layout is:

| Path | What |
|---|---|
| `/` | TrueBlink (this repository, Apache-2.0) |
| `/sky/` | the sky app's built files (AGPL-3.0; its source is offered from inside the app) |
| `/hips/spherex/<channel>/` | `functions/hips/[[path]].ts`: each SPHEREx wavelength as an ordinary HiPS (redirects tiles to IRSA) |
| `/api/sia` | `functions/api/[[route]].ts`: the exposure-search relay |

The `/hips` function is needed for every SPHEREx wavelength other than channel 1 (0.75 µm): the Stellarium engine cannot request the cube's `Npix<n>_<frame>.png` tiles itself. By default it answers tiles with a 302 redirect to IRSA (IRSA sends `Access-Control-Allow-Origin: *`, so the redirected image stays usable in WebGL); set the Pages environment variable `HIPS_MODE=stream` to pass the bytes through instead (slower, uses the edge cache).

Build and deploy from your own computer (the sky app is not part of this repository, so a Git-connected Pages build produces TrueBlink only):

```bash
cd ../skylab-spherex && node scripts/build.mjs      # builds the sky app into ../skylab-spherex/dist
cd ../trueblink && npm run build:site                # npm run build, then copies it to dist/sky/ and prints sizes
npx wrangler pages deploy dist --project-name trueblink   # run from the trueblink folder so functions/ is included
```

`SKYLAB_DIST=/path/to/dist npm run build:site` takes the sky app from elsewhere; `node scripts/build-site.mjs --no-build` only copies it into an existing `dist/`. The script stops with an error if a file is over 25 MiB or the site has more than 20,000 files (Cloudflare Pages limits). Test the combined site locally with `npm run build:site && PORT=8080 node scripts/serve.mjs`, which serves `dist/` (including `dist/sky/`), `/api/sia` and `/hips/spherex/`.

## Testing a production build on your own computer

```bash
npm run build
npx vite preview --port 4173                       # serves dist/ and relays /api/sia like the dev server
PREVIEW_NO_RELAY=1 npx vite preview --port 4173    # behaves like a static host with no relay
npm run smoke -- http://localhost:4173
```

With a separate relay: start `npm run relay` (port 8787), build with `VITE_API_BASE=http://localhost:8787/api npm run build`, and preview with `PREVIEW_NO_RELAY=1`. `npm run e2e -- http://localhost:4173/` opens all five targets in a headless browser (needs a Chromium for Playwright).

## Updating the baked data (re-baking)

The presets are snapshots of the archive on the day they were baked. After a new SPHEREx release, refresh them:

```bash
npm run bake                        # all presets: exposure lists and the five pixel bundles, about 3 minutes
npm run bake -- --only wise0855     # one preset
npm run bake -- --only rdra --skip-sia   # rebuild one pixel bundle from the existing exposure list
```

It talks to IRSA and S3 directly (Node has no CORS limits) and rewrites `public/presets/`. Run `npm test`, commit, push; Cloudflare redeploys.

Or let GitHub do it: **Actions > Re-bake presets > Run workflow** (`.github/workflows/rebake.yml`; it also runs every Monday). When an exposure list changed, it pushes the branch `auto/rebake-presets` and opens one pull request; it never changes `main` by itself. To let it open the pull request, enable **Settings > Actions > General > Workflow permissions > Allow GitHub Actions to create and approve pull requests**. Cloudflare builds a preview of that branch; check the five targets there before merging. GitHub pauses scheduled workflows in repositories with no activity for 60 days; **Run workflow** still works.

**During judging (until 2027-01-26) do not merge re-bake pull requests or push other changes unless the competition rules allow it.** The submitted link must keep showing what was submitted.

## Limits that matter for ten weeks

- Cloudflare Pages free plan: 25 MiB per file, 20,000 files, 500 builds a month, 100,000 function requests a day. The build has 77 files and 36 MB (5.4 MB of that is source maps); the largest file is `presets/epsIndB.bundle.bin` at 5.3 MB. The `*.bundle.json` manifests are about 1 MB each, but Cloudflare compresses JSON on the way out (barnard: 1.1 MB becomes 0.24 MB), so they are fine as they are.
- Each search makes about five relay calls, all cached for an hour, so the request limit is far away.
- **IRSA slow or down**: searches for new positions fail with a clear message; the five targets still open from the baked lists and pixel bundles.
- **CDS down**: names fall back to other mirrors and to the built-in target names; coordinates always work. "Then and now" reads its AllWISE image from IRSA's HiPS tiles instead of CDS hips2fits (as on 2026-11-14, when CDS image services were down; the browser console then shows one 404 per field, which is harmless). 2MASS images are unavailable while CDS is down.
- **A new SPHEREx release adds collections**: the app reads the collection list from IRSA on each visit, so new `spherex_*` collections are picked up without a code change. Re-bake so the offline fallback stays current.

## Before you submit: checklist

Do these on the deployed link, not on `localhost`.

- [ ] `npm run smoke -- https://<project-name>.pages.dev` prints "All checks passed".
- [ ] Open the link in a private (incognito) window: no login, no cookie banner, no error blocking the page.
- [ ] Open each of the five challenge targets. In the developer tools' Network tab you see `presets/<id>.bundle.bin` load, and for other positions requests to `/api/sia` (200) and to `nasa-irsa-spherex...amazonaws.com` (206).
- [ ] Search a position that is not a preset (for example `83.82 -5.39`) and check that images load: this proves the relay works. Positions outside the presets, and preset fields larger than 3 arcmin, load live from S3 (a 5 arcmin field of about 330 exposures took about 40 s on our test connection).
- [ ] Open the link on a phone, portrait and landscape: the layout fits and the blink plays.
- [ ] The page opens in English. Switch to Korean and back. All project-page text and the demo are in English.
- [ ] The demo video is 30 seconds or less, and its link opens without logging in.
- [ ] The About dialog shows the SPHEREx acknowledgement, the DOIs, the AI disclosure ("used throughout the hackathon ...") and the licence.
- [ ] Copy the Share link, open it in another browser: same view.
- [ ] No DEMO label on the real targets.
- [ ] Open the GitHub repository in a private window: it is public and the README renders.
- [ ] Tag the submitted commit: `git tag submitted-2026-11-15 && git push --tags`.

## 한국어 요약

1. **GitHub**: 해커톤 기간 안에 새 공개 저장소 `trueblink`를 만들고(README 등 자동 생성 체크 해제), 프로젝트 폴더에서 `git init`, `git add .`, `git commit`, `git push`로 첫 커밋을 올립니다. `node_modules/`와 `dist/`는 올리지 않습니다.
2. **Cloudflare Pages**: Workers & Pages > Create > Pages > Connect to Git에서 저장소를 고르고, 빌드 명령 `npm run build`, 출력 폴더 `dist`, 환경 변수 `NODE_VERSION=26`으로 설정합니다. `VITE_API_BASE`는 설정하지 않습니다. `functions/` 폴더는 자동으로 `/api/sia` 중계 함수가 됩니다.
3. **확인**: `npm run smoke -- https://<프로젝트>.pages.dev` 를 실행해 모든 줄이 PASS인지 봅니다.
4. **대안**: Cloudflare를 쓸 수 없으면 GitHub Pages(Actions > GitHub Pages fallback)를 씁니다. 중계 서버가 없으면 다섯 개 챌린지 대상만 열립니다. 다른 곳에 중계 서버(`npm run relay`)를 띄웠다면 `api_base`(= `VITE_API_BASE`)에 그 주소(`https://.../api`)를 넣습니다.
5. **데이터 갱신**: `npm run bake` 또는 Actions > Re-bake presets. 자동 작업은 풀 리퀘스트만 만들며 main을 직접 바꾸지 않습니다. 심사 기간(2027-01-26까지)에는 병합하지 않습니다.
6. **함께 배포(/sky/)**: `cd ../skylab-spherex && node scripts/build.mjs` 다음 `npm run build:site`, 그리고 `npx wrangler pages deploy dist --project-name trueblink`. 0.75 µm 외의 SPHEREx 파장을 보려면 `/hips` 함수(`functions/hips`)가 꼭 있어야 합니다.
7. **제출 전**: 시크릿 창, 휴대폰, 로그인 없이 열리는지, 데모 영상 30초 이하, 페이지 글은 영어인지 확인하고 제출 커밋에 태그를 답니다.

## Quick temporary public link (for showing teammates, not for the submission)

`scripts/serve.mjs` serves the production build and the `/api/sia` relay from one Node process, bound to
this machine only. A tunnel then gives it a public HTTPS address without any account:

```bash
npm run build
npm run serve                      # http://127.0.0.1:8080/ (PORT and HOST can be set)
# in a second terminal, with Cloudflare's tunnel client (https://github.com/cloudflare/cloudflared/releases):
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080
```

cloudflared prints an address like `https://<random-words>.trycloudflare.com`. Checked on 2026-11-14: the five
challenge targets and a typed coordinate all loaded through such an address in a headless browser.
The address works only while both processes and this computer are running, and it changes every time,
so it must not be used as the project link for judging. Use Cloudflare Pages (above) for that.

임시 공개 주소 요약: `npm run build` 후 `npm run serve`로 사이트를 띄우고, 다른 터미널에서 `cloudflared tunnel --url http://127.0.0.1:8080`을 실행하면 `trycloudflare.com` 주소가 나옵니다. 컴퓨터와 두 프로그램이 켜져 있는 동안만 열리고 주소가 매번 바뀌므로, 제출용 링크로는 쓰면 안 됩니다.
