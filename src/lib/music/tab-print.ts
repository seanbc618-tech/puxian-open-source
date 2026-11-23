import {
  guitarTabOf,
  type TabModel,
  type TabPosition,
  type TabPositionId,
  type TabTuning,
  type TabTuningId,
} from "./guitar-tab.ts";
import {
  contentBox,
  firstHeaderPx,
  musicSlotPx,
  normalizePrintSettings,
  pageLabel,
  planPrintPages,
  type PrintSettings,
} from "./print-layout.ts";
import { installPrintPageCss } from "./print-sheet.ts";
import { type Score } from "./theory.ts";

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!,
  );

const text = (x: number, y: number, s: string, size = 18, attrs = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" ${attrs}>${esc(s)}</text>`;

type System = { top: number; bottom: number; markup: string };

function systemMarkup(model: TabModel, start: number, end: number, width: number): { markup: string; height: number } {
  const strings = model.tuning.strings;
  const labelW = 28;
  const shownChords = model.chordMarks.filter((mark) => mark.at >= start - 1e-9 && mark.at < end - 1e-9);
  const padTop = shownChords.length ? 26 : 10;
  const gap = 16;
  const plotW = width - labelW - 8;
  const span = Math.max(1e-9, end - start);
  const xOf = (at: number) => labelW + ((at - start) / span) * plotW;
  const yOf = (stringNumber: number) => padTop + (stringNumber - 1) * gap;
  const height = padTop + (strings.length - 1) * gap + 16;
  let markup = "";
  for (const mark of shownChords) {
    markup += `<text x="${xOf(mark.at)}" y="16" font-size="14" font-weight="600" text-anchor="middle" fill="#a44825">${esc(mark.symbol)}</text>`;
  }
  for (const str of strings) {
    const y = yOf(str.string);
    markup += `<text x="4" y="${y + 4}" font-size="11" text-anchor="start">${esc(str.name)}</text>`;
    markup += `<line x1="${labelW}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="currentColor" stroke-width="1"/>`;
  }
  for (const bar of model.bars) {
    if (bar < start - 1e-9 || bar > end + 1e-9) continue;
    const x = xOf(bar);
    markup += `<line x1="${x}" y1="${yOf(1)}" x2="${x}" y2="${yOf(strings.length)}" stroke="currentColor" stroke-width="${bar === start ? 1.6 : 1}"/>`;
  }
  for (const place of model.places) {
    if (place.start < start - 1e-9 || place.start >= end - 1e-9) continue;
    const x = xOf(place.start) + 8;
    const y = yOf(place.string) + 4;
    markup += `<rect x="${x - 6}" y="${y - 11}" width="${place.fret >= 10 ? 16 : 12}" height="12" fill="#f7f3ea"/>`;
    markup += `<text x="${x}" y="${y}" font-size="12" font-weight="600" text-anchor="middle">${place.fret}</text>`;
  }
  return { markup, height };
}

export function tabPrint(
  score: Score,
  settings: PrintSettings,
  tuning: TabTuningId | TabTuning = "guitar-standard",
  caption = "",
  position: TabPositionId | TabPosition = "auto",
) {
  const s = normalizePrintSettings(settings);
  const box = contentBox(s);
  const w = box.contentWidthPx;
  const h = box.contentHeightPx;
  const model = guitarTabOf(score, tuning, position);
  const systems: System[] = [];
  let top = 0;
  // Pack two to four bars per system, similar to the jianpu printer.
  const bars = model.bars.length ? model.bars : [0, Math.max(model.quarters, 4)];
  let i = 0;
  while (i < bars.length - 1) {
    const first = i;
    let count = Math.min(4, bars.length - 1 - first);
    const density = (n: number) => n * 90;
    while (count > 1 && density(count) > w - 40) count -= 1;
    const start = bars[first]!;
    const end = bars[first + count]!;
    const drawn = systemMarkup(model, start, end, w);
    systems.push({
      top,
      bottom: top + drawn.height,
      markup: drawn.markup,
    });
    top += drawn.height + 24;
    i += count;
  }
  if (!systems.length) {
    const drawn = systemMarkup(model, 0, Math.max(model.quarters, 4), w);
    systems.push({ top: 0, bottom: drawn.height, markup: drawn.markup });
  }
  const plans = planPrintPages(systems, {
    padPx: 4,
    scale: 1,
    musicHeightPx: () => musicSlotPx(h, 0, false),
  });
  const keyLine = model.position.id === "auto"
    ? `${model.tuning.label}　只支持标准调弦`
    : `${model.tuning.label}　${model.position.label}`;
  const pages = plans.map((p, index) => {
    let body =
      text(w / 2, 28, score.title || "未命名", 22) +
      text(w / 2, 53, keyLine, 15);
    if (caption)
      body += text(
        w / 2,
        75,
        caption,
        12,
        caption.length * 12 > w - 20
          ? `textLength="${w - 20}" lengthAdjust="spacingAndGlyphs"`
          : "",
      );
    const header = firstHeaderPx(false);
    for (let j = p.start; j <= p.end; j += 1) {
      body += `<g data-system="${j}" transform="translate(0,${header + (systems[j]!.top - p.viewTop) * p.fit}) scale(${p.fit})">${systems[j]!.markup}</g>`;
    }
    body += text(w / 2, h - 10, pageLabel(index, plans.length), 12);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" color="#1c1916" fill="#1c1916" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="#f7f3ea"/>${body}</svg>`;
  });
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h * pages.length}" viewBox="0 0 ${w} ${h * pages.length}">${pages.map((page, index) => `<g transform="translate(0,${h * index})">${page}</g>`).join("")}</svg>`;
  return { pages, markup, systems, plans, width: w, height: h, model };
}

export function drawTabPrint(
  host: HTMLElement,
  score: Score,
  settings: PrintSettings,
  tuning: TabTuningId | TabTuning = "guitar-standard",
  caption = "",
  position: TabPositionId | TabPosition = "auto",
) {
  installPrintPageCss(settings);
  const result = tabPrint(score, settings, tuning, caption, position);
  host.innerHTML = result.pages
    .map(
      (page) =>
        `<section class="print-page" style="width:${result.width}px;height:${result.height}px">${page}</section>`,
    )
    .join("");
  host.dataset.pages = String(result.pages.length);
  return result;
}
