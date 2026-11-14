/** Follow the active frame horizontally without moving the document or its containing iframe. */
export function revealFrameInStrip(strip: HTMLElement, item: HTMLElement, reducedMotion: boolean): void {
  if (strip.clientWidth <= 0) return;
  const viewportLeft = strip.getBoundingClientRect().left + strip.clientLeft;
  const viewportRight = viewportLeft + strip.clientWidth;
  const frame = item.getBoundingClientRect();
  let delta = 0;
  if (frame.left < viewportLeft || frame.width > strip.clientWidth) delta = frame.left - viewportLeft;
  else if (frame.right > viewportRight) delta = frame.right - viewportRight;
  if (Math.abs(delta) < 1) return;
  // scrollIntoView also scrolls ancestor containers, pulling the page back on every blink.
  // Change only this strip's horizontal offset and preserve its own vertical offset as well.
  strip.scrollTo({ left: strip.scrollLeft + delta, top: strip.scrollTop, behavior: reducedMotion ? 'auto' : 'smooth' });
}
