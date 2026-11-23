/** Keeps the sounding note in view while playing; the score stage is its own scroller. */

/**
 * New scrollTop that brings an item back into the comfortable middle of a
 * scroller, or null when it is already there. Rects are client coordinates.
 */
export function followScrollTop(
  view: { top: number; height: number; scrollTop: number; maxScroll: number },
  item: { top: number; bottom: number },
  margin = 0.2,
): number | null {
  if (!(view.height > 0)) return null;
  const low = view.top + view.height * margin;
  const high = view.top + view.height * (1 - margin);
  if (item.top >= low && item.bottom <= high) return null;
  const target = view.scrollTop + (item.top - view.top) - view.height * 0.3;
  const clamped = Math.max(0, Math.min(view.maxScroll, Math.round(target)));
  return Math.abs(clamped - view.scrollTop) < 1 ? null : clamped;
}

/** Same rule along x, for a line wider than its row. */
export function followScrollLeft(
  view: { left: number; width: number; scrollLeft: number; maxScroll: number },
  item: { left: number; right: number },
): number | null {
  if (!(view.width > 0) || view.maxScroll <= 0) return null;
  if (item.left >= view.left + view.width * 0.15 && item.right <= view.left + view.width * 0.85) return null;
  const target = view.scrollLeft + (item.left - view.left) - view.width * 0.3;
  const clamped = Math.max(0, Math.min(view.maxScroll, Math.round(target)));
  return Math.abs(clamped - view.scrollLeft) < 1 ? null : clamped;
}

function reduced(el: Element) {
  return el.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * How much of the stage's top edge a sticky strip (the chord guide) covers, in px.
 * Scrolling and page turns treat that band as off screen so no note lands under it.
 */
export function stickyCover(stage: Element): number {
  const top = stage.getBoundingClientRect().top;
  let cover = 0;
  for (const strip of stage.querySelectorAll<HTMLElement>(".chord-guide")) {
    if (strip.ownerDocument.defaultView?.getComputedStyle(strip).position !== "sticky") continue;
    cover = Math.max(cover, strip.getBoundingClientRect().bottom - top);
  }
  return Math.max(0, Math.min(cover, stage.clientHeight * 0.75));
}

/** Scrolls only the score's own scrollers (never the page) so `el` stays visible. */
export function followInto(el: Element) {
  const rect = el.getBoundingClientRect();
  const behavior: ScrollBehavior = reduced(el) ? "auto" : "smooth";
  const line = el.closest<HTMLElement>(".jianpu-line");
  if (line && line.scrollWidth > line.clientWidth) {
    const box = line.getBoundingClientRect();
    const left = followScrollLeft(
      { left: box.left, width: line.clientWidth, scrollLeft: line.scrollLeft, maxScroll: line.scrollWidth - line.clientWidth },
      { left: rect.left, right: rect.right },
    );
    if (left !== null) line.scrollTo({ left, behavior });
  }
  const stage = el.closest<HTMLElement>(".score-stage");
  if (!stage || stage.scrollHeight <= stage.clientHeight) return;
  const box = stage.getBoundingClientRect();
  const cover = stickyCover(stage);
  const top = followScrollTop(
    { top: box.top + cover, height: stage.clientHeight - cover, scrollTop: stage.scrollTop, maxScroll: stage.scrollHeight - stage.clientHeight },
    { top: rect.top, bottom: rect.bottom },
  );
  if (top !== null) stage.scrollTo({ top, behavior });
}
