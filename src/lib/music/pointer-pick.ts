/** Pointer travel (CSS px) beyond which a press is a scroll, not a tap. */
export const PICK_SLOP_PX = 10;
/** Hold duration that extends the selection, standing in for Shift on a phone. */
export const LONG_PRESS_MS = 480;

export function pointerMoved(
  startX: number,
  startY: number,
  x: number,
  y: number,
  slop = PICK_SLOP_PX,
): boolean {
  const dx = x - startX;
  const dy = y - startY;
  return dx * dx + dy * dy > slop * slop;
}

export function isLongPress(startAt: number, now = Date.now(), ms = LONG_PRESS_MS): boolean {
  return now - startAt >= ms;
}

export type ScoreHit = {
  kind: "note" | "cursor";
  index?: number;
  cursor?: number;
  voice?: number;
};

export type ScorePointerHandlers = {
  hit: (x: number, y: number, target: EventTarget | null) => ScoreHit | undefined;
  onNote: (index: number, extend: boolean, voice?: number) => void;
  onCursor?: (cursor: number, voice?: number) => void;
};

/**
 * Tap, long-press (extend), and drag-to-range on a score surface.
 * Playwright's `dispatchEvent("click")` still reaches the click path.
 * A real pointer gesture is handled on pointerup and the trailing click is ignored.
 */
export function bindScorePointer(element: HTMLElement, handlers: ScorePointerHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let startHit: ScoreHit | undefined;
  let moved = false;
  let ignoreClick = false;
  let pointerId: number | null = null;

  function pick(hit: ScoreHit, extend: boolean) {
    if (hit.kind === "cursor") handlers.onCursor?.(hit.cursor ?? 0, hit.voice);
    else if (hit.index != null) handlers.onNote(hit.index, extend, hit.voice);
  }

  function onDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startAt = Date.now();
    startHit = handlers.hit(event.clientX, event.clientY, event.target);
    moved = false;
    ignoreClick = false;
  }

  function onMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    if (pointerMoved(startX, startY, event.clientX, event.clientY)) moved = true;
  }

  function onUp(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    if (moved) {
      ignoreClick = true;
      const endHit = handlers.hit(event.clientX, event.clientY, event.target);
      if (
        startHit?.kind === "note" &&
        endHit?.kind === "note" &&
        startHit.index != null &&
        endHit.index != null &&
        (startHit.index !== endHit.index || startHit.voice !== endHit.voice)
      ) {
        pick(startHit, false);
        pick(endHit, true);
      }
      return;
    }
    const hit = handlers.hit(event.clientX, event.clientY, event.target) ?? startHit;
    if (!hit) return;
    ignoreClick = true;
    pick(hit, event.shiftKey || event.metaKey || isLongPress(startAt));
  }

  function onCancel(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    ignoreClick = true;
  }

  function onClick(event: MouseEvent) {
    if (ignoreClick) {
      ignoreClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const hit = handlers.hit(event.clientX, event.clientY, event.target);
    if (!hit) return;
    pick(hit, event.shiftKey || event.metaKey);
  }

  function onMenu(event: Event) {
    if (startHit && isLongPress(startAt)) event.preventDefault();
  }

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onCancel);
  element.addEventListener("click", onClick);
  element.addEventListener("contextmenu", onMenu);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("pointerup", onUp);
    element.removeEventListener("pointercancel", onCancel);
    element.removeEventListener("click", onClick);
    element.removeEventListener("contextmenu", onMenu);
  };
}
