import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { engraveAbc } from "./notation.ts";
import {
  contentBox,
  DEFAULT_PRINT_SETTINGS,
  firstHeaderPx,
  laterHeaderPx,
  measuresForPrint,
  mmToPx,
  musicSlotPx,
  normalizePrintSettings,
  pageLabel,
  planPrintPages,
  printRenderOptions,
  printStaffWidthPx,
  PRINT_CHROME,
  widthScale,
  type MeasuredSpan,
} from "./print-layout.ts";

const pad = PRINT_CHROME.padPx;

describe("print page box", () => {
  it("uses A4 with a 12mm margin and a small safety slack", () => {
    const box = contentBox(DEFAULT_PRINT_SETTINGS);
    assert.equal(box.paper, "a4");
    assert.equal(box.pageWidthMm, 210);
    assert.equal(box.pageHeightMm, 297);
    assert.equal(box.marginMm, 12);
    assert.equal(box.slackMm, 2);
    assert.equal(box.contentWidthMm, 184);
    assert.equal(box.contentHeightMm, 271);
    assert.equal(box.contentWidthPx, mmToPx(184));
    assert.equal(box.contentHeightPx, mmToPx(271));
  });

  it("uses US Letter in millimetres", () => {
    const box = contentBox({ ...DEFAULT_PRINT_SETTINGS, paper: "letter", marginMm: 16 });
    assert.equal(box.pageWidthMm, 215.9);
    assert.equal(box.pageHeightMm, 279.4);
    assert.equal(box.marginMm, 16);
    assert.equal(box.contentWidthMm, 215.9 - 32 - 2);
    assert.equal(box.contentHeightMm, 279.4 - 32 - 2);
  });

  it("keeps the first page header taller when a range line is shown", () => {
    const height = contentBox(DEFAULT_PRINT_SETTINGS).contentHeightPx;
    const first = musicSlotPx(height, 0, false);
    const firstWithRange = musicSlotPx(height, 0, true);
    const later = musicSlotPx(height, 1, true);
    assert.ok(first > 400);
    assert.equal(first - firstWithRange, PRINT_CHROME.rangePx);
    assert.ok(later > first);
    assert.equal(
      firstHeaderPx(false),
      PRINT_CHROME.titlePx + PRINT_CHROME.captionPx + PRINT_CHROME.gapPx,
    );
    assert.equal(laterHeaderPx(), PRINT_CHROME.runningPx + PRINT_CHROME.gapPx);
    assert.equal(first, height - firstHeaderPx(false) - PRINT_CHROME.footerPx);
  });
});

describe("print staff width and system breaks", () => {
  it("engraves narrower when the scale is larger, then maps back to the content width", () => {
    const content = contentBox(DEFAULT_PRINT_SETTINGS).contentWidthPx;
    const normal = printStaffWidthPx(content, 1);
    const larger = printStaffWidthPx(content, 1.15);
    assert.ok(larger < normal);
    assert.ok(Math.abs(content / larger - 1.15) < 0.02);
    assert.equal(widthScale(content, larger), content / larger);
  });

  it("does not engrave below the editor's minimum staff width", () => {
    assert.equal(printStaffWidthPx(100, 1), PRINT_CHROME.minStaffPx);
    assert.ok(widthScale(100, PRINT_CHROME.minStaffPx) < 1);
  });

  it("picks measures per system from the staff width unless the setting is fixed", () => {
    const auto = { ...DEFAULT_PRINT_SETTINGS, measuresPerSystem: "auto" as const };
    assert.equal(measuresForPrint(auto, 479), 2);
    assert.equal(measuresForPrint(auto, 480), 3);
    assert.equal(measuresForPrint(auto, 639), 3);
    assert.equal(measuresForPrint(auto, 640), 4);
    assert.equal(measuresForPrint({ ...auto, measuresPerSystem: 2 }, 900), 2);
    const options = printRenderOptions(640, 3);
    assert.equal(options.staffwidth, 640);
    assert.equal(options.wrap.preferredMeasuresPerLine, 3);
    assert.equal(options.paddingtop, 0);
    assert.equal("responsive" in options, false);
    assert.equal("scale" in options, false);
  });
});

describe("normalize print settings", () => {
  it("falls back to A4, 12mm, scale 1, and automatic breaks", () => {
    assert.deepEqual(normalizePrintSettings(null), DEFAULT_PRINT_SETTINGS);
    assert.deepEqual(
      normalizePrintSettings({ paper: "tabloid", marginMm: 0, scale: 9, measuresPerSystem: 5 }),
      {
        paper: "a4",
        marginMm: PRINT_CHROME.minMarginMm,
        scale: PRINT_CHROME.maxScale,
        measuresPerSystem: "auto",
      },
    );
    assert.equal(
      normalizePrintSettings({ marginMm: 40, scale: 0.1 }).marginMm,
      PRINT_CHROME.maxMarginMm,
    );
    assert.equal(normalizePrintSettings({ scale: 0.1 }).scale, PRINT_CHROME.minScale);
    assert.equal(
      normalizePrintSettings({ paper: "letter", measuresPerSystem: 3 }).measuresPerSystem,
      3,
    );
    assert.equal(normalizePrintSettings({ marginMm: Number.NaN, scale: Number.NaN }).marginMm, 12);
  });
});

describe("paginate systems", () => {
  const slot = (page: number) => (page === 0 ? 300 : 300);

  it("keeps several short systems on one page and covers their ink", () => {
    const systems: MeasuredSpan[] = [
      { top: 10, bottom: 100 },
      { top: 140, bottom: 230 },
    ];
    const pages = planPrintPages(systems, { padPx: pad, scale: 1, musicHeightPx: slot });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].start, 0);
    assert.equal(pages[0].end, 1);
    assert.equal(pages[0].fit, 1);
    assert.equal(pages[0].viewTop, 6);
    assert.equal(pages[0].viewBottom, 234);
    assert.ok(pages[0].viewTop <= 10 && pages[0].viewBottom >= 230);
    assert.ok(pages[0].displayHeightPx <= 300);
  });

  it("starts a new page instead of splitting a system", () => {
    const systems: MeasuredSpan[] = [
      { top: 10, bottom: 100 },
      { top: 140, bottom: 230 },
      { top: 270, bottom: 360 },
    ];
    const pages = planPrintPages(systems, {
      padPx: pad,
      scale: 1,
      musicHeightPx: () => 150,
    });
    assert.equal(pages.length, 3);
    assert.deepEqual(
      pages.map((page) => [page.start, page.end]),
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    );
    assert.equal(pages[0].viewTop, 6);
    assert.equal(pages[0].viewBottom, 104);
    assert.ok(pages[0].viewBottom <= systems[1].top);
    assert.equal(pages[1].viewTop, 136);
    assert.ok(pages[1].viewTop >= systems[0].bottom);
    assert.ok(pages[1].viewTop <= systems[1].top);
    assert.ok(pages[1].viewBottom >= systems[1].bottom);
    assert.ok(pages[1].viewBottom <= systems[2].top);
    const indexes = pages.flatMap((page) => range(page.start, page.end));
    assert.deepEqual(indexes, [0, 1, 2]);
  });

  it("scales one system that is taller than the page and does not add an empty page", () => {
    const pages = planPrintPages([{ top: 0, bottom: 400 }], {
      padPx: 0,
      scale: 1,
      musicHeightPx: () => 200,
    });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].start, 0);
    assert.equal(pages[0].end, 0);
    assert.equal(pages[0].fit, 0.5);
    assert.equal(pages[0].displayHeightPx, 200);
    assert.equal(pages[0].viewTop, 0);
    assert.equal(pages[0].viewBottom, 400);
  });

  it("uses the full slot when the music fits exactly, and wraps one pixel later", () => {
    const systems: MeasuredSpan[] = [
      { top: 0, bottom: 40 },
      { top: 50, bottom: 90 },
    ];
    const together = planPrintPages(systems, { padPx: 0, scale: 1, musicHeightPx: () => 90 });
    const split = planPrintPages(systems, { padPx: 0, scale: 1, musicHeightPx: () => 89 });
    assert.equal(together.length, 1);
    assert.equal(together[0].fit, 1);
    assert.deepEqual(
      split.map((page) => [page.start, page.end]),
      [
        [0, 0],
        [1, 1],
      ],
    );
  });

  it("gives the first page less room, and leaves a short voice's system whole", () => {
    const paired = { top: 0, bottom: 90 };
    const pages = planPrintPages([paired, { top: 120, bottom: 210 }, { top: 240, bottom: 330 }], {
      padPx: 0,
      scale: 1,
      musicHeightPx: (page) => (page === 0 ? 80 : 200),
    });
    assert.equal(pages[0].start, 0);
    assert.equal(pages[0].end, 0);
    assert.ok(pages[0].fit < 1);
    assert.equal(pages[0].viewTop, 0);
    assert.equal(pages[0].viewBottom, 90);
    assert.equal(pages[1].fit, 1);
    assert.equal(pages[1].start, 1);
    assert.ok(pages[1].end >= 1);
    assert.equal(pages.at(-1)?.end, 2);
    assert.ok((pages.at(-1)?.end ?? -1) >= (pages.at(-1)?.start ?? 0));
  });

  it("returns one page and no trailing blank when there is no music", () => {
    const pages = planPrintPages([], { padPx: pad, scale: 1, musicHeightPx: () => 400 });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].end, -1);
    assert.equal(pages[0].displayHeightPx, 0);
  });

  it("does not invent a trailing page after the last system", () => {
    const systems = Array.from({ length: 5 }, (_, index) => ({
      top: index * 100,
      bottom: index * 100 + 40,
    }));
    const pages = planPrintPages(systems, { padPx: 0, scale: 1, musicHeightPx: () => 140 });
    assert.ok(pages.length >= 2);
    assert.equal(pages.at(-1)?.end, systems.length - 1);
    assert.ok((pages.at(-1)?.displayHeightPx ?? 0) > 0);
    assert.equal(
      pages.reduce((count, page) => count + (page.end - page.start + 1), 0),
      systems.length,
    );
  });
});

describe("print layout does not store padding", () => {
  it("leaves a short second voice untouched while engraving still pads with rests", () => {
    const score = {
      ...scoreFromExample(EXAMPLES[0]),
      voice2: [{ pitches: [60], dur: 1 }],
    };
    const before = JSON.stringify(score);
    const abc = engraveAbc(score).abc;
    const settings = normalizePrintSettings({
      paper: "letter",
      marginMm: 20,
      scale: 1.3,
      measuresPerSystem: 2,
    });
    const box = contentBox(settings);
    const width = printStaffWidthPx(box.contentWidthPx, settings.scale);
    const measures = measuresForPrint(settings, width);
    printRenderOptions(width, measures);
    planPrintPages(
      [
        { top: 0, bottom: 80 },
        { top: 100, bottom: 180 },
      ],
      { padPx: pad, scale: widthScale(box.contentWidthPx, width), musicHeightPx: () => 200 },
    );
    assert.equal(measures, 2);
    assert.equal(JSON.stringify(score), before);
    assert.equal(score.voice2?.length, 1);
    assert.equal(engraveAbc(score).abc, abc);
    assert.match(abc, /z/);
  });
});

describe("page labels", () => {
  it("numbers the only page and a later page", () => {
    assert.equal(pageLabel(0, 1), "1 / 1");
    assert.equal(pageLabel(0, 3), "1 / 3");
    assert.equal(pageLabel(2, 3), "3 / 3");
  });
});

function range(start: number, end: number): number[] {
  const indexes: number[] = [];
  for (let index = start; index <= end; index += 1) indexes.push(index);
  return indexes;
}
