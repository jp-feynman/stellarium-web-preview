// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Type declarations for scripts/hips-rewrite.mjs (the SPHEREx channel rewriter).

export interface HipsOptions {
  /** 'redirect' (default): 302 to IRSA. 'stream': fetch the tile and pass the bytes through. */
  mode?: 'redirect' | 'stream' | string;
  /** fetch implementation used in stream mode (tests). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export type HipsTarget =
  | { kind: 'properties'; channel: number }
  | { kind: 'file'; channel: number; upstream: string; type: string };

export const UPSTREAM_CUBE: string;
export const PREFIX: string;
export const DEFAULT_MODE: 'redirect';
export const TIMEOUT_MS: number;
export const MAX_TILE_BYTES: number;
export const BLANK_CHANNELS: number[];
export const MAX_ORDER: number;
export function channelWavelength(c: number): string | undefined;
export function isServedChannel(c: number): boolean;
export function resolvePath(pathname: string): HipsTarget | null;
export function propertiesText(c: number): string;
export function handleHips(request: Request, options?: HipsOptions): Promise<Response>;
