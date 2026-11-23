import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { applyMark } from "./expression.ts";
import { assignLyrics } from "./lyrics.ts";
import { engraveAbc } from "./notation.ts";
import {
  drawPrintedScore,
  estimateSvgBox,
  installPrintPageCss,
  measureSystems,
  pathInkBox,
  type PrintAbcRender,
} from "./print-sheet.ts";
import { outOfRangePitches } from "./range.ts";
import type { RangePaint } from "./range-paint.ts";
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from "./print-layout.ts";
import type { Score, ScoreNote } from "./theory.ts";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  SVGElement: dom.window.SVGElement,
  SVGSVGElement: dom.window.SVGSVGElement,
  SVGGElement: dom.window.SVGGElement,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
});
const abcjs = require("abcjs") as { renderAbc: PrintAbcRender };

function asScore(notes: ScoreNote[], extra: Partial<Score> = {}): Score {
  return {
    title: "试印",
    bpm: 88,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
    ...extra,
  };
}

function quarters(count: number, lyric = false): ScoreNote[] {
  return Array.from({ length: count }, (_, index) => ({
    pitches: [60 + (index % 5)],
    dur: 1,
    lyric: lyric ? { text: "字", syllabic: "single" as const } : undefined,
  }));
}

function paintFor(score: Score, mark: boolean): RangePaint {
  return {
    hits: [
      ...outOfRangePitches(score.notes, "bb"),
      ...outOfRangePitches(score.voice2 ?? [], "bb", 1),
    ],
    mark,
    notes: score.notes,
    voices: [score.notes, score.voice2 ?? []],
    instrument: "bb",
    key: score.key,
    mode: score.mode,
  };
}

function draw(score: Score, settings: PrintSettings = DEFAULT_PRINT_SETTINGS, mark = false) {
  const shift = mark ? 2 : 0;
  const engraved = engraveAbc(score, shift);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const drawn = drawPrintedScore(host, abcjs.renderAbc, {
    abc: engraved.abc,
    hits: engraved.hits,
    range: paintFor(score, mark),
    title: score.title,
    caption: shift ? "记谱 D大调 · 1 = D · 4/4 · 88 · 实际 C大调" : "C大调 · 1 = C · 4/4 · 88",
    rangeLine: mark ? "有 1 个音超出降B单簧管的常用音域（记谱 E3–C6）。" : null,
    settings,
  });
  return { host, drawn, engraved };
}

describe("svg geometry", () => {
  it("reads path endpoints and relative curves", () => {
    const line = pathInkBox("M 10 20 L 30 40");
    assert.deepEqual(line, { minX: 10, minY: 20, maxX: 30, maxY: 40 });
    const curve = pathInkBox("M 0 0 c 10 20 30 40 50 60");
    assert.equal(curve?.minX, 0);
    assert.equal(curve?.minY, 0);
    assert.equal(curve?.maxX, 50);
    assert.equal(curve?.maxY, 60);
  });

  it("applies a scale around a point", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 12 20 L 14 22");
    path.setAttribute("transform", "translate(10 20) scale(2) translate(-10 -20)");
    svg.appendChild(path);
    const box = estimateSvgBox(svg);
    assert.ok(box);
    assert.ok(Math.abs((box?.minX ?? 0) - 14) < 0.01);
    assert.ok(Math.abs((box?.minY ?? 0) - 20) < 0.01);
    assert.ok(Math.abs((box?.maxX ?? 0) - 18) < 0.01);
    assert.ok(Math.abs((box?.maxY ?? 0) - 24) < 0.01);
  });

  it("prefers a real getBBox over the geometry walk", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "200");
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("abcjs-staff-wrapper");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L 10 10");
    group.appendChild(path);
    (group as SVGGraphicsElement).getBBox = () =>
      ({ x: 3, y: 4, width: 30, height: 40 }) as DOMRect;
    svg.appendChild(group);
    const measured = measureSystems(svg as unknown as SVGSVGElement);
    assert.equal(measured.systems.length, 1);
    assert.equal(measured.systems[0].top, 4);
    assert.equal(measured.systems[0].bottom, 44);
    assert.equal(measured.systems[0].left, 3);
    assert.equal(measured.systems[0].right, 33);
  });
});

describe("printed score", () => {
  it("prints a short single voice on one page without editor controls", () => {
    const score = asScore(quarters(4, true));
    const before = JSON.stringify(score);
    const { host, drawn } = draw(score);
    assert.equal(JSON.stringify(score), before);
    assert.equal(drawn.pages.length, 1);
    assert.equal(host.dataset.pages, "1");
    assert.equal(host.querySelectorAll(".print-page").length, 1);
    assert.equal(host.querySelector(".print-page")?.getAttribute("data-last"), "true");
    assert.equal(host.querySelector(".print-title")?.textContent, "试印");
    assert.match(host.querySelector(".print-caption")?.textContent ?? "", /1 = C/);
    assert.equal(host.querySelector(".print-footer")?.textContent, "1 / 1");
    assert.equal(host.querySelectorAll("button, input, textarea, select").length, 0);
    assert.equal(host.textContent?.includes("1 1 5 5"), false);
    const systems = [...host.querySelectorAll("[data-system-index]")];
    assert.ok(systems.length >= 1);
    assert.ok(systems.every((system) => system.querySelectorAll(".abcjs-staff").length === 1));
    assert.match(host.textContent ?? "", /字/);
    host.remove();
  });

  it("keeps both staves of a system on the same page when the rhythms differ", () => {
    const notes = quarters(16);
    const voice2 = Array.from({ length: 8 }, () => ({ pitches: [57], dur: 0.5 }));
    const score = asScore(notes, { voice2, title: "两行" });
    const before = JSON.stringify(score);
    const { host, drawn, engraved } = draw(score);
    assert.equal(JSON.stringify(score), before);
    assert.equal(score.voice2?.length, 8);
    assert.match(engraved.abc, /z/);
    assert.ok(drawn.systems.every((system) => system.staves === 2));
    const indexes = [...host.querySelectorAll("[data-system-index]")].map((node) =>
      node.getAttribute("data-system-index"),
    );
    assert.deepEqual(
      indexes,
      drawn.systems.map((system) => String(system.index)),
    );
    assert.equal(new Set(indexes).size, indexes.length);
    for (const system of host.querySelectorAll("[data-system-index]")) {
      assert.equal(system.querySelectorAll(".abcjs-staff").length, 2);
    }
    for (const system of drawn.systems) {
      const page = drawn.pages.find(
        (item) => system.index >= item.start && system.index <= item.end,
      );
      assert.ok(page);
      assert.ok(page.viewTop <= system.top);
      assert.ok(page.viewBottom >= system.bottom);
    }
    assert.equal(
      host.querySelector(".print-footer")?.textContent?.endsWith(`/ ${drawn.pages.length}`),
      true,
    );
    host.remove();
  });

  it("paginates a long lyric line without an empty trailing page", () => {
    const notes = applyMark(quarters(36 * 4, true), [0], { type: "dynamic", value: "p" });
    const score = asScore(notes, { title: "长歌" });
    const { host, drawn } = draw(score);
    assert.ok(drawn.pages.length >= 2, `expected multiple pages, got ${drawn.pages.length}`);
    assert.equal(host.querySelectorAll(".print-page").length, drawn.pages.length);
    const pages = [...host.querySelectorAll(".print-page")];
    assert.equal(pages.at(-1)?.getAttribute("data-last"), "true");
    assert.equal(
      pages.slice(0, -1).some((page) => page.getAttribute("data-last") === "true"),
      false,
    );
    for (const page of pages) {
      assert.ok(page.querySelector("[data-system-index]"));
      assert.ok(page.querySelector(".print-footer"));
    }
    const indexes = [...host.querySelectorAll("[data-system-index]")].map((node) =>
      Number(node.getAttribute("data-system-index")),
    );
    assert.deepEqual(
      indexes,
      drawn.systems.map((system) => system.index),
    );
    assert.match(host.textContent ?? "", /字/);
    assert.match(host.textContent ?? "", /p/);
    const noteCount = host.querySelectorAll(".abcjs-note").length;
    assert.equal(noteCount, 36 * 4);
    host.remove();
  });

  it("follows the range switch and keeps the written caption", () => {
    const score = asScore([{ pitches: [84], dur: 1 }], { title: "超音" });
    const marked = draw(score, DEFAULT_PRINT_SETTINGS, true);
    assert.ok(marked.host.querySelector(".is-out-of-range"));
    assert.match(marked.host.querySelector(".print-caption")?.textContent ?? "", /记谱/);
    assert.match(marked.host.textContent ?? "", /常用音域/);
    marked.host.remove();
    const plain = draw(score, DEFAULT_PRINT_SETTINGS, false);
    assert.equal(plain.host.querySelectorAll(".is-out-of-range").length, 0);
    assert.equal(plain.host.querySelector(".print-range"), null);
    plain.host.remove();
  });

  it("puts a long two-voice score on more than one page and still pairs the staves", () => {
    const upper = assignLyrics(quarters(24 * 4), "啦".repeat(24 * 4)).notes;
    const lower = Array.from({ length: 24 * 8 }, (_, index) => ({
      pitches: [55 + (index % 3)],
      dur: 0.5,
      lyric: { text: "啊", syllabic: "single" as const },
    }));
    const score = asScore(upper, { voice2: lower, title: "重唱" });
    const before = JSON.stringify(score);
    const { host, drawn } = draw(score, {
      ...DEFAULT_PRINT_SETTINGS,
      scale: 1.15,
      measuresPerSystem: 4,
    });
    assert.equal(JSON.stringify(score), before);
    assert.equal(score.voice2?.length, 24 * 8);
    assert.ok(drawn.pages.length >= 2);
    assert.ok(drawn.systems.length >= 2);
    assert.ok(drawn.systems.every((system) => system.staves === 2));
    const pages = [...host.querySelectorAll(".print-page")];
    assert.equal(pages.length, drawn.pages.length);
    assert.ok(pages.every((page) => page.querySelector("[data-system-index]")));
    assert.equal(host.querySelectorAll(".abcjs-note").length, upper.length + lower.length);
    host.remove();
  });
});

describe("print page css", () => {
  it("names A4 and Letter in the page rule", () => {
    installPrintPageCss(DEFAULT_PRINT_SETTINGS);
    const a4 = document.getElementById("puxian-print-page")?.textContent ?? "";
    assert.match(a4, /size:\s*210mm 297mm/);
    assert.match(a4, /margin:\s*12mm/);
    installPrintPageCss({ ...DEFAULT_PRINT_SETTINGS, paper: "letter", marginMm: 16 });
    const letter = document.getElementById("puxian-print-page")?.textContent ?? "";
    assert.match(letter, /size:\s*215\.9mm 279\.4mm/);
    assert.match(letter, /margin:\s*16mm/);
  });
});
