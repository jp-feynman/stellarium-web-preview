// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Small building blocks shared by the hand-rolled SVG charts: a width-measuring container with a
// fixed height (no layout shift), a tooltip that never moves other content, and simple axes.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { fmtTick } from './helpers';
import { tEn } from './strings';
import type { Translate } from './strings';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Width of an element, kept current with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.floor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Tip {
  x: number;
  y: number;
  text: string;
}

/** Tooltip state with helpers to wire hover and keyboard focus on SVG marks. */
export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((x: number, y: number, text: string) => setTip({ x, y, text }), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

/** Event handlers that make an SVG mark hoverable and keyboard focusable with a tooltip. */
export function markProps(x: number, y: number, text: string, show: (x: number, y: number, text: string) => void, hide: () => void, onActivate?: () => void) {
  return {
    tabIndex: 0,
    role: 'img' as const,
    'aria-label': text,
    onMouseEnter: () => show(x, y, text),
    onMouseLeave: hide,
    onFocus: () => show(x, y, text),
    onBlur: hide,
    onClick: onActivate,
    onKeyDown: onActivate
      ? (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }
      : undefined,
  };
}

/**
 * Container for one chart: measures its width, reserves a fixed height before the first
 * measurement (so nothing jumps), and overlays the tooltip.
 */
export function ChartBox(props: {
  height: number | ((width: number) => number);
  ariaLabel: string;
  tip: Tip | null;
  children: (width: number, height: number) => ReactNode;
  className?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = typeof props.height === 'function' ? props.height(width || 600) : props.height;
  const tip = props.tip;
  let tipStyle: CSSProperties | undefined;
  if (tip) {
    const left = Math.max(4, Math.min(tip.x, width - 4));
    const flip = tip.x > width * 0.6;
    tipStyle = { left, top: Math.max(0, tip.y - 8), transform: flip ? 'translate(-100%, -100%)' : 'translate(0, -100%)' };
  }
  return (
    <div ref={ref} className={`rs-chartbox ${props.className ?? ''}`} style={{ height: h }}>
      {width > 0 && (
        <svg className="rs-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="group" aria-label={props.ariaLabel}>
          {props.children(width, h)}
        </svg>
      )}
      {tip && (
        <div className="rs-tip" role="status" style={tipStyle}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Horizontal axis with ticks, grid lines and a centred label. */
export function AxisX(props: {
  ticks: { v: number; label: string }[];
  scale: (v: number) => number;
  y: number;
  top: number;
  x0: number;
  x1: number;
  label?: string;
  color?: string;
  grid?: boolean;
}) {
  const color = props.color ?? 'var(--muted)';
  return (
    <g className="rs-axis">
      <line x1={props.x0} x2={props.x1} y1={props.y} y2={props.y} style={{ stroke: 'var(--border)' }} />
      {props.ticks.map((t) => {
        const x = props.scale(t.v);
        if (!Number.isFinite(x) || x < props.x0 - 0.5 || x > props.x1 + 0.5) return null;
        return (
          <g key={`${t.v}`}>
            {props.grid !== false && <line className="rs-grid" x1={x} x2={x} y1={props.top} y2={props.y} />}
            <line x1={x} x2={x} y1={props.y} y2={props.y + 4} style={{ stroke: 'var(--border)' }} />
            <text x={x} y={props.y + 16} textAnchor="middle" style={{ fill: color }} className="rs-tick">
              {t.label}
            </text>
          </g>
        );
      })}
      {props.label && (
        <text x={(props.x0 + props.x1) / 2} y={props.y + 33} textAnchor="middle" className="rs-axislabel" style={{ fill: color }}>
          {props.label}
        </text>
      )}
    </g>
  );
}

/** Vertical axis with ticks, grid lines and a rotated label. */
export function AxisY(props: {
  ticks: number[];
  scale: (v: number) => number;
  x: number;
  x1: number;
  y0: number;
  y1: number;
  label?: string;
  color?: string;
  format?: (v: number) => string;
  showLabels?: boolean;
}) {
  const color = props.color ?? 'var(--muted)';
  const f = props.format ?? fmtTick;
  const top = Math.min(props.y0, props.y1);
  const bottom = Math.max(props.y0, props.y1);
  return (
    <g className="rs-axis">
      <line x1={props.x} x2={props.x} y1={top} y2={bottom} style={{ stroke: 'var(--border)' }} />
      {props.ticks.map((v) => {
        const y = props.scale(v);
        if (!Number.isFinite(y) || y < top - 0.5 || y > bottom + 0.5) return null;
        return (
          <g key={v}>
            <line className="rs-grid" x1={props.x} x2={props.x1} y1={y} y2={y} />
            {props.showLabels !== false && (
              <text x={props.x - 5} y={y + 4} textAnchor="end" style={{ fill: color }} className="rs-tick">
                {f(v)}
              </text>
            )}
          </g>
        );
      })}
      {props.label && (
        <text transform={`translate(${12}, ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" className="rs-axislabel" style={{ fill: color }}>
          {props.label}
        </text>
      )}
    </g>
  );
}

/** Vertical error bar with caps. */
export function ErrBarY(props: { x: number; y0: number; y1: number; color: string; cap?: number }) {
  const c = props.cap ?? 3;
  if (!Number.isFinite(props.y0) || !Number.isFinite(props.y1)) return null;
  return (
    <g style={{ stroke: props.color }} className="rs-err">
      <line x1={props.x} x2={props.x} y1={props.y0} y2={props.y1} />
      <line x1={props.x - c} x2={props.x + c} y1={props.y0} y2={props.y0} />
      <line x1={props.x - c} x2={props.x + c} y1={props.y1} y2={props.y1} />
    </g>
  );
}

/** HTML legend row (wraps on narrow screens instead of clipping). */
export function Legend(props: { items: { label: string; color: string; kind?: 'dot' | 'hollow' | 'line' | 'dash' | 'band' | 'square' }[] }) {
  return (
    <ul className="rs-legend">
      {props.items.map((it) => (
        <li key={it.label + it.kind}>
          <svg width="18" height="12" aria-hidden="true">
            {(!it.kind || it.kind === 'dot') && <circle cx="9" cy="6" r="4" style={{ fill: it.color }} />}
            {it.kind === 'hollow' && <circle cx="9" cy="6" r="3.5" style={{ fill: 'none', stroke: it.color, strokeWidth: 1.5 }} />}
            {it.kind === 'square' && <rect x="5" y="2" width="8" height="8" style={{ fill: it.color }} />}
            {it.kind === 'line' && <line x1="1" x2="17" y1="6" y2="6" style={{ stroke: it.color, strokeWidth: 2 }} />}
            {it.kind === 'dash' && <line x1="1" x2="17" y1="6" y2="6" style={{ stroke: it.color, strokeWidth: 2, strokeDasharray: '4 3' }} />}
            {it.kind === 'band' && <rect x="1" y="2" width="16" height="8" style={{ fill: it.color, opacity: 0.35 }} />}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function useT(t?: Translate): Translate {
  return t ?? tEn;
}
