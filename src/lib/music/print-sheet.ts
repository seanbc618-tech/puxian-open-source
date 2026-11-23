import type { StaffHit } from "./notation.ts";
import {
  contentBox,
  firstHeaderPx,
  laterHeaderPx,
  measuresForPrint,
  musicSlotPx,
  normalizePrintSettings,
  pageLabel,
  planPrintPages,
  printRenderOptions,
  printStaffWidthPx,
  widthScale,
  PRINT_CHROME,
  type PrintPagePlan,
  type PrintSettings,
} from "./print-layout.ts";
import { paintNotes, type EngravedTune, type RangePaint } from "./range-paint.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "puxian-print-page";

export type PrintAbcRender = (
  element: HTMLElement,
  abc: string,
  params: ReturnType<typeof printRenderOptions>,
) => EngravedTune[];

export type PrintSheetInput = {
  abc: string;
  hits: readonly StaffHit[];
  range: RangePaint;
  title: string;
  caption: string;
  /** Shown under the caption when range colours are on. */
  rangeLine: string | null;
  settings: PrintSettings;
  /** Extra marks drawn on the engraved SVG before it is split into pages (e.g. rit. dashes). */
  decorate?: (svg: SVGSVGElement, tunes: unknown[]) => void;
};

export type MeasuredSystem = {
  index: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  staves: number;
  node: Element;
};

export type PrintDrawResult = {
  pages: PrintPagePlan[];
  systems: Array<Pick<MeasuredSystem, "index" | "top" | "bottom" | "staves">>;
};

type InkBox = { minX: number; minY: number; maxX: number; maxY: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a b c d e f — maps (x, y) to (a x + c y + e, b x + d y + f). */
type Matrix = [number, number, number, number, number, number];

/**
 * Build the print-only sheet. Screen SVG, stored notes, and export files are
 * left alone. Padding rests used to align two voices are not written back.
 */
export function drawPrintedScore(
  host: HTMLElement,
  renderAbc: PrintAbcRender,
  input: PrintSheetInput,
): PrintDrawResult {
  const settings = normalizePrintSettings(input.settings);
  const box = contentBox(settings);
  installPrintPageCss(settings);
  const staffWidth = printStaffWidthPx(box.contentWidthPx, settings.scale);
  const measures = measuresForPrint(settings, staffWidth);
  const scratch = document.createElement("div");
  scratch.className = "print-scratch no-print";
  scratch.setAttribute("aria-hidden", "true");
  document.body.appendChild(scratch);
  try {
    const tunes = renderAbc(scratch, input.abc, printRenderOptions(staffWidth, measures));
    paintNotes(tunes, [...input.hits], [], null, input.range, 0);
    const svg = scratch.querySelector("svg");
    if (svg instanceof SVGSVGElement) input.decorate?.(svg, tunes as unknown[]);
    const measured = svg instanceof SVGSVGElement ? measureSystems(svg) : emptyMeasure();
    const scale = widthScale(box.contentWidthPx, measured.width);
    const hasRange = Boolean(input.rangeLine);
    const pages = planPrintPages(measured.systems, {
      padPx: PRINT_CHROME.padPx,
      scale,
      musicHeightPx: (pageIndex) => musicSlotPx(box.contentHeightPx, pageIndex, hasRange),
    });
    host.replaceChildren();
    pages.forEach((plan, index) => {
      host.appendChild(
        buildPage({
          plan,
          index,
          total: pages.length,
          boxWidth: box.contentWidthPx,
          boxHeight: box.contentHeightPx,
          svgWidth: measured.width,
          systems: measured.systems,
          source: svg instanceof SVGSVGElement ? svg : null,
          title: input.title.trim() || "未命名",
          caption: input.caption,
          rangeLine: input.rangeLine,
          hasRange,
        }),
      );
    });
    host.dataset.pages = String(pages.length);
    host.dataset.paper = settings.paper;
    host.dataset.measures = String(measures);
    return {
      pages,
      systems: measured.systems.map((system) => ({
        index: system.index,
        top: system.top,
        bottom: system.bottom,
        staves: system.staves,
      })),
    };
  } finally {
    scratch.remove();
  }
}

export function installPrintPageCss(settings: PrintSettings): void {
  const box = contentBox(normalizePrintSettings(settings));
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${box.pageWidthMm}mm ${box.pageHeightMm}mm; margin: ${box.marginMm}mm; }`;
}

export function measureSystems(svg: SVGSVGElement): {
  width: number;
  systems: MeasuredSystem[];
} {
  const width = svgWidth(svg);
  const systems: MeasuredSystem[] = [];
  let index = 0;
  for (const child of svg.children) {
    if (child.tagName.toLowerCase() !== "g" || !child.classList.contains("abcjs-staff-wrapper")) {
      continue;
    }
    const box = readBox(child);
    if (!box) continue;
    systems.push({
      index,
      top: box.minY,
      bottom: box.maxY,
      left: box.minX,
      right: box.maxX,
      staves: child.querySelectorAll(".abcjs-staff").length,
      node: child,
    });
    index += 1;
  }
  return { width, systems };
}

function emptyMeasure(): { width: number; systems: MeasuredSystem[] } {
  return { width: 0, systems: [] };
}

function svgWidth(svg: SVGSVGElement): number {
  const attr = Number(svg.getAttribute("width"));
  if (attr > 0) return attr;
  const view = svg.viewBox?.baseVal?.width;
  return view > 0 ? view : 0;
}

function readBox(el: Element): InkBox | null {
  const fn = (el as SVGGraphicsElement).getBBox;
  if (typeof fn === "function") {
    try {
      const box = fn.call(el as SVGGraphicsElement);
      if (
        box &&
        Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        Number.isFinite(box.width) &&
        Number.isFinite(box.height) &&
        box.width > 0 &&
        box.height > 0
      ) {
        return {
          minX: box.x,
          minY: box.y,
          maxX: box.x + box.width,
          maxY: box.y + box.height,
        };
      }
    } catch {
      /* Fall through to the geometry walk. */
    }
  }
  return estimateSvgBox(el);
}

export function estimateSvgBox(el: Element): InkBox | null {
  const acc: InkBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  walkInk(el, IDENTITY, acc, 20);
  if (!Number.isFinite(acc.minX) || !Number.isFinite(acc.minY)) return null;
  return acc;
}

function walkInk(el: Element, matrix: Matrix, acc: InkBox, fontSize: number): void {
  const next = multiply(matrix, parseTransform(el.getAttribute("transform")));
  const size = numeric(el.getAttribute("font-size")) || fontSize;
  const tag = el.tagName.toLowerCase();
  if (tag === "path") {
    const ink = pathInkBox(el.getAttribute("d") ?? "");
    if (ink) includeBox(acc, next, ink);
  } else if (tag === "line") {
    includePoint(acc, next, numeric(el.getAttribute("x1")), numeric(el.getAttribute("y1")));
    includePoint(acc, next, numeric(el.getAttribute("x2")), numeric(el.getAttribute("y2")));
  } else if (tag === "rect") {
    const x = numeric(el.getAttribute("x"));
    const y = numeric(el.getAttribute("y"));
    const w = numeric(el.getAttribute("width"));
    const h = numeric(el.getAttribute("height"));
    includeBox(acc, next, { minX: x, minY: y, maxX: x + w, maxY: y + h });
  } else if (tag === "circle" || tag === "ellipse") {
    const cx = numeric(el.getAttribute("cx"));
    const cy = numeric(el.getAttribute("cy"));
    const rx = tag === "circle" ? numeric(el.getAttribute("r")) : numeric(el.getAttribute("rx"));
    const ry = tag === "circle" ? rx : numeric(el.getAttribute("ry"));
    includeBox(acc, next, { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry });
  } else if (
    (tag === "text" || tag === "tspan") &&
    (el.hasAttribute("x") || el.hasAttribute("y") || el.hasAttribute("dx") || el.hasAttribute("dy"))
  ) {
    includeText(el, next, acc, size);
  }
  for (const child of el.children) walkInk(child, next, acc, size || fontSize);
}

function includeText(el: Element, matrix: Matrix, acc: InkBox, size: number): void {
  const parentX = numeric(el.parentElement?.getAttribute("x"));
  const parentY = numeric(el.parentElement?.getAttribute("y"));
  const anchor = textAnchor(el, size, parentX, parentY);
  const ascent = size * 0.92;
  const descent = size * 0.35;
  const width = Math.max(size * 0.6, (el.textContent ?? "").trim().length * size);
  includeBox(acc, matrix, {
    minX: anchor.x - width / 2,
    minY: anchor.y - ascent,
    maxX: anchor.x + width / 2,
    maxY: anchor.y + descent,
  });
}

function textAnchor(
  el: Element,
  size: number,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } {
  const hasX = el.hasAttribute("x");
  const hasY = el.hasAttribute("y");
  let x = hasX ? numeric(el.getAttribute("x")) : fallbackX;
  let y = hasY ? numeric(el.getAttribute("y")) : fallbackY;
  const dx = el.getAttribute("dx");
  const dy = el.getAttribute("dy");
  if (dx) x += unit(dx, size);
  if (dy) y += unit(dy, size);
  return { x, y };
}

function unit(value: string, size: number): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("em")) return (Number(trimmed.slice(0, -2)) || 0) * size;
  return Number(trimmed) || 0;
}

function includePoint(acc: InkBox, matrix: Matrix, x: number, y: number): void {
  const point = apply(matrix, x, y);
  acc.minX = Math.min(acc.minX, point.x);
  acc.minY = Math.min(acc.minY, point.y);
  acc.maxX = Math.max(acc.maxX, point.x);
  acc.maxY = Math.max(acc.maxY, point.y);
}

function includeBox(acc: InkBox, matrix: Matrix, box: InkBox): void {
  includePoint(acc, matrix, box.minX, box.minY);
  includePoint(acc, matrix, box.minX, box.maxY);
  includePoint(acc, matrix, box.maxX, box.minY);
  includePoint(acc, matrix, box.maxX, box.maxY);
}

export function pathInkBox(d: string): InkBox | null {
  const tokens = d.match(/[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/gi);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const acc: InkBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let any = false;
  const point = (x: number, y: number) => {
    any = true;
    acc.minX = Math.min(acc.minX, x);
    acc.minY = Math.min(acc.minY, y);
    acc.maxX = Math.max(acc.maxX, x);
    acc.maxY = Math.max(acc.maxY, y);
  };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i] ?? "")) cmd = tokens[i++] ?? cmd;
    if (!cmd) break;
    if (i >= tokens.length || /^[a-zA-Z]$/.test(tokens[i] ?? "")) {
      if (cmd.toUpperCase() === "Z") {
        cx = sx;
        cy = sy;
        continue;
      }
      break;
    }
    while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i] ?? "")) {
      const rel = cmd === cmd.toLowerCase();
      const op = cmd.toUpperCase();
      if (op === "H") {
        const x = num();
        cx = rel ? cx + x : x;
        point(cx, cy);
      } else if (op === "V") {
        const y = num();
        cy = rel ? cy + y : y;
        point(cx, cy);
      } else if (op === "M" || op === "L" || op === "T") {
        const x = num();
        const y = num();
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        point(cx, cy);
        if (op === "M") {
          sx = cx;
          sy = cy;
          cmd = rel ? "l" : "L";
        }
      } else if (op === "S" || op === "Q") {
        const x1 = num();
        const y1 = num();
        const x = num();
        const y = num();
        point(rel ? cx + x1 : x1, rel ? cy + y1 : y1);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        point(cx, cy);
      } else if (op === "C") {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        point(rel ? cx + x1 : x1, rel ? cy + y1 : y1);
        point(rel ? cx + x2 : x2, rel ? cy + y2 : y2);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        point(cx, cy);
      } else if (op === "A") {
        num();
        num();
        num();
        num();
        num();
        const x = num();
        const y = num();
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        point(cx, cy);
      } else {
        return any ? acc : null;
      }
    }
  }
  return any ? acc : null;
}

function parseTransform(value: string | null): Matrix {
  if (!value) return IDENTITY;
  let matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const kind = match[1];
    const nums = (match[2].match(/[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    let next = IDENTITY;
    if (kind === "matrix" && nums.length >= 6) {
      next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    } else if (kind === "translate") {
      next = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0];
    } else if (kind === "scale") {
      next = [nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0];
    } else if (kind === "rotate") {
      const angle = ((nums[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
      if (nums.length >= 3) {
        const to: Matrix = [1, 0, 0, 1, nums[1], nums[2]];
        const back: Matrix = [1, 0, 0, 1, -nums[1], -nums[2]];
        next = multiply(multiply(to, rot), back);
      } else {
        next = rot;
      }
    }
    matrix = multiply(matrix, next);
  }
  return matrix;
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function numeric(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildPage(input: {
  plan: PrintPagePlan;
  index: number;
  total: number;
  boxWidth: number;
  boxHeight: number;
  svgWidth: number;
  systems: readonly MeasuredSystem[];
  source: SVGSVGElement | null;
  title: string;
  caption: string;
  rangeLine: string | null;
  hasRange: boolean;
}): HTMLElement {
  const page = document.createElement("section");
  page.className = "print-page";
  page.dataset.page = String(input.index + 1);
  if (input.index === input.total - 1) page.dataset.last = "true";
  page.dataset.fit = String(input.plan.fit);
  page.style.width = `${input.boxWidth}px`;
  page.style.height = `${input.boxHeight}px`;
  page.style.display = "flex";
  page.style.flexDirection = "column";
  page.style.boxSizing = "border-box";
  page.style.overflow = "hidden";
  page.style.breakAfter = input.index === input.total - 1 ? "auto" : "page";
  page.style.pageBreakAfter = input.index === input.total - 1 ? "auto" : "always";

  const header = document.createElement(input.index === 0 ? "header" : "div");
  header.className = input.index === 0 ? "print-header" : "print-running";
  const headerPx = input.index === 0 ? firstHeaderPx(input.hasRange) : laterHeaderPx();
  header.style.height = `${headerPx}px`;
  header.style.flex = "none";
  header.style.overflow = "hidden";
  if (input.index === 0) {
    const title = document.createElement("h1");
    title.className = "print-title";
    title.textContent = input.title;
    const caption = document.createElement("p");
    caption.className = "print-caption";
    caption.textContent = input.caption;
    header.append(title, caption);
    if (input.rangeLine) {
      const range = document.createElement("p");
      range.className = "print-range";
      range.textContent = input.rangeLine;
      header.append(range);
    }
  } else {
    header.textContent = input.title;
  }
  page.append(header);

  const source = input.source;
  if (input.plan.end >= input.plan.start && source && input.svgWidth > 0) {
    const music = document.createElement("div");
    music.className = "print-music";
    music.style.flex = "none";
    music.style.display = "flex";
    music.style.justifyContent = "center";
    const svg = pageSvg({ ...input, source });
    music.append(svg);
    page.append(music);
  }

  const spacer = document.createElement("div");
  spacer.style.flex = "1 1 auto";
  const footer = document.createElement("footer");
  footer.className = "print-footer";
  footer.style.height = `${PRINT_CHROME.footerPx}px`;
  footer.style.flex = "none";
  footer.textContent = pageLabel(input.index, input.total);
  page.append(spacer, footer);
  return page;
}

function pageSvg(input: {
  plan: PrintPagePlan;
  systems: readonly MeasuredSystem[];
  source: SVGSVGElement;
  svgWidth: number;
  boxWidth: number;
}): SVGSVGElement {
  const horiz = horizontalWindow(input.systems, input.plan.start, input.plan.end, input.svgWidth);
  const viewH = Math.max(1, input.plan.viewBottom - input.plan.viewTop);
  const aspect = horiz.width / viewH;
  let displayH = input.plan.displayHeightPx;
  let displayW = displayH * aspect;
  const maxW = input.boxWidth * input.plan.fit;
  if (displayW > maxW && aspect > 0) {
    displayW = maxW;
    displayH = displayW / aspect;
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${horiz.x} ${input.plan.viewTop} ${horiz.width} ${viewH}`);
  svg.setAttribute("width", String(displayW));
  svg.setAttribute("height", String(displayH));
  svg.style.display = "block";
  svg.style.width = `${displayW}px`;
  svg.style.height = `${displayH}px`;
  for (const child of input.source.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === "style" || tag === "defs") svg.appendChild(child.cloneNode(true));
  }
  for (let index = input.plan.start; index <= input.plan.end; index += 1) {
    const system = input.systems[index];
    if (!system) continue;
    const clone = system.node.cloneNode(true);
    if (clone instanceof Element) clone.setAttribute("data-system-index", String(system.index));
    svg.appendChild(clone);
  }
  return svg;
}

function horizontalWindow(
  systems: readonly MeasuredSystem[],
  start: number,
  end: number,
  svgWidth: number,
): { x: number; width: number } {
  let left = 0;
  let right = svgWidth;
  for (let index = start; index <= end; index += 1) {
    const system = systems[index];
    if (!system) continue;
    left = Math.min(left, system.left);
    right = Math.max(right, system.right);
  }
  const x = Math.min(0, left - PRINT_CHROME.padPx);
  const far = Math.max(svgWidth, right + PRINT_CHROME.padPx);
  return { x, width: Math.max(1, far - x) };
}
