# TrueBlink architecture and module contracts

Working name: **TrueBlink for SPHEREx** (placeholder; the display name lives in `src/app/config.ts`).

A static web app. The browser reads NASA SPHEREx Level-2 pixels straight from the public AWS S3 bucket
`nasa-irsa-spherex` with HTTP Range requests, so there is no pixel server to pay for or keep awake.
Only the exposure search (IRSA SIA, which sends no CORS headers) goes through a tiny stateless relay
(`functions/api`, `GET /api/sia` only). The five challenge targets also ship as baked exposure lists and
pixel bundles (`public/presets/`), so they open without the relay or the archive.

## The one idea

SPHEREx images every sky position through a linear variable filter, so **every exposure is at a
different wavelength**. A naive time-ordered blink therefore shows colour, not change. TrueBlink
compares like with like: it builds one frame per visit from the **same set of spectral channels**,
labels every frame with its wavelength and date, and measures changes with photometry on native pixels
instead of trusting pixel differences.

## Layers

```
src/core/     pure TypeScript, no DOM, unit-tested (vitest, node)
src/gl/       three.js rendering (BlinkStage, SkyGlobe, CubeView; helpers in blink/, globe/, cube/)
src/app/      React UI, zustand store, URL state, i18n (English default, Korean toggle)
functions/api serverless relay for IRSA SIA, GET /api/sia only (Cloudflare Pages Functions format)
scripts/      Node scripts: bake-presets.ts, measure-check.ts, relay.mjs, smoke.mjs, audit/
tests/        vitest unit tests; tests/live hits the real archive (run with LIVE=1)
e2e/          headless-browser checks with playwright-core
public/data   small static tables (WCS-WAVE lookups, channel table, class means, star catalogue)
public/presets baked exposure lists and pixel bundles for the challenge targets
```

Shared types: `src/core/types.ts` (read it first; its conventions are binding).

Rules for every module:

- Never hard-code a release name, pipeline tag, byte offset or HDU position. Discover them.
- NaN means "no data". Never zero-fill. Never treat the SOURCE or OUTLIER flag as bad.
- Network calls take an optional `AbortSignal` and reject with a clear `Error` message.
- All S3 requests are single-range GETs (`Range: bytes=a-b`); check `status === 206`.
  Never send multi-range requests (S3 answers with the whole 66 MB file).
- No code or assets copied from the reference projects in `../Reference_example` (competition rule).
- Every source file starts with the AI-assistance comment line used in `src/core/types.ts`.
- Exports are named exports from `src/core/<module>/index.ts` exactly as listed below.

## Module contracts

### core/fits — FITS headers, Level-2 layout, RICE decoder

```ts
fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>
parseHeader(bytes: Uint8Array, offset?: number): { cards: Record<string, string | number | boolean>; length: number } | null
openL2(s3Key: string, opts?: { signal?: AbortSignal; shard?: number }): Promise<FrameHeader>
// reads bytes 0-34559, parses PRIMARY + IMAGE headers, fills wcs, times, layout.imageDataOffset
ensureLayout(header: FrameHeader, signal?: AbortSignal): Promise<L2Layout>
// fetches the FLAGS header + row table once, fills flags/variance/zodi offsets and header.flagNames
readWindow(header: FrameHeader, plane: 'IMAGE' | 'VARIANCE' | 'ZODI', x0: number, y0: number, nx: number, ny: number, signal?: AbortSignal): Promise<Float32Array>
readFlagsWindow(header: FrameHeader, x0: number, y0: number, nx: number, ny: number, signal?: AbortSignal): Promise<Int32Array>
riceDecodeRow(bytes: Uint8Array, nPix: number, blockSize?: number): Int32Array
s3Url(s3Key: string, shard?: number): string   // spreads over the equivalent S3 host names
```

### core/wcs — TAN + SIP

```ts
wcsFromCards(cards: Record<string, string | number | boolean>): TanSipWcs
skyToPix(wcs: TanSipWcs, ra: number, dec: number): [number, number]      // 0-based, exact (AP/BP start + iteration)
pixToSky(wcs: TanSipWcs, x: number, y: number): [number, number]
pixelAreaArcsec2(wcs: TanSipWcs, x: number, y: number): number
positionAngleDeg(wcs: TanSipWcs, x: number, y: number): number            // PA of +y axis, east of north
tanProject(ra0: number, dec0: number, ra: number, dec: number): [number, number]   // xi (east), eta (north) in arcsec
tanDeproject(ra0: number, dec0: number, xiArcsec: number, etaArcsec: number): [number, number]
gridPixToSky(grid: SkyGrid, i: number, j: number): [number, number]
skyToGridPix(grid: SkyGrid, ra: number, dec: number): [number, number]    // fractional (i, j)
angularSepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number
```

### core/wave — wavelength of a detector pixel

```ts
interface WaveTable { detector: number; x: number[]; y: number[]; wave: number[][]; band: number[][] }   // control points 1-based FITS pixels
loadWaveTables(): Promise<Record<number, WaveTable>>      // static JSON in public/data/wcs_wave_tables.json (also importable for node tests)
waveAt(table: WaveTable, x: number, y: number): { wavelength: number; bandwidth: number }   // 0-based pixel, bilinear
channelAt(x: number, y: number): number                   // 1..17, 0/18 off-nominal (closed-form channel map)
CHANNELS: { cubeChannel: number; detector: number; channel: number; wavelength: number; waveMin: number; waveMax: number; bandwidth: number }[]   // 102 rows
approxPixFromRegion(sRegion: number[], ra: number, dec: number): [number, number] | null   // footprint homography, good to a few px
```

### core/archive — which exposures cover a position

```ts
discoverCollections(opts?: { signal?: AbortSignal }): Promise<string[]>     // ^spherex_(dr|qr)\d+(_deep)?$ from the SIA self-description
searchExposures(pos: SkyPos, opts?: { collections?: string[]; signal?: AbortSignal; maxPerCollection?: number }): Promise<Exposure[]>
parseSiaCsv(text: string): Exposure[]                                       // tolerant of the unquoted cloud_access column
dedupeExposures(list: Exposure[]): Exposure[]                               // newest processing per (obsId, detector)
groupVisits(exposures: Exposure[], gapDays?: number): Visit[]               // default gap 10 days
searchExposuresDetailed(pos: SkyPos, opts?): Promise<SearchResult>         // same, with per-collection warnings
buildSiaUrl(...)                                                            // every query it builds passes the relay's allow-list
apiBase(): string                                                           // import.meta.env.VITE_API_BASE ?? './api'
RelayMissingError                                                           // the relay answered with an HTML page: no relay on this site; thrown after one request
loadPreset(id: string, opts?: { signal?: AbortSignal; baseUrl?: string; fetch?: FetchLike }): Promise<PresetBundle | null>   // public/presets/<id>.json
```

### core/coords and core/resolve — user input

```ts
parseCoordinates(text: string): SkyPos | null        // decimal, sexagesimal (08h55m10.83s -07d14m42.5s, 08:55:10.8 -07:14:42), with or without commas
formatRa(raDeg: number): string; formatDec(decDeg: number): string
resolveName(name: string, signal?: AbortSignal): Promise<TargetInfo | null>   // CDS Sesame with mirrors (CORS ok), keeps pm / parallax / types
propagate(target: TargetInfo, mjd: number, opts?: { parallax?: boolean; observerAu?: [number, number, number] }): SkyPos
```

### core/frames — cutouts and reprojection

```ts
planWindow(wcs: TanSipWcs, pos: SkyPos, fovArcsec: number): { x0: number; y0: number; nx: number; ny: number } | null   // null when off the detector
loadCutout(exposure: Exposure, pos: SkyPos, fovArcsec: number, opts?: { planes?: ('ZODI' | 'VARIANCE' | 'FLAGS')[]; signal?: AbortSignal; waveTables?: Record<number, WaveTable> }): Promise<NativeCutout | null>
makeGrid(pos: SkyPos, fovArcsec: number, scaleArcsec?: number): SkyGrid       // default scale 3.075 arcsec, n capped at 256
reprojectCutout(cutout: NativeCutout, grid: SkyGrid, opts?: { background?: 'zodi+median' | 'median' | 'none'; badMask?: number }): SkyFrame
```

### core/stack — like-with-like sequences

```ts
stackFrames(frames: SkyFrame[], opts?: { method?: 'mean' | 'median' | 'sigclip'; label?: string }): SkyFrame
selectBalanced(cutouts: NativeCutout[], visits: Visit[], group: BandGroup, opts?: { tolerance?: number }): { byVisit: Map<number, NativeCutout[]>; commonChannels: number[] }
buildEpochSequence(frames: SkyFrame[], visits: Visit[], group: BandGroup, opts?: { balanced?: boolean; method?: 'mean' | 'median' | 'sigclip'; minExposures?: number }): SkyFrame[]
buildSweepSequence(frames: SkyFrame[], visit: Visit): SkyFrame[]                   // one visit ordered by wavelength
buildMatchedPairs(frames: SkyFrame[], visits: Visit[], cubeChannel: number): SkyFrame[]
differenceFrame(a: SkyFrame, b: SkyFrame, label?: string): SkyFrame               // a - b
displayRange(frames: SkyFrame[], opts?: { loPercentile?: number; hiPercentile?: number }): { lo: number; hi: number }
robustStats(data: Float32Array): { median: number; mad: number; sigma: number }
summarizeCoverage(frames: SkyFrame[], visits: Visit[]): CoverageRow[]
nearestChannelWithAllVisits(frames: SkyFrame[], visits: Visit[], wavelength: number): number | null
nearestChannelWithMostVisits(frames: SkyFrame[], visits: Visit[], wavelength: number): number | null   // fallback for the pairs view
frameCubeChannel(f: SkyFrame): number
```

Balanced epochs (`buildEpochSequence`, default `balanced: true`) average the channels every kept visit
shares with equal weight. A cross-channel clip drops a single-channel value beyond 8 robust sigma of the
other channels (only with at least 8 channels, at most 10 % dropped), so a one-exposure cosmic-ray hit
does not become a "new source". The pairs, sweep and unbalanced sequences are not clipped.

### core/stack/spectral — the cold-object filter

```ts
COLD_FILTER: SpectralFilter   // on 4.2-4.8 um, off 3.82-4.05 um
rayleighJeansScale(lambdaOn: number, lambdaOff: number): number          // (lambdaOff / lambdaOn)^2
fitStarScale(on: Float32Array, off: Float32Array, minPixels?: number): { scale: number; pixels: number } | null
buildSpectralDifferenceSequence(frames: SkyFrame[], visits: Visit[], filter?: SpectralFilter, opts?: { scale?: number | 'fit' | 'rj'; minExposures?: number }): SkyFrame[]
// one frame per visit: sigclip stack(on) - scale * sigclip stack(off). Default scale 'fit' (bright field
// stars, Rayleigh-Jeans fallback); the app passes 'rj' (about 0.77) because the fit is pulled by the target
// in some fields. Visits with < minExposures (3) in either band are dropped and named in notes.
```

### core/bundle — pixel bundles for the presets

A network-free container for the native cutouts of one field: `<id>.bundle.json` (manifest: trimmed
headers, windows, spans) and `<id>.bundle.bin` (gzip, IMAGE + FLAGS). Written by `scripts/bake-presets.ts`.

```ts
encodeBundle(cutouts: NativeCutout[], info: BundleInfo): { manifest: BundleManifest; binary: Uint8Array }
decodeBundle(manifest: BundleManifest, binary: Uint8Array): NativeCutout[]
validateManifest(m: unknown): asserts m is BundleManifest
headerToBundle(h: FrameHeader, sharedFlagNames?: Record<string, string>): BundleHeader
headerFromBundle(b: BundleHeader, sharedFlagNames?: Record<string, string>): FrameHeader
gzipBytes(bytes: Uint8Array): Promise<Uint8Array>;  gunzipBytes(bytes: Uint8Array, gunzip?: Gunzip): Promise<Uint8Array>
```

### core/cache — one entry point for cutouts

Answers "give me this exposure's cutout" from, in order: a preloaded pixel bundle whose window contains
the request, the browser cache (IndexedDB, `IdbCutoutStore`; `MemoryCutoutStore` in tests), then the
archive (`core/frames loadCutout`).

```ts
getCutout(exposure: Exposure, pos: SkyPos, fovArcsec: number, opts?: { planes?: Plane[]; signal?: AbortSignal }): Promise<NativeCutout | null>
preloadBundle(presetId: string, signal?: AbortSignal, opts?: PreloadOptions): Promise<number>   // ./presets/<id>.bundle.*; 0 = no bundle
bundledExposureIds(presetId: string): string[]
cutoutSource(exposureId: string): 'bundle' | 'cache' | 'archive' | undefined                  // shown in Provenance and the status bar
configureCache(opts: { loader?: Loader; store?: CutoutStore | null }): void
clearCache(opts?: { bundles?: boolean }): Promise<void>;  cacheStats(): Promise<CacheStats>
```

### core/phot — photometry and centroids on native pixels

```ts
aperturePhot(cutout: NativeCutout, pos: SkyPos, opts?: { radiusPix?: number; annulus?: [number, number]; badMask?: number }): PhotPoint
centroid(cutout: NativeCutout, pos: SkyPos, opts?: { radiusPix?: number }): { ra: number; dec: number; snr: number; ok: boolean } | null
buildSpectrum(points: PhotPoint[]): { wavelength: number; flux: number; fluxErr: number; n: number }[]     // binned by cube channel
matchedRatio(points: PhotPoint[], visitA: number, visitB: number): { cubeChannel: number; wavelength: number; ratio: number; ratioErr: number }[]
abMag(fluxMjy: number): number
```

### core/astrometry — motion

```ts
earthBarycentricAu(mjd: number): [number, number, number]               // ICRS equatorial, good to ~1e-4 au
parallaxOffsetArcsec(ra: number, dec: number, parallaxMas: number, mjd: number): [number, number]   // (d_ra*cos(dec), d_dec)
propagateSource(src: { ra: number; dec: number; epoch: number; pmRa?: number; pmDec?: number; parallax?: number }, mjd: number): SkyPos
fitMotion(points: { mjd: number; ra: number; dec: number; err: number }[], opts?: { fitParallax?: boolean; refRa?: number; refDec?: number }): { pmRa: number; pmDec: number; pmRaErr: number; pmDecErr: number; total: number; totalErr: number; parallax?: number; chi2: number; n: number }
```

### core/catalogs — overlays (all browser-callable)

```ts
gaiaCone(pos: SkyPos, radiusArcsec: number, signal?: AbortSignal): Promise<CatalogSource[]>      // Gaia DR3 with pm, parallax, G mag
simbadCone(pos: SkyPos, radiusArcsec: number, signal?: AbortSignal): Promise<CatalogSource[]>
skybotCone(pos: SkyPos, radiusArcsec: number, mjd: number, signal?: AbortSignal): Promise<SolarSystemObject[]>   // geocentric
leoParallaxArcsec(ra: number, dec: number, deltaAu: number, scPosKm: [number, number, number]): [number, number]   // shift geocentric -> spacecraft
externalFrame(survey: 'allwise-w1' | 'allwise-w2' | '2mass-j' | '2mass-h' | '2mass-k' | 'dss2-red', grid: SkyGrid, signal?: AbortSignal): Promise<SkyFrame>
// CDS hips2fits first, then the survey's HiPS FITS tiles (IRSA mirror for AllWISE and DSS2), resampled in
// hips.ts / fitsimage.ts. The app uses allwise-w2 (and 2mass-k, unavailable while CDS is down) for "Then and now".
```

### core/solar — asteroid science (researcher mode)

```ts
solarFluxMjy(wavelengthUm: number, rAu?: number): number                                    // solar spectrum at 1 au, tabulated
neatmFlux(p: { diameterKm: number; pV: number; eta: number; emissivity?: number; G?: number; rAu: number; deltaAu: number; phaseDeg: number }, wavelengthUm: number): number   // mJy
reflectedFlux(p: { H: number; G?: number; rAu: number; deltaAu: number; phaseDeg: number; reflectanceRatio?: number }, wavelengthUm: number): number   // mJy
toReflectance(points: (PhotPoint & { rAu: number; deltaAu: number; phaseDeg: number })[], opts?: { normaliseAt?: number }): { wavelength: number; reflectance: number; err: number }[]
fitThermalTail(points, fixed: { diameterKm: number; pV: number; H: number; G?: number }): { eta: number; etaErr: number; crossoverUm: number; chi2: number }
classifyBusDemeo(spec: { wavelength: number; reflectance: number; err: number }[]): { group: string; chi2: number; gapToNext: number; ranked: { group: string; cls: string; chi2: number }[]; refused?: string }
```

### gl/BlinkStage — the blink viewer (three.js)

```ts
class BlinkStage {
  constructor(container: HTMLElement, opts?: { pixelated?: boolean })
  setFrames(frames: SkyFrame[]): void                 // one float texture per frame; all frames share one grid
  setFrameIndex(i: number): void
  getFrameIndex(): number
  play(msPerFrame: number): void
  pause(): void
  isPlaying(): boolean
  setStretch(s: Stretch): void
  setMode(mode: 'single' | 'blend' | 'difference' | 'rgb', opts?: { a?: number; b?: number; rgb?: [number, number, number] }): void
  setOverlays(overlays: Overlay[]): void
  setView(v: { zoom?: number; centerRa?: number; centerDec?: number }): void
  resetView(): void
  on(event: 'frame' | 'pick' | 'hover' | 'view', cb: (payload: any) => void): () => void
  // 'pick' / 'hover' payload: { ra, dec, i, j, value, frameIndex, overlay? }
  screenshot(): Promise<Blob>
  resize(): void
  dispose(): void
}
```

### gl/SkyGlobe — all-sky navigator (three.js)

Inside-out celestial sphere textured with the SPHEREx all-sky PNG HiPS cube
(`https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube`, CORS enabled, orders 0-5,
102 spectral planes). Right-handed sky: `v = (cos d cos a, sin d, -cos d sin a)`, camera at the origin,
east to the left when north is up.

```ts
class SkyGlobe {
  constructor(container: HTMLElement)
  setChannel(cubeChannel: number): void               // 1..102
  lookAt(pos: SkyPos, fovDeg?: number): void
  setMarkers(markers: { id: string; ra: number; dec: number; label: string; color?: string }[]): void
  on(event: 'pick' | 'view', cb: (payload: any) => void): () => void    // 'pick' payload: { ra, dec, markerId? }
  resize(): void
  dispose(): void
}
```

### gl/CubeView — sky x time (or wavelength) stack (three.js)

```ts
class CubeView {
  constructor(container: HTMLElement)
  setFrames(frames: SkyFrame[], axis: 'time' | 'wavelength'): void
  setStretch(s: Stretch): void
  setTracks(tracks: { path: [number, number, number][]; color?: string; label?: string }[]): void   // [ra, dec, mjd]
  resize(): void
  dispose(): void
}
```

### app

`src/app/store.ts` (zustand) holds: target, grid/fov, exposures, visits, cutouts (by exposure id), sequence
definition (`mode`, `bandGroup`, `balanced`, `reference`), frames, stretch, overlays, measurements, UI mode
(`explore` | `research`), language. `src/app/urlState.ts` encodes the view in the URL hash
(`#name=..&ra=..&dec=..&fov=..&seq=..&band=..&mode=..&lang=..&frame=..&speed=..&embed=1`; `seq` is one of `epochs`, `pairs`,
`sweep`, `difference`, `thenNow`, `coldFilter`). `src/app/presets.ts` holds the five challenge targets and their
mission steps (three each, four for WISE 0855-0714; each step sets sequence, band group and zoom). `src/app/seams.ts` holds the typed
seams between the shell and the modules plugged into it (`AppPipeline`, the stage factory,
`registerResearchTab`). `src/app/session.ts` holds the large typed arrays of the current field outside
the store (cutouts, exposure status, where each cutout came from), with a version counter to subscribe to.
`src/app/components/` holds the shell (top bar, Explore panel with the mission card, viewer and its
controls, frame badge, status bar, About dialog); `src/app/research/` the Research tabs (Frames, Measure,
Overlays, Provenance: charts, exposure table, flag legend); `src/app/locales/` the English and Korean text.

### app/pipeline — real data, end to end

`RealPipeline implements AppPipeline` (`src/app/pipeline/index.ts`):

```ts
open(input: { name?: string; ra?: number; dec?: number; keepView?: boolean }): Promise<void>
setFov(arcsec: number): void
rebuildSequence(): void
measureAt(pos: SkyPos): Promise<void>
cancel(): void
```

Name or coordinates -> exposure list (for a challenge target: the baked list and `preloadBundle` at once,
with a live search in the background that offers newer exposures; otherwise the relay) -> predicted
wavelength per exposure (`plan.ts`, pure and unit-tested) -> progressive cutout loading through
`core/cache` (at most 4 parallel requests per S3 host, yielding to the event loop every 25 ms) ->
like-with-like sequences (`core/stack`, `core/stack/spectral`) -> store. Every step is abortable and
drops results of an older field. The measurement pass runs when the browser is idle after the view is ready.

### app/measure — measurements and findings

```ts
measureSession(input: MeasureInput, pos: SkyPos | null): MeasureResult   // pure: photometry, spectrum, light curve, ratio, motion
runMeasurements(pos?: SkyPos | null, opts?: { signal?: AbortSignal }): Promise<void>   // on the current session, into useMeasure
buildFindings(r: MeasureResult, visitLabel: (v: number) => string): FindingSpec[]      // language-independent finding specs (findings.ts)
```

`core.ts` holds the pure helpers: wing photometry and centroids for saturated stars (`wingPhot`,
`wingCentroid`, `wingRings`), per-visit aggregation, `motionFromVisits`, `motionSignificant`,
`brightnessVerdict` (with "too noisy to tell" when the error exceeds `TOO_NOISY_LIMIT`), `robustRatio`,
`bandRatios` (0.75-2.4 µm = cube channels 1-51, 2.4-5.0 µm = 52-102, and per array), `colourSplit` and
`colourExtremes` (the "change depends on colour" finding), Gaia and peak comparison stars, blended-neighbour
checks. For saturated targets the band ratio is recomputed with a ring 2 px further out, and the finding
states both numbers.

### app/views — sky map and 3D stack

`SkyView.tsx` (all-sky navigator on `gl/SkyGlobe`, with a "pick this spot" confirmation) and
`CubePanel.tsx` (frames along time or wavelength on `gl/CubeView`, with the predicted track).
`viewsUtil.ts` holds the pure helpers (`presetMarkers`, `exposureStack`, `predictedTrack`, `zoomFov`).

### app/asteroid — the Asteroid tab

`AsteroidTab` shows the four asteroids measured beforehand (`public/data/asteroids/*.json`, loaded as
lazy chunks by `data.ts`). `analysis.ts` is pure: `analyseAsteroid(file, { lightcurve?, visit? })`
gives the reflectance spectrum, the Bus-DeMeo group or a refusal, and a thermal-tail fit per visit.
`overlays.ts` draws known Solar System objects (one SkyBoT cone per visit, shifted from geocentric to
the spacecraft) over the blink view.

## Relay

`functions/api/[[route]].ts` (Cloudflare Pages Function) relays only `GET /api/sia` ->
`https://irsa.ipac.caltech.edu/SIA`, with an allow-list of SIA parameters (COLLECTION `spherex_*`, POS,
RESPONSEFORMAT, MAXREC, TIME, BAND), a rebuilt upstream query, a 16 MB cap, a 25 s timeout, a generic
User-Agent and `Cache-Control: public, max-age=3600` on success (errors: `no-store`). Every other path
returns 404. `scripts/relay.mjs` is the same relay for Node (`npm run relay`); in development Vite
proxies `/api/sia` (`vite.config.ts`). There is no JPL Horizons route.
