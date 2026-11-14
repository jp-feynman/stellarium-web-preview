// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Hosts the blink renderer. Uses the injected StageFactory (gl/BlinkStage at integration) or the
// built-in 2D canvas fallback, and keeps it in step with the store.
import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { getPipeline, getStageFactory, type StageLike, type StagePick } from '../seams';
import { CanvasStage } from '../stage2d';
import { useApp, visibleOverlays } from '../store';
import { setHover } from './ViewExtras';

export function ViewerCanvas() {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<StageLike | null>(null);
  const frames = useApp((s) => s.frames);
  const frameIndex = useApp((s) => s.frameIndex);
  const stretch = useApp((s) => s.stretch);
  const overlays = useApp((s) => s.overlays);
  const overlaysOn = useApp((s) => s.overlaysOn);
  const playing = useApp((s) => s.playing);
  const speedMs = useApp((s) => s.speedMs);
  const zoom = useApp((s) => s.zoom);
  const sequence = useApp((s) => s.sequence);

  // Create the stage once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const factory = getStageFactory();
    let st: StageLike;
    try {
      st = factory ? factory(el) : new CanvasStage(el);
    } catch (e) {
      // WebGL unavailable or the renderer failed: fall back to 2D so the user still sees pixels.
      console.warn('Blink renderer failed, using the 2D fallback:', e);
      el.innerHTML = '';
      st = new CanvasStage(el);
    }
    stage.current = st;
    // 'frame' payload: a number (2D fallback) or { frameIndex, count, meta } (gl/BlinkStage).
    const offFrame = st.on('frame', (p) => {
      const i = typeof p === 'number' ? p : (p as { frameIndex?: unknown } | null)?.frameIndex;
      if (typeof i === 'number' && i !== useApp.getState().frameIndex) useApp.getState().selectFrame(i);
    });
    const offHover = st.on('hover', (p) => {
      const h = p as StagePick | null;
      setHover(h && Number.isFinite(h.ra) ? { ra: h.ra, dec: h.dec, value: h.value } : null);
    });
    const offPick = st.on('pick', (p) => {
      const pk = p as StagePick;
      if (!Number.isFinite(pk?.ra)) return;
      const pos = { ra: pk.ra, dec: pk.dec };
      useApp.getState().pick(pos);
      void getPipeline()?.measureAt(pos);
    });
    const onResize = () => st.resize();
    window.addEventListener('resize', onResize);
    return () => {
      offFrame();
      offPick();
      offHover();
      setHover(null);
      window.removeEventListener('resize', onResize);
      st.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    stage.current?.setStretch(stretch);
  }, [stretch]);

  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    st.setFrames(frames);
    st.setFrameIndex(useApp.getState().frameIndex);
  }, [frames]);

  useEffect(() => {
    stage.current?.setFrameIndex(frameIndex);
  }, [frameIndex, frames]);

  useEffect(() => {
    // Difference frames arrive precomputed from the pipeline, so the stage always shows one frame at a time.
    stage.current?.setMode('single');
  }, [sequence]);

  useEffect(() => {
    stage.current?.setOverlays(visibleOverlays(overlays, overlaysOn));
  }, [overlays, overlaysOn, frames]);

  useEffect(() => {
    stage.current?.setView?.({ zoom });
  }, [zoom, frames]);

  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    if (playing && frames.length > 1) st.play(speedMs);
    else st.pause();
    return () => st.pause();
  }, [playing, speedMs, frames]);

  return <div ref={host} className="viewer-canvas" role="img" aria-label={t('viewer.label')} data-testid="viewer-canvas" />;
}
