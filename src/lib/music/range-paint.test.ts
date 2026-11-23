import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";
import { engraveAbc, staffTargetAt } from "./notation.ts";
import { paintNotes, type EngravedNote, type EngravedTune } from "./range-paint.ts";
import { outOfRangePitches } from "./range.ts";
import { instrumentOf, type InstrumentId, type Score, type ScoreNote } from "./theory.ts";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => {
    window: Window & typeof globalThis;
  };
};
const dom = new JSDOM("<!doctype html><html><body><div id='paper'></div></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  SVGElement: dom.window.SVGElement,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
});

const abcjs = require("abcjs") as {
  renderAbc: (element: Element, abc: string, options: { add_classes: boolean }) => EngravedTune[];
};

function asScore(notes: ScoreNote[]): Score {
  return {
    title: "试",
    bpm: 88,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
  };
}

function namesOf(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((node) => node.getAttribute("data-name") ?? "");
}

function render(notes: ScoreNote[], instrument: InstrumentId) {
  const score = asScore(notes);
  const engraved = engraveAbc(score, instrumentOf(instrument).shift);
  const paper = document.getElementById("paper");
  if (!paper) throw new Error("missing paper");
  paper.replaceChildren();
  const tunes = abcjs.renderAbc(paper, engraved.abc, { add_classes: true });
  return { paper, tunes, hits: engraved.hits, score };
}

function paint(
  rendered: ReturnType<typeof render>,
  notes: ScoreNote[],
  instrument: InstrumentId,
  mark: boolean,
) {
  return paintNotes(rendered.tunes, rendered.hits, [], null, {
    hits: outOfRangePitches(notes, instrument),
    mark,
    notes,
    instrument,
    key: rendered.score.key,
    mode: rendered.score.mode,
  });
}

describe("staff range marks", () => {
  before(() => {
    assert.equal(typeof document, "object");
  });

  it("colors only the out-of-range chord head, including a printed accidental", () => {
    const notes: ScoreNote[] = [
      { pitches: [60], dur: 1 },
      { pitches: [51, 62, 67], dur: 1, ornament: "grace", gracePitch: 51 },
    ];
    const rendered = render(notes, "trumpet");
    paint(rendered, notes, "trumpet", true);

    assert.deepEqual(namesOf(rendered.paper, ".is-out-of-range"), ["=F,"]);
    const plain = namesOf(rendered.paper, ".abcjs-notehead:not(.is-out-of-range)");
    assert.ok(plain.includes("E"), plain.join(" "));
    assert.ok(plain.includes("A"), plain.join(" "));
    assert.ok(plain.includes("=F,"), plain.join(" "));
  });

  it("colors a temporary sharp and leaves the other chord tones black", () => {
    const notes: ScoreNote[] = [{ pitches: [60, 64, 85], dur: 1 }];
    const rendered = render(notes, "bb");
    paint(rendered, notes, "bb", true);
    assert.deepEqual(namesOf(rendered.paper, ".is-out-of-range"), ["^d'"]);
    const plain = namesOf(rendered.paper, ".abcjs-notehead:not(.is-out-of-range)");
    assert.deepEqual(plain.sort(), ["D", "F"]);
  });

  it("clears marks when the toggle is off and when the instrument returns to 原调", () => {
    const notes: ScoreNote[] = [{ pitches: [51, 62, 67], dur: 1 }];
    const rendered = render(notes, "trumpet");
    paint(rendered, notes, "trumpet", true);
    assert.deepEqual(namesOf(rendered.paper, ".is-out-of-range"), ["=F,"]);

    paint(rendered, notes, "trumpet", false);
    assert.deepEqual(namesOf(rendered.paper, ".is-out-of-range"), []);

    paint(rendered, notes, "trumpet", true);
    paint(rendered, notes, "concert", true);
    assert.deepEqual(namesOf(rendered.paper, ".is-out-of-range"), []);

    const extreme: ScoreNote[] = [{ pitches: [21, 60, 108], dur: 1 }];
    const concert = render(extreme, "concert");
    paint(concert, extreme, "concert", true);
    assert.deepEqual(namesOf(concert.paper, ".is-out-of-range"), []);
    assert.equal(namesOf(concert.paper, ".abcjs-notehead").length, 3);
  });

  it("paints selection, follow, and range on the voice that owns the event", () => {
    const upper: ScoreNote[] = [
      { pitches: [60], dur: 1 },
      { pitches: [62], dur: 1 },
      { pitches: [64], dur: 1 },
      { pitches: [65], dur: 1 },
    ];
    const lower: ScoreNote[] = [
      { pitches: [48], dur: 2 },
      { pitches: [53, 96], dur: 2 },
    ];
    const score: Score = { ...asScore(upper), voice2: lower };
    const engraved = engraveAbc(score, instrumentOf("bb").shift);
    const paper = document.getElementById("paper");
    if (!paper) throw new Error("missing paper");
    paper.replaceChildren();
    const tunes = abcjs.renderAbc(paper, engraved.abc, { add_classes: true });
    const staves = (tunes[0]?.lines ?? []).reduce(
      (count, line) => count + (line.staff?.length ?? 0),
      0,
    );
    assert.equal(staves, 2);
    paintNotes(
      tunes,
      engraved.hits,
      [0],
      null,
      {
        hits: [...outOfRangePitches(upper, "bb"), ...outOfRangePitches(lower, "bb", 1)],
        mark: true,
        notes: upper,
        voices: [upper, lower],
        instrument: "bb",
        key: "C",
        mode: "major",
      },
      0,
      [{ voice: 1, note: 0 }],
    );
    const chosen: Array<{ voice: number; index: number }> = [];
    const sounding: Array<{ voice: number; index: number }> = [];
    const visit = (elems: EngravedNote[] | undefined) => {
      for (const elem of elems ?? []) {
        if (elem.el_type !== "note" || elem.startChar == null || elem.endChar == null) continue;
        const target = staffTargetAt(engraved.hits, elem.startChar, elem.endChar);
        if (!target) continue;
        const nodes = elem.abselem?.elemset ?? [];
        if (nodes.some((node) => node.classList.contains("is-chosen"))) chosen.push(target);
        if (nodes.some((node) => node.classList.contains("is-sounding"))) sounding.push(target);
      }
    };
    for (const line of tunes[0]?.lines ?? []) {
      for (const staff of line.staff ?? []) {
        for (const voice of staff.voices ?? []) visit(voice);
      }
    }
    assert.deepEqual(chosen, [{ voice: 0, index: 0 }]);
    assert.deepEqual(sounding, [{ voice: 1, index: 0 }]);
    assert.ok(namesOf(paper, ".is-out-of-range").length > 0);
    assert.equal(
      namesOf(paper, ".is-out-of-range").some((name) => name.toLowerCase().includes("c")),
      false,
    );
  });
});
