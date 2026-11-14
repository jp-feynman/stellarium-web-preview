// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Small zustand store for the rich measurement results the Research tabs show.
import { create } from 'zustand';
import type { FindingSpec } from './findings';
import type { MeasureResult } from './types';

export interface MeasureState {
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  result: MeasureResult | null;
  specs: FindingSpec[];
  set(p: Partial<Omit<MeasureState, 'set' | 'clear'>>): void;
  clear(): void;
}

export const useMeasure = create<MeasureState>()((set) => ({
  status: 'idle',
  result: null,
  specs: [],
  set: (p) => set(p),
  clear: () => set({ status: 'idle', error: undefined, result: null, specs: [] }),
}));
