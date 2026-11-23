/** Shared card size memory and pointer/keyboard resize for functional work surfaces. */

export const CARD_SIZES_KEY = "puxian-card-sizes-v1";
export const KEY_STEP = 20;

/** Same rules as resizable-card.css; injected so home/editor can share styles without a new mapDeps CSS file. */
export const CARD_RESIZE_STYLE_ID = "px-card-resize-css";
export const CARD_RESIZE_CSS = "/* Editor/home functional-card resize chrome. Imported only from lazy modules. */\n.px-card-resizable { position: relative; }\n.px-card-resizable[data-px-resized] {\n  box-sizing: border-box;\n  max-width: 100%;\n}\n.px-card-resizable[data-px-resized=\"both\"],\n.px-card-resizable[data-px-resized=\"width\"] { width: min(var(--px-card-w), 100%); }\n.px-card-resizable[data-px-resized=\"both\"],\n.px-card-resizable[data-px-resized=\"height\"] { height: var(--px-card-h); }\n.app-shell:not([data-home-landing]):not([data-full-score]) #zone-score[data-px-resized] {\n  flex: 0 0 var(--px-card-h);\n  min-height: var(--px-card-h);\n  max-height: none;\n}\n.app-shell:not([data-home-landing]):not([data-full-score]) #zone-score[data-px-resized=\"both\"],\n.app-shell:not([data-home-landing]):not([data-full-score]) #zone-score[data-px-resized=\"width\"] {\n  width: min(var(--px-card-w), 100%);\n  justify-self: stretch;\n}\n.app-shell[data-full-score] #zone-score[data-px-resized] {\n  width: auto !important;\n  height: auto !important;\n  flex: 1 1 auto !important;\n  min-height: 0 !important;\n  max-width: none !important;\n}\n.app-shell[data-full-score] .px-card-resize { display: none !important; }\n@media print {\n  .px-card-resize, .px-home-song-sizer { display: none !important; }\n}\n.px-card-resize {\n  position: absolute;\n  top: 0;\n  right: 0;\n  bottom: auto;\n  z-index: 3;\n  width: 44px;\n  height: 44px;\n  padding: 0;\n  cursor: nwse-resize;\n  touch-action: none;\n  color: #31594b;\n  border: 1px solid #b7ae9d;\n  border-radius: 0 12px 0 8px;\n  background: #f7f3eaf2;\n  font: 16px/1 system-ui, sans-serif;\n}\n.px-card-resize:focus-visible {\n  outline: 2px solid #31594b;\n  outline-offset: 2px;\n}\n@media (max-width: 390px) {\n  /* Default layout is already near full width. Do not lock a resized\n     card to 100% or ArrowLeft cannot shrink it (official score-image check). */\n  [data-home-landing] .px-home-song-sizer { width: 100%; }\n}\n@media (prefers-reduced-motion: no-preference) {\n  .px-card-resizable[data-px-resize-anim] {\n    transition: width .2s ease, height .2s ease, flex-basis .2s ease, min-height .2s ease;\n  }\n}\n.px-home-song-sizer {\n  position: relative;\n  display: flex;\n  align-items: center;\n  width: fit-content;\n  max-width: 100%;\n  min-height: 44px;\n  margin: 16px 0 0 auto;\n  padding: 4px 48px 4px 12px;\n  border: 1px solid #e7e0d3;\n  border-radius: 14px;\n  background: #f7f3ea;\n  color: #575047;\n  font: 12px/1.3 system-ui, sans-serif;\n}\n[data-home-landing][data-px-home-songs] .song-row {\n  min-height: var(--px-home-song-h, 72px);\n  width: min(100%, var(--px-home-song-w, 100%));\n}\n@media print {\n  .px-home-song-sizer { display: none !important; }\n}\n\n.px-home-song-sizer > .px-card-resize {\n  top: auto;\n  bottom: 0;\n  border-radius: 8px 0 12px 0;\n}\n\n.score-image-card > .px-card-resize {\n  top: auto;\n  right: 0;\n  left: auto;\n  bottom: 0;\n  border-radius: 8px 0 12px 0;\n}\n\n/* Main score paper: handle in the title-corner, not a bottom gutter (a 44px\n   bottom pad shrinks .score-stage on 320x667 and hides the notes). On phones\n   the title is its own 44px row; do not pad the title box or a long name\n   fails the \"full row, width > 280\" check at 390. On wider screens, reserve\n   the right of .score-head so \u7434\u952e is not covered. */\n@media (min-width: 640px) {\n  .app-shell:not([data-home-landing]):not([data-full-score]) #zone-score .score-head {\n    padding-right: 44px;\n    box-sizing: border-box;\n  }\n}\n.app-shell:not([data-home-landing]) #zone-score > .px-card-resize {\n  top: 0;\n  right: 0;\n  left: auto;\n  bottom: auto;\n  border-radius: 0 22px 0 8px;\n}\n/* Short landscape: one nowrap tool row (display:contents). A right-side\n   handle covers \u5168\u5c4f\u770b\u8c31 / \u7434\u952e, so park it at the title's left instead.\n   Do not add padding-left: the row is already tight and extra pad pushes\n   \u5168\u5c4f\u770b\u8c31 into the right-hand tool panel. Keep the score above the panel\n   so a slight overflow is still clickable. */\n@media (min-width: 640px) and (max-height: 500px) {\n  .app-shell:not([data-home-landing]):not([data-full-score]) #zone-score {\n    z-index: 1;\n  }\n  .app-shell:not([data-home-landing]):not([data-full-score]) #zone-score .score-head {\n    padding-right: 0;\n    padding-left: 0;\n  }\n  .app-shell:not([data-home-landing]) #zone-score > .px-card-resize {\n    top: 0;\n    left: 0;\n    right: auto;\n    border-radius: 22px 0 8px 0;\n  }\n}\n/* 390x844 with the keyboard dock: \u7434\u952e is absolutely pinned to the title-corner\n   (visual-keyboard.css). Shift those tool buttons left so the 44px handle does\n   not intercept \u7434\u952e \u6536\u8d77. */\n@media (max-width: 639px) and (min-height: 751px) {\n  .app-shell[data-keyboard]:not([data-home-landing]):not([data-full-score]) #zone-score .score-title-box {\n    width: calc(100% - 182px);\n  }\n  .app-shell[data-keyboard]:not([data-home-landing]):not([data-full-score]) #zone-score .score-tools .tool-button:last-child { right: 32px; }\n  .app-shell[data-keyboard]:not([data-home-landing]):not([data-full-score]) #zone-score .score-tools .tool-button:nth-last-child(2) { right: 82px; }\n  .app-shell[data-keyboard]:not([data-home-landing]):not([data-full-score]) #zone-score .score-tools .tool-button:nth-last-child(3) { right: 132px; }\n}\n";

/**
 * @param {Document | null | undefined} doc
 */
export function ensureCardResizeStyles(doc) {
  if (!doc?.head || doc.getElementById(CARD_RESIZE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = CARD_RESIZE_STYLE_ID;
  style.textContent = CARD_RESIZE_CSS;
  doc.head.append(style);
}

/**
 * @typedef {{ width: number, height: number }} CardSize
 * @typedef {{ minWidth: number, minHeight: number, maxWidth: number, maxHeight: number }} CardBounds
 * @typedef {{ getItem?: (key: string) => string | null, setItem?: (key: string, value: string) => void }} CardStorage
 * @typedef {{
 *   id?: string,
 *   label?: string,
 *   minWidth?: number,
 *   minHeight?: number,
 *   maxWidth?: number,
 *   maxHeight?: number,
 *   axes?: "both" | "width" | "height",
 *   win?: Window,
 *   measure?: () => CardSize,
 *   onApply?: (size: CardSize) => void,
 *   keepAttr?: boolean,
 * }} ResizeHandleOptions
 */

/** @type {Readonly<CardBounds>} */
export const DEFAULT_BOUNDS = Object.freeze({
  minWidth: 240,
  minHeight: 160,
  maxWidth: 2000,
  maxHeight: 1600,
});

/**
 * @param {Window | { localStorage?: CardStorage } | null | undefined} win
 * @returns {CardStorage | null}
 */
export function cardStorage(win) {
  try { return win?.localStorage ?? null; } catch { return null; }
}

/**
 * @param {CardStorage | null | undefined} storage
 * @returns {Record<string, CardSize>}
 */
export function readCardSizes(storage) {
  try {
    const raw = storage?.getItem?.(CARD_SIZES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    /** @type {Record<string, CardSize>} */
    const out = {};
    for (const [id, value] of Object.entries(parsed)) {
      const size = normalizeSize(value);
      if (id && size) out[id] = size;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {CardStorage | null | undefined} storage
 * @param {string} id
 * @returns {CardSize | null}
 */
export function readCardSize(storage, id) {
  return readCardSizes(storage)[id] ?? null;
}

/**
 * @param {CardStorage | null | undefined} storage
 * @param {string} id
 * @param {unknown} size
 */
export function writeCardSize(storage, id, size) {
  if (!id || typeof id !== "string") return;
  const next = normalizeSize(size);
  if (!next) return;
  try {
    const all = readCardSizes(storage);
    all[id] = next;
    storage?.setItem?.(CARD_SIZES_KEY, JSON.stringify(all));
  } catch { /* private mode or quota */ }
}

/**
 * @param {Partial<CardSize> | null | undefined} size
 * @param {Partial<CardBounds>} [bounds]
 * @param {{ width?: number, height?: number } | null} [viewport]
 * @returns {CardSize}
 */
export function clampCardSize(size, bounds = DEFAULT_BOUNDS, viewport) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  const minW = bounds.minWidth ?? DEFAULT_BOUNDS.minWidth;
  const minH = bounds.minHeight ?? DEFAULT_BOUNDS.minHeight;
  const capW = Math.min(bounds.maxWidth ?? DEFAULT_BOUNDS.maxWidth, Math.max(minW, (viewport?.width ?? 1e9) - 16));
  const capH = Math.min(bounds.maxHeight ?? DEFAULT_BOUNDS.maxHeight, Math.max(minH, (viewport?.height ?? 1e9) - 16));
  return {
    width: Math.round(Math.max(minW, Math.min(capW, width))),
    height: Math.round(Math.max(minH, Math.min(capH, height))),
  };
}

/**
 * @param {unknown} value
 * @returns {CardSize | null}
 */
function normalizeSize(value) {
  const width = Number(/** @type {{ width?: unknown }} */ (value)?.width);
  const height = Number(/** @type {{ height?: unknown }} */ (value)?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * @param {ResizeHandleOptions} options
 * @returns {CardBounds}
 */
function boundsOf(options) {
  return {
    minWidth: options.minWidth ?? DEFAULT_BOUNDS.minWidth,
    minHeight: options.minHeight ?? DEFAULT_BOUNDS.minHeight,
    maxWidth: options.maxWidth ?? DEFAULT_BOUNDS.maxWidth,
    maxHeight: options.maxHeight ?? DEFAULT_BOUNDS.maxHeight,
  };
}

/**
 * @param {Window | null | undefined} win
 */
function viewportOf(win) {
  return { width: win?.innerWidth || DEFAULT_BOUNDS.maxWidth, height: win?.innerHeight || DEFAULT_BOUNDS.maxHeight };
}

/**
 * @param {HTMLElement} el
 * @param {CardSize} size
 * @param {"both" | "width" | "height"} [axes]
 */
export function applyCardSize(el, size, axes = "both") {
  if (!el || !size) return;
  el.style.setProperty("--px-card-w", `${size.width}px`);
  el.style.setProperty("--px-card-h", `${size.height}px`);
  el.setAttribute("data-px-resized", axes);
}

/**
 * @param {HTMLElement | null | undefined} el
 * @param {ResizeHandleOptions} [options]
 * @returns {() => void}
 */
export function attachResizeHandle(el, options = {}) {
  if (!el || el.querySelector(":scope > .px-card-resize")) return () => {};
  const win = options.win || el.ownerDocument.defaultView;
  const doc = el.ownerDocument;
  ensureCardResizeStyles(doc);
  const id = options.id;
  const axes = options.axes === "width" || options.axes === "height" ? options.axes : "both";
  const bounds = boundsOf(options);
  const label = options.label || "调整卡片大小";
  el.classList.add("px-card-resizable");
  if (id) el.setAttribute("data-px-card", id);
  const stored = id ? readCardSize(cardStorage(win), id) : null;
  const measure = options.measure || (() => {
    const cssW = parseFloat(el.style.getPropertyValue("--px-card-w"));
    const cssH = parseFloat(el.style.getPropertyValue("--px-card-h"));
    const rect = el.getBoundingClientRect();
    // Prefer the last applied size when layout matches it or has not
    // caught up (JSDOM). If the laid-out box is clearly smaller, the
    // card is clamped (max-width: 100% on a phone) — step from the
    // visible size so ArrowLeft actually shrinks what the user sees.
    const width = cssW > 0 && (rect.width <= 0 || cssW <= rect.width + 1) ? cssW : (rect.width || cssW);
    const height = cssH > 0 && (rect.height <= 0 || cssH <= rect.height + 1) ? cssH : (rect.height || cssH);
    return { width, height };
  });
  /**
   * @param {Partial<CardSize>} size
   * @param {boolean} animate
   */
  const apply = (size, animate) => {
    const next = clampCardSize(size, bounds, viewportOf(win));
    if (options.onApply) options.onApply(next);
    else applyCardSize(el, next, axes);
    if (id) writeCardSize(cardStorage(win), id, next);
    if (animate && !win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      el.setAttribute("data-px-resize-anim", "");
      const stop = () => el.removeAttribute("data-px-resize-anim");
      el.addEventListener("transitionend", stop, { once: true });
      win?.setTimeout(stop, 280);
    }
    return next;
  };
  if (stored) apply(stored, false);

  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = "px-card-resize";
  handle.setAttribute("aria-label", label);
  handle.title = "拖动调整宽高；方向键每次调整 20 像素";
  handle.textContent = "↘";
  const drag = { active: false, x: 0, y: 0, width: 0, height: 0 };

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const rect = measure();
    drag.active = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.width = rect.width;
    drag.height = rect.height;
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag.active) return;
    apply({
      width: drag.width + (axes === "height" ? 0 : event.clientX - drag.x),
      height: drag.height + (axes === "width" ? 0 : event.clientY - drag.y),
    }, false);
  });
  const end = () => { drag.active = false; };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = measure();
    apply({
      width: rect.width + (event.key === "ArrowRight" ? KEY_STEP : event.key === "ArrowLeft" ? -KEY_STEP : 0),
      height: rect.height + (event.key === "ArrowDown" ? KEY_STEP : event.key === "ArrowUp" ? -KEY_STEP : 0),
    }, false);
  });
  el.append(handle);
  return () => {
    handle.remove();
    el.classList.remove("px-card-resizable");
    el.removeAttribute("data-px-resized");
    el.removeAttribute("data-px-resize-anim");
    if (!options.keepAttr) el.removeAttribute("data-px-card");
  };
}
