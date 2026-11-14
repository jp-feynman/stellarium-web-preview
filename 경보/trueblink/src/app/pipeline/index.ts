// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// RealPipeline: name or coordinates -> SPHEREx exposure list (relay, or the baked preset list) ->
// predicted wavelength per exposure -> progressive cutout loading from the public S3 bucket ->
// like-with-like sequences -> store. Every step is abortable and drops results of an older field.
import { propagateSource, predictTrack } from '../../core/astrometry';
import { dedupeExposures, groupVisits, loadPreset, PRESETS as CORE_PRESETS, RELAY_MISSING_MESSAGE, searchExposuresDetailed, visitIndexById } from '../../core/archive';
import { bundleInfo, bundledExposureIds, cutoutSource, getCutout, preloadBundle } from '../../core/cache';
import { externalFrame, gaiaCone, overlaysFromCatalog } from '../../core/catalogs';
import { parseCoordinates } from '../../core/coords';
import { isAbortError } from '../../core/fits';
import { makeGrid, reprojectCutout } from '../../core/frames';
import { resolveName } from '../../core/resolve';
import { buildEpochSequence, buildMatchedPairs, buildSweepSequence, differenceFrame, displayRange, frameCubeChannel, nearestChannelWithAllVisits, nearestChannelWithMostVisits } from '../../core/stack';
import { buildSpectralDifferenceSequence, COLD_FILTER } from '../../core/stack/spectral';
import {
  BAND_GROUPS,
  FLAG_MASKS,
  type Exposure,
  type NativeCutout,
  type Overlay,
  type SkyFrame,
  type SkyGrid,
  type SkyPos,
  type TargetInfo,
  type Visit,
} from '../../core/types';
import { waveTables } from '../../core/wave';
import { skyToPix } from '../../core/wcs';
import { solarSystemOverlays } from '../asteroid';
import { MAX_EXPOSURES_PER_FIELD, PARALLEL_CUTOUTS, SEARCH_TIMEOUT_MS } from '../config';
import { clearMeasurements, runMeasurements } from '../measure';
import { defaultView, findPreset as findAppPreset, PRESETS as APP_PRESETS } from '../presets';
import type { AppPipeline } from '../seams';
import { bumpSession, resetSession, session } from '../session';
import { useApp, type Notice } from '../store';
import {
  chooseBalancedVisits,
  groupMidWavelength,
  inBandGroup,
  initialLoadBudget,
  mjdNow,
  nearbyMovedPreset,
  orderForLoading,
  predictExposure,
  rescaleForDisplay,
  symmetricRange,
  visitWithMostFrames,
} from './plan';
import './strings';

export * from './plan';

/** Last time a loading worker yielded to the event loop (shared by all workers). */
let lastYield = 0;

const TARGET_COLOR = '#ffb454';
const CENTER_COLOR = '#5ad1e6';

/** Timing of the current field, for the e2e check and the console (window.__trueblink). */
export interface PipelineTiming {
  name: string;
  t0: number;
  searched?: number;
  firstFrame?: number;
  done?: number;
  loaded: number;
  total: number;
  failed: number;
  source?: string;
}

interface Run {
  sid: number;
  ctrl: AbortController;
  center: SkyPos;
  grid: SkyGrid;
  fov: number;
  /** Ordered exposures not started yet. */
  pending: Exposure[];
  /** How many exposures may be started in total (the per-field cap, raised by "load more"). */
  budget: number;
  started: number;
  done: number;
  failed: number;
  lastError?: string;
  channelOf: Map<string, number>;
  workers: number;
  rebuildTimer?: ReturnType<typeof setTimeout>;
  lastRebuild: number;
  /** Main-thread ms of the last progressive rebuild. */
  rebuildCost: number;
  timing: PipelineTiming;
}

class FriendlyError extends Error {}

/** What to open; `live` skips the saved exposure list of a challenge target and searches the archive. */
type OpenInput = { name?: string; ra?: number; dec?: number; label?: string; live?: boolean; keepView?: boolean };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A child AbortController that also aborts after `ms`. */
function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const c = new AbortController();
  let timed = false;
  const onAbort = () => c.abort(parent.reason);
  if (parent.aborted) c.abort(parent.reason);
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timed = true;
    c.abort(new DOMException('timeout', 'TimeoutError'));
  }, ms);
  return {
    signal: c.signal,
    timedOut: () => timed,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

/** TargetInfo of a challenge preset: core/archive astrometry (with parallax) under the app's display name. */
export function presetTarget(id: string): TargetInfo | null {
  const app = APP_PRESETS.find((p) => p.id === id);
  const core = CORE_PRESETS.find((p) => p.id === id);
  if (core) {
    const { challenge: _c, blurb: _b, sesameName: _s, briefPos: _p, deepField: _d, ...t } = core;
    return { ...t, name: app?.target.name ?? core.name };
  }
  return app ? { ...app.target } : null;
}

function visitLabelOf(f: SkyFrame, visits: Visit[]): string {
  const v = f.meta.visit !== undefined ? visits.find((x) => x.index === f.meta.visit) : undefined;
  return v?.label ?? f.meta.label.split(' · ')[0];
}

/** Does the target fall on saturated or no-data pixels in this cutout? null = cannot tell. */
function targetSaturated(cut: NativeCutout, pos: SkyPos): boolean | null {
  const [x, y] = skyToPix(cut.header.wcs, pos.ra, pos.dec);
  const ix = Math.round(x) - cut.x0;
  const iy = Math.round(y) - cut.y0;
  if (ix < 1 || iy < 1 || ix >= cut.nx - 1 || iy >= cut.ny - 1) return null;
  let sat = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const k = (iy + dy) * cut.nx + (ix + dx);
      if (cut.flags && (cut.flags[k] & FLAG_MASKS.saturation) !== 0) sat = true;
    }
  if (!cut.flags && !Number.isFinite(cut.image[iy * cut.nx + ix])) sat = true;
  return sat;
}

/**
 * Scale of the 3.82-4.05 um reference image in the cold-object filter: the Rayleigh-Jeans value
 * (lambda_off / lambda_on)^2, about 0.77. Checked on the bundles: on WISE 0855 the per-visit fit
 * agrees (0.78-0.79), but it is pulled by the field's brightest non-stellar source elsewhere
 * (0.52-0.62 by Epsilon Indi B, 1.25-1.37 by RW Aur), leaving 15-40 % of field stars behind.
 */
const COLD_FILTER_SCALE: 'fit' | 'rj' = 'rj';

/** Gaia markers drawn on the image: at most this many, no fainter than this G magnitude. */
const GAIA_DRAW_MAX = 60;
const GAIA_DRAW_MAG = 18.5;

/** Band group whose exposures load first: the selected one, or arrays 5+6 for the cold-object filter. */
function loadingGroup(): (typeof BAND_GROUPS)[number] {
  const st = useApp.getState();
  const id = st.sequence === 'coldFilter' ? 'cold' : st.bandGroupId;
  return BAND_GROUPS.find((g) => g.id === id) ?? BAND_GROUPS[0];
}

export class RealPipeline implements AppPipeline {
  private run: Run | null = null;
  /** Last stretch range we set automatically (null = none yet for this field). */
  private auto: { lo: number; hi: number; diverging: boolean } | null = null;
  private gaiaPending = false;
  private externalPending = false;
  private externalTried = false;
  private ssoOverlays: Overlay[] = [];
  private ssoTimer?: ReturnType<typeof setTimeout>;
  private measureCtrl: AbortController | null = null;
  private lastInput: OpenInput | null = null;
  /** Exposure ids the current field's baked bundle can answer. */
  private bundled = new Set<string>();
  private gaiaPromise: Promise<void> | null = null;
  private savedListDate = '';

  constructor() {
    // React to store changes that concern the data: band group (re-prioritise loading) and overlay toggles.
    useApp.subscribe((s, prev) => {
      // The cold-object filter needs arrays 5 and 6 whatever band group is selected: load them first.
      if (s.bandGroupId !== prev.bandGroupId || (s.sequence !== prev.sequence && (s.sequence === 'coldFilter' || prev.sequence === 'coldFilter'))) this.reprioritise();
      if (s.overlaysOn !== prev.overlaysOn) {
        if (s.overlaysOn.gaia && !prev.overlaysOn.gaia) void this.ensureGaia();
        if (s.overlaysOn.solarSystem && !prev.overlaysOn.solarSystem) this.scheduleSso(0);
        this.updateOverlays();
      }
    });
  }

  // ------------------------------------------------------------------ open

  async open(input: OpenInput): Promise<void> {
    this.abortRun();
    clearMeasurements();
    const sid = resetSession();
    const ctrl = new AbortController();
    const { signal } = ctrl;
    this.lastInput = input;
    this.auto = null;
    this.gaiaPending = false;
    this.externalPending = false;
    this.externalTried = false;
    this.ssoOverlays = [];
    this.bundled = new Set();
    const st = useApp.getState();
    st.reset();
    st.setSourceLabel(input.label ?? '');
    st.setDemo(false);
    const label = input.name?.trim() || (input.ra !== undefined && input.dec !== undefined ? `${input.ra.toFixed(5)} ${input.dec >= 0 ? '+' : ''}${input.dec.toFixed(5)}` : '');
    st.setQuery(label);
    if (st.view === 'sky') st.setView('blink');
    const timing: PipelineTiming = { name: label, t0: performance.now(), loaded: 0, total: 0, failed: 0 };
    publishTiming(timing);
    const stale = () => session.id !== sid || signal.aborted;
    // Placeholder run so cancel() works during resolving and searching.
    this.run = { sid, ctrl, center: { ra: 0, dec: 0 }, grid: { ra0: 0, dec0: 0, n: 3, scaleArcsec: 1 }, fov: st.fovArcsec, pending: [], budget: 0, started: 0, done: 0, failed: 0, channelOf: new Map(), workers: 0, lastRebuild: 0, rebuildCost: 0, timing };
    try {
      st.setStatus({ phase: 'resolving', message: label, loaded: 0, total: 0, remaining: 0 });
      const { target, pos, presetId } = await this.resolveInput(input, signal);
      if (stale()) return;
      // Challenge targets ship a baked pixel bundle: fetch it while the archive is searched, so their
      // cutouts come from it at once (and still open when the archive search is unreachable).
      const bundleP = presetId ? prof('bundle(start)', () => this.loadBundle(presetId, signal)) : Promise.resolve();
      session.target = target;
      st.setTarget(target);
      // A challenge target opens on the view that shows its point (unless the link chose one).
      const app = presetId ? APP_PRESETS.find((p) => p.id === presetId) : null;
      if (app && !input.keepView && !input.live) {
        const v = defaultView(app);
        st.setSequence(v.sequence);
        st.setBandGroup(v.band);
        st.setZoom(v.zoom);
      }
      const searchPos = target ? propagateSource(target, mjdNow()) : pos;
      st.setCenter(searchPos);
      if (!target) this.checkNearPreset(pos);

      st.setStatus({ phase: 'searching', message: undefined });
      // A challenge target with a baked bundle opens at once from its saved exposure list; the live
      // search runs alongside and offers any newer exposures (the user decides to reload).
      const fast = presetId && !input.live ? await this.savedIfBundled(presetId, bundleP, signal) : null;
      if (stale()) return;
      const found = fast ?? (await this.searchField(searchPos, presetId, signal));
      if (stale()) return;
      await bundleP;
      if (stale()) return;
      if (fast) this.checkNewer(searchPos, fast.exposures, input, sid, signal);
      timing.searched = performance.now();
      timing.source = found.source;
      session.source = found.source;
      for (const w of found.warnings) this.warn(w);
      if (!found.exposures.length) {
        throw new FriendlyError('No SPHEREx exposures cover this position yet (no exposures found). SPHEREx maps the whole sky twice a year, so check again after the next release, or try one of the challenge targets.');
      }
      const visits = groupVisits(found.exposures, 10);
      await this.startField(sid, ctrl, target, pos, found.exposures, visits, st.fovArcsec);
    } catch (e) {
      if (stale() || isAbortError(e)) return;
      useApp.getState().setStatus({ phase: 'error', message: errMsg(e) });
    }
  }

  /** The saved exposure list of a preset, when its pixel bundle loaded (else null: search the archive). */
  private async savedIfBundled(presetId: string, bundleP: Promise<void>, signal: AbortSignal): Promise<{ exposures: Exposure[]; source: 'preset'; warnings: string[] } | null> {
    const [b] = await Promise.all([loadPreset(presetId, { signal }).catch(() => null), bundleP]);
    if (!b || !b.exposures.length || !session.bundle) return null;
    this.savedListDate = b.generated.slice(0, 10);
    return { exposures: dedupeExposures(b.exposures), source: 'preset', warnings: [] };
  }

  /** Background live search after a fast open from the saved list: offer exposures the list lacks. */
  private checkNewer(pos: SkyPos, saved: Exposure[], input: OpenInput, sid: number, signal: AbortSignal): void {
    const to = withTimeout(signal, SEARCH_TIMEOUT_MS);
    const have = new Set(saved.map((e) => e.id));
    searchExposuresDetailed(pos, { signal: to.signal })
      .then((res) => {
        if (session.id !== sid) return;
        const fresh = dedupeExposures(res.exposures).filter((e) => !have.has(e.id));
        if (fresh.length) {
          this.notice({
            id: 'newer-exposures',
            text: 'pipeline.newer',
            vars: { n: fresh.length, date: this.savedListDate },
            level: 'info',
            action: { label: 'pipeline.newerLoad', run: () => void this.open({ ...input, live: true }) },
          });
        }
      })
      .catch((e) => {
        if (session.id !== sid || isAbortError(e)) return;
        console.info('Live archive search unavailable; the saved list is in use:', errMsg(e));
        this.notice({ id: 'saved-list', text: 'pipeline.savedList', vars: { date: this.savedListDate }, level: 'info' });
      })
      .finally(() => to.dispose());
  }

  /** Preload a preset's pixel bundle; never fails the open (without it pixels come from the archive). */
  private async loadBundle(presetId: string, signal: AbortSignal): Promise<void> {
    try {
      const n = await preloadBundle(presetId, signal, { baseUrl: `${import.meta.env?.BASE_URL ?? './'}presets` });
      const info = bundleInfo(presetId);
      if (n > 0 && info) {
        session.bundle = { presetId, generated: info.generated, cutouts: n };
        this.bundled = new Set(bundledExposureIds(presetId));
      }
    } catch (e) {
      if (isAbortError(e)) return;
      console.info('Saved pixel bundle unavailable:', errMsg(e));
    }
  }

  /** Turn the input into a target (with astrometry) or a bare position. */
  private async resolveInput(
    input: { name?: string; ra?: number; dec?: number },
    signal: AbortSignal,
  ): Promise<{ target: TargetInfo | null; pos: SkyPos; presetId: string | null }> {
    const name = input.name?.trim();
    if (name) {
      const app = findAppPreset(name);
      if (app) {
        const t = presetTarget(app.id)!;
        return { target: t, pos: { ra: t.ra, dec: t.dec }, presetId: app.id };
      }
      const coords = parseCoordinates(name);
      if (coords) return { target: null, pos: coords, presetId: null };
      const hasCoords =
        input.ra !== undefined && input.dec !== undefined && Number.isFinite(input.ra) && Number.isFinite(input.dec);
      let t: TargetInfo | null = null;
      try {
        t = await resolveName(name, signal);
      } catch (e) {
        if (isAbortError(e) || !hasCoords) throw e;
      }
      if (!t) {
        // A link may carry coordinates plus a free-text label (for example from the sky app): open the coordinates.
        if (hasCoords) return { target: null, pos: { ra: ((input.ra! % 360) + 360) % 360, dec: input.dec! }, presetId: null };
        throw new FriendlyError(`Could not find a target named "${name}".`);
      }
      const pid = findAppPreset(t.id)?.id ?? null;
      return { target: pid ? (presetTarget(pid) ?? t) : t, pos: { ra: t.ra, dec: t.dec }, presetId: pid };
    }
    if (input.ra !== undefined && input.dec !== undefined && Number.isFinite(input.ra) && Number.isFinite(input.dec)) {
      return { target: null, pos: { ra: ((input.ra % 360) + 360) % 360, dec: input.dec }, presetId: null };
    }
    throw new FriendlyError('Nothing to open: type a name or coordinates.');
  }

  /** Bare coordinates close to a fast-moving challenge target: offer to recentre on where it is now. */
  private checkNearPreset(pos: SkyPos): void {
    const now = mjdNow();
    const list = CORE_PRESETS.filter((p) => p.challenge).map((p) => {
      const t = presetTarget(p.id)!;
      return { id: p.id, name: t.name, pos: p.briefPos ?? { ra: p.ra, dec: p.dec }, propagated: propagateSource(t, now) };
    });
    const near = nearbyMovedPreset(pos, list, 300, 20);
    if (!near) return;
    this.notice({
      id: 'near-preset',
      text: 'pipeline.nearPreset',
      vars: { name: near.name, offset: Math.round(near.offsetArcsec) },
      level: 'warn',
      action: { label: 'pipeline.recentre', vars: { name: near.name }, run: () => void this.open({ name: near.name }) },
    });
  }

  /** Live archive search with a timeout; the baked list for presets when the relay is unreachable. */
  private async searchField(
    pos: SkyPos,
    presetId: string | null,
    signal: AbortSignal,
  ): Promise<{ exposures: Exposure[]; source: 'live' | 'preset'; warnings: string[] }> {
    // A challenge target has a saved list to fall back on, so it waits less for a slow archive.
    const timeoutMs = presetId ? Math.min(SEARCH_TIMEOUT_MS, 8000) : SEARCH_TIMEOUT_MS;
    const to = withTimeout(signal, timeoutMs);
    let why = '';
    try {
      const res = await searchExposuresDetailed(pos, { signal: to.signal });
      return { exposures: res.exposures, source: 'live', warnings: res.warnings };
    } catch (e) {
      if (signal.aborted) throw e;
      why = to.timedOut() ? `no answer within ${Math.round(timeoutMs / 1000)} s` : errMsg(e);
    } finally {
      to.dispose();
    }
    if (presetId) {
      const b = await loadPreset(presetId, { signal }).catch(() => null);
      if (b && b.exposures.length) {
        console.info(`Live archive search unavailable (${why}); using the saved exposure list.`);
        this.savedListDate = b.generated.slice(0, 10);
        this.notice({ id: 'saved-list', text: 'pipeline.savedList', vars: { date: this.savedListDate }, level: 'info' });
        return { exposures: dedupeExposures(b.exposures), source: 'preset', warnings: [] };
      }
    }
    console.info(`Archive search relay unreachable: ${why}`);
    if (why === RELAY_MISSING_MESSAGE) {
      throw new FriendlyError(`${RELAY_MISSING_MESSAGE} Only the five challenge targets below can be opened here, from saved copies.`);
    }
    throw new FriendlyError(
      'The SPHEREx archive search is unreachable right now, so we cannot list the exposures for this position. Try again in a minute; the five challenge targets below still open from saved copies.',
    );
  }

  /** Fill the session for a field and start loading cutouts. */
  private async startField(sid: number, ctrl: AbortController, target: TargetInfo | null, pos: SkyPos, exposures: Exposure[], visits: Visit[], fov: number): Promise<void> {
    const st = useApp.getState();
    const visitOf = visitIndexById(visits);
    session.exposures = exposures;
    session.visits = visits;
    session.visitOf = visitOf;
    session.fovArcsec = fov;
    // Centre on the target where it was at the newest SPHEREx epoch (fast movers cross pixels in months).
    const newest = exposures.reduce((m, e) => Math.max(m, e.mjd), -Infinity);
    const center = target ? propagateSource(target, newest) : pos;
    const grid = makeGrid(center, fov);
    session.center = center;
    session.grid = grid;
    st.setExposures(exposures);
    st.setVisits(visits);
    st.setCenter(center);

    // Predict where the centre lands on each detector frame (and so its wavelength) before any download.
    const tables = waveTables();
    const channelOf = new Map<string, number>();
    const usable: Exposure[] = [];
    for (const e of exposures) {
      const pr = predictExposure(e, center, tables);
      if (Number.isFinite(pr.wavelength)) session.wavelengthOf.set(e.id, pr.wavelength);
      channelOf.set(e.id, pr.cubeChannel);
      session.status.set(e.id, pr.usable ? 'pending' : 'skipped');
      if (pr.usable) usable.push(e);
    }
    bumpSession();
    if (!usable.length) {
      throw new FriendlyError(`All ${exposures.length} SPHEREx exposures put this position at the very edge of a detector, so there is nothing useful to show (no data). Try a position a few arcminutes away.`);
    }
    const group = loadingGroup();
    let pending = orderForLoading(usable, visitOf, channelOf, group, session.wavelengthOf);
    // Exposures held by the baked bundle first (instant), keeping the coverage-spreading order.
    if (this.bundled.size) pending = [...pending.filter((e) => this.bundled.has(e.id)), ...pending.filter((e) => !this.bundled.has(e.id))];
    const timing = this.run?.timing ?? { name: '', t0: performance.now(), loaded: 0, total: 0, failed: 0 };
    const run: Run = {
      sid,
      ctrl,
      center,
      grid,
      fov,
      pending,
      budget: initialLoadBudget(pending.length, pending.filter((e) => this.bundled.has(e.id)).length),
      started: 0,
      done: 0,
      failed: 0,
      channelOf,
      workers: 0,
      lastRebuild: 0,
      rebuildCost: 0,
      timing,
    };
    this.run = run;
    timing.total = run.budget;
    publishTiming(timing);
    await this.loadAll(run);
  }

  // ------------------------------------------------------------------ loading

  private planes(exposureId: string): ('ZODI' | 'VARIANCE' | 'FLAGS')[] {
    // The baked bundle holds IMAGE + FLAGS. For those exposures stay offline and instant even in
    // Research mode (photometry then takes its noise from the background scatter).
    if (this.bundled.has(exposureId)) return ['FLAGS'];
    return useApp.getState().uiMode === 'research' ? ['FLAGS', 'VARIANCE', 'ZODI'] : ['FLAGS'];
  }

  private isStale(run: Run): boolean {
    return this.run !== run || session.id !== run.sid || run.ctrl.signal.aborted;
  }

  private async loadAll(run: Run): Promise<void> {
    const st = useApp.getState();
    st.setStatus({ phase: 'loading', loaded: run.done, total: run.budget, message: undefined, remaining: run.pending.length - (run.budget - run.started) });
    const n = Math.min(PARALLEL_CUTOUTS, Math.max(1, run.budget - run.started));
    const workers: Promise<void>[] = [];
    for (let k = 0; k < n; k++) workers.push(this.worker(run));
    await Promise.all(workers);
    if (this.isStale(run) || run.workers > 0) return;
    this.finishPass(run);
  }

  private async worker(run: Run): Promise<void> {
    run.workers++;
    try {
      while (!this.isStale(run) && run.started < run.budget && run.pending.length) {
        const e = run.pending.shift()!;
        run.started++;
        session.status.set(e.id, 'loading');
        try {
          const cut = await getCutout(e, run.center, run.fov, { planes: this.planes(e.id), signal: run.ctrl.signal });
          if (this.isStale(run)) return;
          if (!cut) {
            session.status.set(e.id, 'off-detector');
          } else {
            const frame = prof('reproject', () => reprojectCutout(cut, run.grid, { background: 'median' }));
            frame.meta.visit = session.visitOf.get(e.id);
            // Per-exposure notes (edge distance, filter corner) stay with the exposure; they would
            // otherwise pile up on every stacked frame. The Frames/Provenance tabs can read them here.
            if (frame.meta.notes?.length) {
              session.exposureNotes?.set(e.id, frame.meta.notes);
              frame.meta.notes = undefined;
            }
            session.cutouts.set(e.id, cut);
            session.pixelSource?.set(e.id, cutoutSource(e.id) ?? 'archive');
            session.exposureFrames.set(e.id, frame);
            session.wavelengthOf.set(e.id, cut.wavelength);
            session.status.set(e.id, 'loaded');
            if (run.timing.firstFrame === undefined) run.timing.firstFrame = performance.now();
          }
        } catch (err) {
          if (this.isStale(run) || isAbortError(err)) return;
          session.status.set(e.id, 'error');
          run.failed++;
          run.lastError = errMsg(err);
        }
        run.done++;
        run.timing.loaded = session.exposureFrames.size;
        run.timing.failed = run.failed;
        useApp.getState().setStatus({ loaded: run.done, total: run.budget });
        bumpSession();
        this.scheduleRebuild(run);
        // Bundle and cache hits resolve as microtasks, so without this the whole field would load in
        // one long task: give input, paint and the blink a turn every ~25 ms of work.
        if (performance.now() - lastYield > 25) {
          await yieldToEventLoop();
          lastYield = performance.now();
          if (this.isStale(run)) return;
        }
      }
    } finally {
      run.workers--;
    }
  }

  /** Rebuild at most twice a second while loading. */
  private scheduleRebuild(run: Run): void {
    if (run.rebuildTimer) return;
    // At most twice a second, and never more than ~1/8 of the main thread (rebuilds grow with the field).
    const gap = Math.max(500, 8 * run.rebuildCost);
    const wait = Math.max(0, gap - (performance.now() - run.lastRebuild));
    run.rebuildTimer = setTimeout(() => {
      run.rebuildTimer = undefined;
      if (this.isStale(run)) return;
      const t = performance.now();
      this.rebuildSequence();
      run.rebuildCost = performance.now() - t;
      // Space rebuilds by their own cost too, so a slow rebuild cannot eat the whole main thread.
      run.lastRebuild = performance.now();
    }, wait);
  }

  private finishPass(run: Run): void {
    if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
    run.rebuildTimer = undefined;
    const st = useApp.getState();
    const loaded = session.exposureFrames.size;
    run.timing.done = performance.now();
    run.timing.loaded = loaded;
    publishTiming(run.timing);
    if (loaded === 0) {
      const why = run.lastError ? ` Last error: ${run.lastError}` : '';
      st.setStatus({ phase: 'error', message: `None of the ${run.budget} exposures could be read from the SPHEREx archive (network or HTTP failure).${why}` });
      return;
    }
    if (run.failed > 0) this.warn(`${run.failed} of ${run.budget} exposures could not be read and were left out.`);
    this.checkSaturation();
    this.rebuildSequence();
    const remaining = run.pending.length;
    st.setStatus({ phase: 'ready', loaded: run.done, total: run.budget, message: undefined, remaining });
    // Recompute after EVERY batch so full-data results replace the preview's measurements.
    // A scheduled preview pass must not run after "load more" or a new selection has started.
    const completed = run.done;
    const picked = st.picked;
    const current = () => !this.isStale(run) && run.done === completed && run.started === run.budget && run.workers === 0 && useApp.getState().picked === picked;
    const go = () => {
      if (!current()) return;
      // Gaia stars first (comparison stars and blend checks), but never wait more than 6 s.
      void Promise.race([this.ensureGaia(), new Promise((r) => setTimeout(r, 6000))]).then(() => {
        if (current()) void this.measure(picked);
      });
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(go, { timeout: 1500 });
    else setTimeout(go, 300);
    if (st.overlaysOn.gaia) void this.ensureGaia();
    if (st.overlaysOn.solarSystem) this.scheduleSso(0);
  }

  /** Load the next batch of exposures that the per-field cap left out. */
  loadMore(): void {
    const run = this.run;
    if (!run || this.isStale(run) || !run.pending.length) return;
    // Avoid extending the budget repeatedly while an explicit batch is still in flight.
    if (run.workers > 0) return;
    this.measureCtrl?.abort();
    clearMeasurements();
    useApp.getState().setSpectrum([]);
    run.budget = Math.min(run.started + run.pending.length, run.budget + MAX_EXPOSURES_PER_FIELD);
    run.timing.total = run.budget;
    run.timing.done = undefined;
    void this.loadAll(run);
  }

  /** Band group changed: the pending exposures of the new group go to the front. */
  private reprioritise(): void {
    const run = this.run;
    if (!run || this.isStale(run) || !run.pending.length) return;
    const group = loadingGroup();
    run.pending = orderForLoading(run.pending, session.visitOf, run.channelOf, group, session.wavelengthOf);
  }

  private checkSaturation(): void {
    const t = session.target;
    if (!t) return;
    let n = 0;
    let sat = 0;
    for (const cut of session.cutouts.values()) {
      const r = targetSaturated(cut, propagateSource(t, cut.header.mjdAvg));
      if (r === null) continue;
      n++;
      if (r) sat++;
    }
    if (n >= 4 && sat / n > 0.3) {
      this.notice({ id: 'saturated', text: 'pipeline.saturated', vars: { name: t.name, pct: Math.round((100 * sat) / n) }, level: 'warn' });
    }
  }

  // ------------------------------------------------------------------ sequences

  rebuildSequence(): void {
    prof('rebuild', () => this.rebuildSequenceNow());
  }

  private rebuildSequenceNow(): void {
    if (!session.grid) return;
    const st = useApp.getState();
    const all = [...session.exposureFrames.values()];
    if (!all.length) {
      if (st.frames.length) st.setFrames([]);
      return;
    }
    const group = BAND_GROUPS.find((g) => g.id === st.bandGroupId) ?? BAND_GROUPS[0];
    const visits = session.visits;
    const inGroup = all.filter((f) => inBandGroup(group, f.meta.detectors[0], f.meta.wavelength));
    let frames: SkyFrame[] = [];
    let diverging = false;
    try {
      const epochs = () => this.epochFrames(all, inGroup, visits, group, st.balanced);
      switch (st.sequence) {
        case 'epochs':
          frames = epochs();
          break;
        case 'pairs': {
          // Short extra visits (a few exposures) often share no channel with the rest: then the channel
          // seen in the most visits, and the visits without it are simply not shown.
          const mid = groupMidWavelength(group);
          const c = nearestChannelWithAllVisits(inGroup, visits, mid) ?? nearestChannelWithMostVisits(inGroup, visits, mid);
          frames = c ? buildMatchedPairs(inGroup, visits, c) : [];
          break;
        }
        case 'sweep': {
          const v = visitWithMostFrames(inGroup, visits, session.visitOf);
          frames = v ? buildSweepSequence(inGroup, v) : [];
          break;
        }
        case 'difference': {
          const ep = epochs();
          const ref = ep.find((f) => f.meta.visit === st.referenceVisit) ?? ep[0];
          if (ref) {
            const others = ep.filter((f) => f !== ref);
            frames = (others.length ? others : [ref]).map((f) =>
              differenceFrame(f, ref, `${visitLabelOf(f, visits)} minus ${visitLabelOf(ref, visits)} · difference`),
            );
          }
          diverging = true;
          break;
        }
        case 'thenNow': {
          const ep = epochs();
          frames = ep.length > 1 ? [ep[0], ep[ep.length - 1]] : ep;
          this.ensureExternal();
          break;
        }
        case 'coldFilter': {
          // Single-exposure frames of arrays 5 and 6 (whatever band group is selected): per visit,
          // stack(4.2-4.8 um) minus a scaled stack(3.82-4.05 um).
          const cold = all.filter((f) => f.meta.detectors[0] >= 5);
          frames = buildSpectralDifferenceSequence(cold, visits, COLD_FILTER, { scale: COLD_FILTER_SCALE });
          diverging = true;
          break;
        }
      }
    } catch (e) {
      console.warn('Sequence build failed:', e);
      this.warn(`Could not build this sequence: ${errMsg(e)}`);
      frames = [];
    }

    // One shared stretch for the whole sequence (never per frame), unless the user changed it.
    const cur = st.stretch;
    if (diverging && frames.length) {
      const h = symmetricRange(frames);
      st.setStretch({ lo: -h, hi: h, mode: 'linear', colormap: 'diverging', invert: false });
      this.auto = { lo: -h, hi: h, diverging: true };
    } else if (frames.length) {
      const r = displayRange(frames);
      const userAdjusted = !!this.auto && !this.auto.diverging && (Math.abs(cur.lo - this.auto.lo) > 1e-9 || Math.abs(cur.hi - this.auto.hi) > 1e-9);
      if (!userAdjusted || cur.colormap === 'diverging') {
        st.setStretch({ lo: r.lo, hi: r.hi, ...(cur.colormap === 'diverging' ? { colormap: 'gray' as const, mode: 'asinh' as const } : {}) });
        this.auto = { lo: r.lo, hi: r.hi, diverging: false };
      }
      if (st.sequence === 'thenNow' && session.external[0]) {
        frames = [rescaleForDisplay(session.external[0], useApp.getState().stretch.hi), ...frames];
      }
    }

    const phase = st.status.phase;
    if (!frames.length && phase === 'ready') {
      this.notice({ id: 'empty-sequence', text: 'pipeline.emptySequence', vars: { group: group.label }, level: 'info' });
    } else {
      st.removeNotice('empty-sequence');
    }
    prof('setFrames', () => st.setFrames(frames));
    this.updateOverlays();
    if (phase === 'ready' && st.overlaysOn.solarSystem) this.scheduleSso(800);
  }

  /** Balanced epochs over the visits that share enough channels; the others are named in a note. */
  private epochFrames(all: SkyFrame[], inGroup: SkyFrame[], visits: Visit[], group: (typeof BAND_GROUPS)[number], balanced: boolean): SkyFrame[] {
    if (!balanced) return buildEpochSequence(all, visits, group, { balanced: false });
    const chans = new Map<number, Set<number>>();
    const counts = new Map<number, number>();
    for (const f of inGroup) {
      const v = f.meta.visit;
      if (v === undefined) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      const c = frameCubeChannel(f);
      if (c <= 0) continue;
      let s = chans.get(v);
      if (!s) chans.set(v, (s = new Set()));
      s.add(c);
    }
    const pick = chooseBalancedVisits(chans, { framesByVisit: counts });
    if (pick.chosen.length < 2 || pick.leftOut.length === 0) return buildEpochSequence(all, visits, group, { balanced: true });
    const keep = new Set(pick.chosen);
    const frames = buildEpochSequence(
      all.filter((f) => f.meta.visit !== undefined && keep.has(f.meta.visit)),
      visits.filter((v) => keep.has(v.index)),
      group,
      { balanced: true },
    );
    const names = pick.leftOut.map((i) => visits.find((v) => v.index === i)?.label ?? `visit ${i}`).join(', ');
    const note = `left out ${names}: too few colour channels in common with the other dates`;
    return frames.map((f) => ({ ...f, meta: { ...f.meta, notes: [...(f.meta.notes ?? []), note] } }));
  }

  // ------------------------------------------------------------------ overlays

  private updateOverlays(): void {
    const st = useApp.getState();
    const frames = st.frames;
    const t = session.target;
    const out: Overlay[] = [];
    if (frames.length) {
      if (t) {
        frames.forEach((f, i) => {
          const p = propagateSource(t, f.meta.mjd);
          out.push({ id: `target:${i}`, kind: 'circle', ra: p.ra, dec: p.dec, sizeArcsec: 12, color: TARGET_COLOR, text: t.name, frameIndex: i });
        });
        const vs = session.visits;
        if (vs.length) {
          const path = predictTrack(t, vs[0].mjdMin, vs[vs.length - 1].mjdMax, 32);
          out.push({ id: 'track:target', kind: 'track', ra: path[0][0], dec: path[0][1], path, color: TARGET_COLOR, text: 'expected path' });
        }
      } else if (session.center) {
        out.push({ id: 'target:center', kind: 'circle', ra: session.center.ra, dec: session.center.dec, sizeArcsec: 12, color: CENTER_COLOR });
      }
      if (session.gaia && st.overlaysOn.gaia) {
        // A field near the Galactic plane holds hundreds of Gaia stars: draw only the brightest ones
        // (the Overlays tab still lists the catalogue), so the circles do not hide the image.
        const shown = session.gaia
          .filter((g) => g.mag === undefined || g.mag <= GAIA_DRAW_MAG)
          .sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99))
          .slice(0, GAIA_DRAW_MAX);
        const span = Math.max(...frames.map((f) => f.meta.mjd)) - Math.min(...frames.map((f) => f.meta.mjd));
        if (span < 30) {
          const mjd = frames.reduce((s, f) => s + f.meta.mjd, 0) / frames.length;
          out.push(...overlaysFromCatalog(shown, mjd, { idPrefix: 'gaia', labelMagLimit: 14 }));
        } else {
          frames.forEach((f, i) => out.push(...overlaysFromCatalog(shown, f.meta.mjd, { idPrefix: `gaia:${i}`, labelMagLimit: 14, frameIndex: i })));
        }
      }
      if (st.overlaysOn.solarSystem) out.push(...this.ssoOverlays);
    }
    st.setOverlays(out);
    // Cheap profiling/e2e hook (like __trueblinkProf): how many markers of each layer exist.
    if (typeof window !== 'undefined') {
      const counts: Record<string, number> = {};
      for (const o of out) counts[o.id.split(':')[0]] = (counts[o.id.split(':')[0]] ?? 0) + 1;
      (window as unknown as { __trueblinkOverlays?: Record<string, number> }).__trueblinkOverlays = counts;
    }
  }

  private ensureGaia(): Promise<void> {
    const run = this.run;
    if (!run || session.gaia || !session.center) return Promise.resolve();
    if (this.gaiaPending && this.gaiaPromise) return this.gaiaPromise;
    this.gaiaPending = true;
    const sid = session.id;
    this.gaiaPromise = gaiaCone(session.center, (session.fovArcsec / 2) * Math.SQRT2 + 30, run.ctrl.signal)
      .then((list) => {
        if (session.id !== sid) return;
        session.gaia = list;
        bumpSession();
        this.updateOverlays();
      })
      .catch((e) => {
        if (session.id !== sid || isAbortError(e)) return;
        this.warn(`Gaia catalogue stars are unavailable right now (${errMsg(e)}).`);
      })
      .finally(() => {
        if (session.id === sid) this.gaiaPending = false;
      });
    return this.gaiaPromise;
  }

  private ensureExternal(): void {
    const run = this.run;
    if (!run || !session.grid || this.externalPending || this.externalTried || session.external.length) return;
    this.externalPending = true;
    this.externalTried = true;
    const sid = session.id;
    const grid = session.grid;
    const tryOne = async () => {
      const reasons: string[] = [];
      for (const s of ['allwise-w2', '2mass-k'] as const) {
        try {
          return await externalFrame(s, grid, run.ctrl.signal);
        } catch (e) {
          if (isAbortError(e) || session.id !== sid) throw e;
          reasons.push(errMsg(e));
        }
      }
      throw new Error(reasons.join(' / '));
    };
    tryOne()
      .then((f) => {
        if (session.id !== sid) return;
        session.external = [f];
        bumpSession();
        if (useApp.getState().sequence === 'thenNow') this.rebuildSequence();
      })
      .catch((e) => {
        if (session.id !== sid || isAbortError(e)) return;
        this.notice({ id: 'external', text: 'pipeline.noExternal', level: 'info' });
        console.info('Older-survey frame unavailable:', errMsg(e));
      })
      .finally(() => {
        if (session.id === sid) this.externalPending = false;
      });
  }

  private scheduleSso(delayMs: number): void {
    if (this.ssoTimer) clearTimeout(this.ssoTimer);
    this.ssoTimer = setTimeout(() => {
      this.ssoTimer = undefined;
      const run = this.run;
      const st = useApp.getState();
      if (!run || this.isStale(run) || !st.overlaysOn.solarSystem || !st.frames.length) return;
      const frames = st.frames;
      const sid = session.id;
      solarSystemOverlays(frames, run.ctrl.signal)
        .then((ovs) => {
          if (session.id !== sid || useApp.getState().frames !== frames) return;
          this.ssoOverlays = ovs;
          this.updateOverlays();
        })
        .catch((e) => {
          if (session.id !== sid || isAbortError(e)) return;
          this.warn(`Known asteroids could not be looked up (${errMsg(e)}).`);
        });
    }, delayMs);
  }

  // ------------------------------------------------------------------ measuring, fov, cancel

  async measureAt(pos: SkyPos): Promise<void> {
    useApp.getState().pick(pos);
    await this.measure(pos);
  }

  private async measure(pos: SkyPos | null): Promise<void> {
    this.measureCtrl?.abort();
    const ctrl = new AbortController();
    this.measureCtrl = ctrl;
    const sid = session.id;
    try {
      const t = performance.now();
      await runMeasurements(pos, { signal: ctrl.signal });
      const r = (profRows['measure(async)'] ??= { n: 0, ms: 0, max: 0 });
      r.n++;
      r.ms += performance.now() - t;
      r.max = Math.max(r.max, performance.now() - t);
    } catch (e) {
      if (isAbortError(e) || session.id !== sid) return;
      this.warn(`Measurement failed: ${errMsg(e)}`);
    } finally {
      if (this.measureCtrl === ctrl) this.measureCtrl = null;
    }
  }

  setFov(arcsec: number): void {
    const st = useApp.getState();
    st.setFov(arcsec);
    const fov = useApp.getState().fovArcsec;
    if (!session.exposures.length || !session.center || fov === session.fovArcsec) return;
    // Same exposures, new windows: restart loading on a new session (old results are dropped).
    const keep = { target: session.target, exposures: session.exposures, visits: session.visits, source: session.source, warnings: session.warnings, bundle: session.bundle };
    const pos = session.target ? { ra: session.target.ra, dec: session.target.dec } : session.center;
    this.abortRun();
    this.measureCtrl?.abort();
    clearMeasurements();
    const sid = resetSession();
    session.target = keep.target;
    session.source = keep.source;
    session.warnings = keep.warnings;
    session.bundle = keep.bundle;
    this.auto = null;
    this.gaiaPending = false;
    this.externalTried = false;
    this.externalPending = false;
    this.ssoOverlays = [];
    const ctrl = new AbortController();
    const timing: PipelineTiming = { name: `${st.query} (fov ${fov}")`, t0: performance.now(), loaded: 0, total: 0, failed: 0, source: keep.source };
    this.run = { sid, ctrl, center: pos, grid: makeGrid(pos, fov), fov, pending: [], budget: 0, started: 0, done: 0, failed: 0, channelOf: new Map(), workers: 0, lastRebuild: 0, rebuildCost: 0, timing };
    st.setFrames([]);
    st.setOverlays([]);
    st.setSpectrum([]);
    st.setFindings([]);
    void this.startField(sid, ctrl, keep.target, pos, keep.exposures, keep.visits, fov).catch((e) => {
      if (session.id !== sid || isAbortError(e)) return;
      useApp.getState().setStatus({ phase: 'error', message: errMsg(e) });
    });
  }

  private abortRun(): void {
    const run = this.run;
    if (run) {
      if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
      run.ctrl.abort();
    }
    this.run = null;
    if (this.ssoTimer) clearTimeout(this.ssoTimer);
  }

  cancel(): void {
    const run = this.run;
    const busy = run && !run.ctrl.signal.aborted && ['resolving', 'searching', 'loading'].includes(useApp.getState().status.phase);
    this.measureCtrl?.abort();
    if (!run) return;
    run.ctrl.abort();
    if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
    if (!busy) return;
    // Keep what has loaded so far on screen.
    if (session.exposureFrames.size) this.rebuildSequence();
    useApp.getState().setStatus({ phase: session.exposureFrames.size ? 'ready' : 'idle', message: 'cancelled', remaining: run.pending.length + run.started - run.done });
  }

  /** Re-open whatever was opened last (used by "try again"). */
  reopen(): void {
    if (this.lastInput) void this.open(this.lastInput);
  }

  // ------------------------------------------------------------------ messages

  private warn(text: string): void {
    if (!session.warnings.includes(text)) session.warnings.push(text);
    const st = useApp.getState();
    st.setWarnings([...session.warnings]);
    this.notice({ id: `w:${text.slice(0, 60)}`, text, level: 'warn' });
  }

  private notice(n: Notice): void {
    useApp.getState().addNotice(n);
  }
}

function publishTiming(t: PipelineTiming): void {
  if (typeof window !== 'undefined') (window as unknown as { __trueblink?: PipelineTiming }).__trueblink = t;
}

/** Main-thread cost per step (count, total ms, worst ms), read by the e2e checks as window.__trueblinkProf. */
type ProfRow = { n: number; ms: number; max: number };
const profRows: Record<string, ProfRow> = {};
if (typeof window !== 'undefined') (window as unknown as { __trueblinkProf?: Record<string, ProfRow> }).__trueblinkProf = profRows;
export function prof<T>(label: string, fn: () => T): T {
  const t = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t;
    const r = (profRows[label] ??= { n: 0, ms: 0, max: 0 });
    r.n++;
    r.ms += dt;
    r.max = Math.max(r.max, dt);
  }
}

/** Yield to the event loop (a macrotask, so input and paint can run between chunks of work). */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      r();
    };
    ch.port2.postMessage(0);
  });
}
