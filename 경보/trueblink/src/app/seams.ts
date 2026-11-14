// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Typed seams between the UI shell and the modules plugged into it at integration time:
//  - the data pipeline (AppPipeline; MockPipeline until src/app/pipeline.ts exists),
//  - the blink renderer (StageLike; a 2D canvas fallback until gl/BlinkStage is injected),
//  - the Research panel tabs (registerResearchTab; filled by src/app/research).
import type { ComponentType } from 'react';
import type { Overlay, SkyFrame, SkyPos, Stretch } from '../core/types';

// ---------------------------------------------------------------- pipeline

export interface AppPipeline {
  /** Resolve a name or take coordinates, search the archive, stream frames into the store. */
  /** keepView: the link already chose sequence/band (do not apply a challenge target's default view). */
  open(input: { name?: string; ra?: number; dec?: number; label?: string; keepView?: boolean }): Promise<void>;
  /** Change the field of view and rebuild frames for it. */
  setFov(arcsec: number): void;
  /** Rebuild store.frames from the store's sequence / bandGroupId / balanced / referenceVisit. */
  rebuildSequence(): void;
  /** Measure the source at a sky position (photometry over all exposures) into store.spectrum / findings. */
  measureAt(pos: SkyPos): Promise<void>;
  /** Abort whatever is in flight and leave the store in a consistent state. */
  cancel(): void;
}

let pipeline: AppPipeline | null = null;

export function setPipeline(p: AppPipeline): void {
  pipeline?.cancel();
  pipeline = p;
}

export function getPipeline(): AppPipeline | null {
  return pipeline;
}

// ---------------------------------------------------------------- stage

export type StageMode = 'single' | 'blend' | 'difference' | 'rgb';
export type StageEvent = 'frame' | 'pick' | 'hover' | 'view';

/** Payload of 'pick' and 'hover' events (same shape as gl/BlinkStage). */
export interface StagePick {
  ra: number;
  dec: number;
  i: number;
  j: number;
  value: number;
  frameIndex: number;
  overlay?: Overlay;
}

/** The subset of gl/BlinkStage (docs/ARCHITECTURE.md) that the shell uses. BlinkStage satisfies it as is. */
export interface StageLike {
  setFrames(frames: SkyFrame[]): void;
  setFrameIndex(i: number): void;
  setStretch(s: Stretch): void;
  setMode(mode: StageMode, opts?: { a?: number; b?: number; rgb?: [number, number, number] }): void;
  setOverlays(overlays: Overlay[]): void;
  play(msPerFrame: number): void;
  pause(): void;
  /** 'frame' payload: the new frame index (number). 'pick' / 'hover': StagePick. Returns an unsubscribe function. */
  on(event: StageEvent, cb: (payload: unknown) => void): () => void;
  resize(): void;
  dispose(): void;
  setView?(v: { zoom?: number; centerRa?: number; centerDec?: number }): void;
  resetView?(): void;
}

export type StageFactory = (container: HTMLElement) => StageLike;

let stageFactory: StageFactory | null = null;

/** Inject the real renderer, e.g. setStageFactory((el) => new BlinkStage(el, { pixelated: true })). */
export function setStageFactory(f: StageFactory | null): void {
  stageFactory = f;
}

export function getStageFactory(): StageFactory | null {
  return stageFactory;
}

// ---------------------------------------------------------------- research tabs

export interface ResearchTab {
  id: string;
  title: string;
  Component: ComponentType;
}

const researchTabs = new Map<string, ResearchTab>();
const tabListeners = new Set<() => void>();

/**
 * Put a component in a Research panel tab. Built-in tab ids: frames, measure, overlays, asteroid,
 * provenance (registering one of these replaces its placeholder); any other id adds a new tab.
 * `title` may be an i18n key or plain text.
 */
export function registerResearchTab(id: string, title: string, Component: ComponentType): void {
  researchTabs.set(id, { id, title, Component });
  tabListeners.forEach((l) => l());
}

export function getResearchTabs(): ResearchTab[] {
  return [...researchTabs.values()];
}

export function onResearchTabsChange(cb: () => void): () => void {
  tabListeners.add(cb);
  return () => tabListeners.delete(cb);
}
