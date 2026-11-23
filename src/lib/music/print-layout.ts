/**
 * Page geometry for browser print. This module only measures boxes.
 * It does not read or write score notes, and it does not turn bar-fill
 * rests into stored notes. Those rests stay inside ABC engraving.
 */

export type PaperId = "a4" | "letter";

export type MeasuresPerSystem = "auto" | 2 | 3 | 4;

export type PrintSettings = {
  paper: PaperId;
  /** Page margin in millimetres. The same value is the CSS `@page` margin. */
  marginMm: number;
  /**
   * Music size. 1 engraves at the content width. Larger values engrave on a
   * narrower staff and scale that staff back up to the content width.
   */
  scale: number;
  measuresPerSystem: MeasuresPerSystem;
};

export const PRINT_CHROME = {
  titlePx: 48,
  captionPx: 44,
  rangePx: 36,
  runningPx: 32,
  footerPx: 32,
  gapPx: 10,
  slackMm: 2,
  padPx: 4,
  minStaffPx: 280,
  minMarginMm: 8,
  maxMarginMm: 25,
  minScale: 0.75,
  maxScale: 1.35,
} as const;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: "a4",
  marginMm: 12,
  scale: 1,
  measuresPerSystem: "auto",
};

const PAPER_MM: Record<PaperId, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
};

/** CSS pixels. Browsers map 1in to 96px, including in print. */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}

export type ContentBox = {
  paper: PaperId;
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  slackMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  contentWidthPx: number;
  contentHeightPx: number;
};

export function contentBox(settings: PrintSettings): ContentBox {
  const paper = PAPER_MM[settings.paper];
  const slackMm = PRINT_CHROME.slackMm;
  const contentWidthMm = paper.widthMm - settings.marginMm * 2 - slackMm;
  const contentHeightMm = paper.heightMm - settings.marginMm * 2 - slackMm;
  return {
    paper: settings.paper,
    pageWidthMm: paper.widthMm,
    pageHeightMm: paper.heightMm,
    marginMm: settings.marginMm,
    slackMm,
    contentWidthMm,
    contentHeightMm,
    contentWidthPx: mmToPx(contentWidthMm),
    contentHeightPx: mmToPx(contentHeightMm),
  };
}

export function firstHeaderPx(hasRangeLine: boolean): number {
  return (
    PRINT_CHROME.titlePx +
    PRINT_CHROME.captionPx +
    (hasRangeLine ? PRINT_CHROME.rangePx : 0) +
    PRINT_CHROME.gapPx
  );
}

export function laterHeaderPx(): number {
  return PRINT_CHROME.runningPx + PRINT_CHROME.gapPx;
}

/** Vertical room left for music after the header and the page-number footer. */
export function musicSlotPx(
  contentHeightPx: number,
  pageIndex: number,
  hasRangeLine: boolean,
): number {
  const header = pageIndex === 0 ? firstHeaderPx(hasRangeLine) : laterHeaderPx();
  return Math.max(1, contentHeightPx - header - PRINT_CHROME.footerPx);
}

export function printStaffWidthPx(contentWidthPx: number, scale: number): number {
  const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return Math.max(PRINT_CHROME.minStaffPx, Math.round(contentWidthPx / safeScale));
}

/** How the engraved staff is mapped onto the content width. */
export function widthScale(contentWidthPx: number, renderedWidthPx: number): number {
  if (!(contentWidthPx > 0) || !(renderedWidthPx > 0)) return 1;
  return contentWidthPx / renderedWidthPx;
}

export function measuresForPrint(settings: PrintSettings, staffWidthPx: number): 2 | 3 | 4 {
  if (settings.measuresPerSystem !== "auto") return settings.measuresPerSystem;
  if (staffWidthPx < 480) return 2;
  if (staffWidthPx < 640) return 3;
  return 4;
}

export function printWrap(measures: 2 | 3 | 4): {
  minSpacing: number;
  maxSpacing: number;
  preferredMeasuresPerLine: number;
} {
  return {
    minSpacing: 1.4,
    maxSpacing: 2.4,
    preferredMeasuresPerLine: measures,
  };
}

export function printRenderOptions(staffWidthPx: number, measures: 2 | 3 | 4) {
  return {
    add_classes: true as const,
    foregroundColor: "#1c1916",
    paddingbottom: 6,
    paddingleft: 0,
    paddingright: 0,
    paddingtop: 0,
    staffwidth: staffWidthPx,
    wrap: printWrap(measures),
  };
}

export function pageLabel(index: number, total: number): string {
  const page = Math.max(1, index + 1);
  const pages = Math.max(page, total);
  return `${page} / ${pages}`;
}

export function normalizePrintSettings(value: unknown): PrintSettings {
  const raw = value && typeof value === "object" ? (value as Partial<PrintSettings>) : {};
  const paper: PaperId = raw.paper === "letter" ? "letter" : "a4";
  const marginRaw =
    typeof raw.marginMm === "number" ? raw.marginMm : DEFAULT_PRINT_SETTINGS.marginMm;
  const marginMm = clamp(
    Number.isFinite(marginRaw) ? Math.round(marginRaw * 10) / 10 : DEFAULT_PRINT_SETTINGS.marginMm,
    PRINT_CHROME.minMarginMm,
    PRINT_CHROME.maxMarginMm,
  );
  const scaleRaw = typeof raw.scale === "number" ? raw.scale : DEFAULT_PRINT_SETTINGS.scale;
  const scale = clamp(
    Number.isFinite(scaleRaw) ? Math.round(scaleRaw * 100) / 100 : DEFAULT_PRINT_SETTINGS.scale,
    PRINT_CHROME.minScale,
    PRINT_CHROME.maxScale,
  );
  const measures: MeasuresPerSystem =
    raw.measuresPerSystem === 2 || raw.measuresPerSystem === 3 || raw.measuresPerSystem === 4
      ? raw.measuresPerSystem
      : "auto";
  return { paper, marginMm, scale, measuresPerSystem: measures };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type MeasuredSpan = {
  top: number;
  bottom: number;
};

export type PrintPagePlan = {
  /** Inclusive system indexes. `end < start` means the page has no systems. */
  start: number;
  end: number;
  viewTop: number;
  viewBottom: number;
  /** 1, or smaller when one system is taller than the music slot. */
  fit: number;
  displayHeightPx: number;
};

export type PlanOptions = {
  padPx: number;
  scale: number;
  musicHeightPx: (pageIndex: number) => number;
};

/**
 * Pack whole systems into pages. A system is never split. The window around
 * each page covers every system on that page, and stops at the midpoint of
 * the gap before the next system so the next staff is not pulled along.
 */
export function planPrintPages(
  systems: readonly MeasuredSpan[],
  options: PlanOptions,
): PrintPagePlan[] {
  const clean = systems.map((system) => {
    const top = Number.isFinite(system.top) ? system.top : 0;
    const bottom = Number.isFinite(system.bottom) && system.bottom > top ? system.bottom : top + 1;
    return { top, bottom };
  });
  if (clean.length === 0) {
    return [{ start: 0, end: -1, viewTop: 0, viewBottom: 0, fit: 1, displayHeightPx: 0 }];
  }
  const scale = options.scale > 0 && Number.isFinite(options.scale) ? options.scale : 1;
  const pad = options.padPx > 0 && Number.isFinite(options.padPx) ? options.padPx : 0;
  const pages: PrintPagePlan[] = [];
  let start = 0;
  while (start < clean.length) {
    const slot = Math.max(1, finite(options.musicHeightPx(pages.length), 1));
    let end = start;
    while (end + 1 < clean.length) {
      const next = windowFor(clean, start, end + 1, pad);
      if ((next.bottom - next.top) * scale <= slot) end += 1;
      else break;
    }
    const win = windowFor(clean, start, end, pad);
    const visual = (win.bottom - win.top) * scale;
    const fit = visual > slot ? slot / visual : 1;
    pages.push({
      start,
      end,
      viewTop: win.top,
      viewBottom: win.bottom,
      fit,
      displayHeightPx: Math.min(slot, visual * fit),
    });
    start = end + 1;
  }
  return pages;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function windowFor(
  systems: readonly MeasuredSpan[],
  start: number,
  end: number,
  pad: number,
): { top: number; bottom: number } {
  const first = systems[start];
  const last = systems[end];
  let top = first.top - pad;
  let bottom = last.bottom + pad;
  if (start > 0) {
    const previous = systems[start - 1];
    top = Math.max(top, (previous.bottom + first.top) / 2);
  }
  if (end + 1 < systems.length) {
    const next = systems[end + 1];
    bottom = Math.min(bottom, (last.bottom + next.top) / 2);
  }
  if (start === 0 && first.top >= 0) top = Math.max(0, top);
  top = Math.min(top, first.top);
  bottom = Math.max(bottom, last.bottom);
  if (!(bottom > top)) bottom = top + 1;
  return { top, bottom };
}
