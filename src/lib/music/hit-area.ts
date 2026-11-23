/** Minimum comfortable tap target, matching the existing 44px chrome rule. */
export const MIN_HIT_PX = 44;

/** SVG user units per CSS pixel. Falls back to 1 when the element is not laid out (tests). */
export function svgUnitPerPx(svg: SVGSVGElement): number {
  const rect = typeof svg.getBoundingClientRect === "function" ? svg.getBoundingClientRect() : undefined;
  const view = svg.viewBox?.baseVal;
  const vbWidth = view && view.width ? view.width : Number(svg.getAttribute("width")) || 0;
  if (rect && rect.width > 1 && vbWidth > 0) return vbWidth / rect.width;
  return 1;
}

/** Side length in SVG units that maps to at least 44 CSS pixels on screen. */
export function minHitUnits(svg: SVGSVGElement, fallback = 24): number {
  return Math.max(MIN_HIT_PX * svgUnitPerPx(svg), fallback);
}

export function expandRect(
  x: number,
  y: number,
  width: number,
  height: number,
  min: number,
): { x: number; y: number; width: number; height: number } {
  const w = Math.max(width, min);
  const h = Math.max(height, min);
  return { x: x + width / 2 - w / 2, y: y + height / 2 - h / 2, width: w, height: h };
}

/** True when (x, y) is inside a client rect grown to at least 44×44. */
export function hitContains(rect: DOMRect, x: number, y: number, min = MIN_HIT_PX): boolean {
  const padX = Math.max(0, (min - rect.width) / 2);
  const padY = Math.max(0, (min - rect.height) / 2);
  return x >= rect.left - padX && x <= rect.right + padX && y >= rect.top - padY && y <= rect.bottom + padY;
}

export function hitDistance(rect: DOMRect, x: number, y: number): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  return Math.hypot(dx, dy);
}
