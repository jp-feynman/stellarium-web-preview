import { describe, expect, it, vi } from 'vitest';
import { revealFrameInStrip } from '../src/app/components/filmstripScroll';

function rect(left: number, right: number, top = 900, height = 64): DOMRect {
  return { left, right, top, bottom: top + height, width: right - left, height,
    x: left, y: top, toJSON: () => ({}) };
}

function fixture(itemLeft: number, itemRight: number, opts: { width?: number; top?: number } = {}) {
  // The filmstrip can be below the visible page after the user has scrolled up.
  const page = { scrollTop: 120, scrollTo: vi.fn(), scrollIntoView: vi.fn(), focus: vi.fn() };
  const strip = {
    clientLeft: 2,
    clientWidth: opts.width ?? 200,
    scrollWidth: 1000,
    scrollLeft: 300,
    scrollTop: 7,
    getBoundingClientRect: () => rect(100, 304, opts.top ?? 900),
    parentElement: page,
    scrollIntoView: vi.fn(() => { page.scrollTop = 900; }),
    focus: vi.fn(),
    scrollTo: vi.fn((position: ScrollToOptions) => {
      if (position.left !== undefined) strip.scrollLeft = position.left;
      if (position.top !== undefined) strip.scrollTop = position.top;
    }),
  };
  const item = {
    getBoundingClientRect: () => rect(itemLeft, itemRight, opts.top ?? 900),
    parentElement: strip,
    scrollIntoView: vi.fn(() => { page.scrollTop = 900; }),
    focus: vi.fn(() => { page.scrollTop = 900; }),
  };
  const reveal = (reduced = false) => revealFrameInStrip(strip as unknown as HTMLElement, item as unknown as HTMLElement, reduced);
  function expectNoVerticalNavigation() {
    expect(page.scrollTop).toBe(120);
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(page.scrollIntoView).not.toHaveBeenCalled();
    expect(page.focus).not.toHaveBeenCalled();
    expect(strip.scrollIntoView).not.toHaveBeenCalled();
    expect(strip.focus).not.toHaveBeenCalled();
    expect(item.scrollIntoView).not.toHaveBeenCalled();
    expect(item.focus).not.toHaveBeenCalled();
    expect(strip.scrollTop).toBe(7);
  }
  return { page, strip, item, reveal, expectNoVerticalNavigation };
}

describe('frame strip auto-follow never takes over page scrolling', () => {
  it('does not move an offscreen page when the active thumbnail is already horizontally visible', () => {
    const f = fixture(120, 290, { top: 1400 });
    f.reveal();
    expect(f.strip.scrollTo).not.toHaveBeenCalled();
    expect(f.strip.scrollLeft).toBe(300);
    f.expectNoVerticalNavigation();
  });

  it('reveals only the right overflow inside the strip while preserving its vertical scroll', () => {
    const f = fixture(280, 350);
    f.reveal();
    // The content viewport is [102, 302]: the rightmost 48 pixels are clipped.
    expect(f.strip.scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 348, top: 7, behavior: 'smooth' });
    expect(f.strip.scrollLeft).toBe(348);
    f.expectNoVerticalNavigation();
  });

  it('reveals only the left overflow without scrolling the surrounding page or iframe', () => {
    const f = fixture(80, 170);
    f.reveal();
    expect(f.strip.scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 278, top: 7, behavior: 'smooth' });
    f.expectNoVerticalNavigation();
  });

  it('leaves a thumbnail exactly on both content edges untouched', () => {
    const f = fixture(102, 302);
    f.reveal();
    expect(f.strip.scrollTo).not.toHaveBeenCalled();
    f.expectNoVerticalNavigation();
  });

  it('respects reduced motion for horizontal follow', () => {
    const f = fixture(280, 350);
    f.reveal(true);
    expect(f.strip.scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 348, top: 7, behavior: 'auto' });
    f.expectNoVerticalNavigation();
  });

  it('does nothing when the strip has no layout width', () => {
    const f = fixture(280, 350, { width: 0 });
    f.reveal();
    expect(f.strip.scrollTo).not.toHaveBeenCalled();
    f.expectNoVerticalNavigation();
  });
});
