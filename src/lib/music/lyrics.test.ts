import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";
import { arrangeScore } from "./arrange.ts";
import { applyMark, cleanNote, cleanScore, retainMarks, soundingEvents } from "./expression.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { engraveAbc, formatJianpu, importJianpu, noteIndexAt } from "./notation.ts";
import { paintNotes, type EngravedTune } from "./range-paint.ts";
import { scoreToMidi } from "./midi.ts";
import { addChordPitch, CHORD_TONE_LIMIT, transposeScore, type Score, type ScoreNote } from "./theory.ts";
import {
  assignLyrics,
  clearLyrics,
  cleanLyric,
  formatAbcLyrics,
  formatLyricLine,
  lyricFromEntry,
  lyricsDropped,
  parseLyricLine,
  scoreHasLyrics,
  setNoteLyric,
  type LyricAtom,
} from "./lyrics.ts";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
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
  parseOnly: (abc: string) => Array<{
    warnings?: Array<{ message?: string } | string>;
    lines?: Array<{ staff?: Array<{ voices?: ParsedElem[][] }> }>;
  }>;
  renderAbc: (
    element: Element,
    abc: string,
    options: { add_classes: boolean; vocalfont?: object },
  ) => EngravedTune[];
};

type ParsedElem = {
  el_type?: string;
  startChar?: number;
  endChar?: number;
  rest?: unknown;
  lyric?: Array<{ syllable?: string; divider?: string }>;
  pitches?: unknown[];
  gracenotes?: unknown[];
};

function asScore(notes: ScoreNote[], extra: Partial<Score> = {}): Score {
  return {
    title: "试",
    bpm: 96,
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

function n(midi: number | number[], dur = 1, extra: Partial<ScoreNote> = {}): ScoreNote {
  const pitches = typeof midi === "number" ? (midi < 0 ? [] : [midi]) : midi;
  return { pitches, dur, ...extra };
}

function syllable(text: string, syllabic: "single" | "begin" | "middle" | "end" = "single") {
  return { text, syllabic };
}

function sung(abc: string, hits: { index: number; start: number; end: number }[]) {
  const tune = abcjs.parseOnly(abc)[0];
  const warnings = (tune?.warnings ?? []).map((warning) =>
    String(typeof warning === "string" ? warning : (warning.message ?? warning)).replace(/<[^>]+>/g, ""),
  );
  const rows: Array<{ index: number | null; text: string; divider: string; rest: boolean }> = [];
  for (const line of tune?.lines ?? []) {
    for (const staff of line.staff ?? []) {
      for (const voice of staff.voices ?? []) {
        for (const elem of voice) {
          if (elem.el_type !== "note" || elem.rest != null || !elem.pitches) continue;
          const lyric = elem.lyric?.[0];
          rows.push({
            index: noteIndexAt(hits, elem.startChar ?? 0, elem.endChar ?? 0),
            text: lyric?.syllable ?? "",
            divider: lyric?.divider ?? "",
            rest: false,
          });
        }
      }
    }
  }
  return { rows, warnings };
}

describe("lyric text", () => {
  it("splits Chinese characters and ignores spaces and punctuation", () => {
    const parsed = parseLyricLine("小 星星，亮晶晶。");
    assert.deepEqual(
      parsed.slots.map((slot) => slot.text),
      ["小", "星", "星", "亮", "晶", "晶"],
    );
    assert.ok(parsed.slots.every((slot) => slot.syllabic === "single"));
  });

  it("splits Latin on spaces and keeps hyphenated syllables", () => {
    const parsed = parseLyricLine("Twin-kle twin-kle lit-tle star");
    assert.deepEqual(
      parsed.slots.map((slot) => `${slot.syllabic}:${slot.text}`),
      [
        "begin:Twin",
        "end:kle",
        "begin:twin",
        "end:kle",
        "begin:lit",
        "end:tle",
        "single:star",
      ],
    );
  });

  it("treats a star as a blank and an underscore as a hold on the next note", () => {
    const parsed = parseLyricLine("啊 * 星 _ 亮");
    assert.deepEqual(
      parsed.slots.map((slot) => ({ text: slot.text, extend: slot.extend === true })),
      [
        { text: "啊", extend: false },
        { text: "", extend: false },
        { text: "星", extend: true },
        { text: "", extend: true },
        { text: "亮", extend: false },
      ],
    );
  });

  it("round-trips a lyric line through the sounding notes", () => {
    const notes = [n(60), n(62), n(-1), n([64, 67]), n(65), n(67), n(69)];
    const filled = assignLyrics(notes, "小 星 和 Hel-lo 亮");
    assert.equal(formatLyricLine(filled.notes), "小 星 和 Hel-lo 亮");
    assert.equal(filled.notes[2].lyric, undefined);
    assert.equal(filled.notes[3].lyric?.text, "和");
    assert.equal(filled.notes[3].pitches.length, 2);
    assert.equal(filled.notes[4].lyric?.syllabic, "begin");
    assert.equal(filled.notes[5].lyric?.text, "lo");
  });
});

describe("lyric edits", () => {
  it("puts one syllable on a chord, skips rests, and does not duplicate a tied note", () => {
    const notes = [n([60, 64, 67]), n(-1), n(62, 5), n(64)];
    const filled = assignLyrics(notes, "和 弦 尾");
    assert.equal(filled.notes[0].lyric?.text, "和");
    assert.equal(filled.notes[0].lyric?.syllabic, "single");
    assert.equal(filled.notes[1].lyric, undefined);
    assert.equal(filled.notes[2].lyric?.text, "弦");
    assert.equal(filled.notes[3].lyric?.text, "尾");
    assert.equal(filled.notice, null);
  });

  it("reports leftover syllables and clears the tail when the line is shorter", () => {
    const notes = [n(60, 1, { lyric: syllable("旧") }), n(62), n(64)];
    const extra = assignLyrics(notes, "一 二 三 四");
    assert.match(extra.notice ?? "", /还有 1 个字/);
    assert.equal(extra.notes[2].lyric?.text, "三");
    const short = assignLyrics(notes, "只");
    assert.equal(short.notes[0].lyric?.text, "只");
    assert.equal(short.notes[1].lyric, undefined);
    assert.equal(short.notes[2].lyric, undefined);
    assert.match(short.notice ?? "", /后面还有 2 个音/);
  });

  it("writes, blanks, and removes one selected note without moving the others", () => {
    const notes = assignLyrics([n(60), n(62), n(-1), n(64)], "小 星 亮").notes;
    const placed = lyricFromEntry("啊");
    assert.equal(placed.ok, true);
    if (!placed.ok) return;
    const written = setNoteLyric(notes, 1, placed.lyric);
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.notes[0].lyric?.text, "小");
    assert.equal(written.notes[1].lyric?.text, "啊");
    assert.equal(written.notes[3].lyric?.text, "亮");

    const blank = setNoteLyric(written.notes, 0, { text: "", syllabic: "single" });
    assert.equal(blank.ok, true);
    if (!blank.ok) return;
    assert.deepEqual(blank.notes[0].lyric, { text: "", syllabic: "single" });
    assert.equal(blank.notes[1].lyric?.text, "啊");

    const removed = setNoteLyric(blank.notes, 1, null);
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.notes[1].lyric, undefined);
    assert.equal(formatLyricLine(removed.notes), "* * 亮");

    const rest = setNoteLyric(removed.notes, 2, { text: "休", syllabic: "single" });
    assert.deepEqual(rest, { ok: false, reason: "rest" });
    const many = lyricFromEntry("两个 字");
    assert.deepEqual(many, { ok: false, reason: "many" });
  });

  it("clears every lyric and keeps pitches", () => {
    const notes = assignLyrics([n(60), n(62)], "小 星").notes;
    const cleared = clearLyrics(notes);
    assert.equal(scoreHasLyrics(cleared), false);
    assert.deepEqual(
      cleared.map((note) => note.pitches),
      notes.map((note) => note.pitches),
    );
    assert.equal(clearLyrics(cleared), cleared);
  });
});

describe("lyric retention", () => {
  it("keeps lyrics through transpose, chord stacking, and expression marks", () => {
    const marked = applyMark(
      [n(60, 1, { lyric: syllable("小") }), n(64, 1, { lyric: syllable("星") })],
      [0],
      { type: "dynamic", value: "p" },
    );
    assert.equal(marked[0].dynamic, "p");
    assert.equal(marked[0].lyric?.text, "小");
    assert.equal(marked[1].lyric?.text, "星");

    const stacked = addChordPitch(marked[0], 67);
    assert.equal(stacked.ok, true);
    if (!stacked.ok) return;
    assert.deepEqual(stacked.note.pitches, [60, 67]);
    assert.equal(stacked.note.lyric?.text, "小");
    const full = addChordPitch(
      { ...stacked.note, pitches: Array.from({ length: CHORD_TONE_LIMIT }, (_, i) => 60 + i) },
      80,
    );
    assert.deepEqual(full, { ok: false, reason: "full" });

    const moved = transposeScore(asScore(marked), 2);
    assert.deepEqual(moved.notes[0].pitches, [62]);
    assert.equal(moved.notes[0].lyric?.text, "小");
    assert.equal(moved.notes[1].lyric?.text, "星");

    const events = soundingEvents(asScore(marked));
    const bare = soundingEvents(asScore([n(60, 1, { dynamic: "p" }), n(64)]));
    assert.deepEqual(
      events.map((event) => [event.midi, event.start, event.dur, event.gain]),
      bare.map((event) => [event.midi, event.start, event.dur, event.gain]),
    );
  });

  it("keeps lyrics when the same pitches are parsed again and drops them when the line changes", () => {
    const notes = assignLyrics([n(60), n(62), n(64)], "小 星 星").notes;
    const score = asScore(notes);
    const same = importJianpu(formatJianpu(score), score, 0);
    assert.equal(same.error, null);
    const kept = retainMarks(notes, same.notes);
    assert.equal(lyricsDropped(notes, kept), false);
    assert.equal(kept[1].lyric?.text, "星");

    const changed = importJianpu("1 2 3 1", score, 0);
    const dropped = retainMarks(notes, changed.notes);
    assert.equal(lyricsDropped(notes, dropped), true);
    assert.ok(dropped.every((note) => note.lyric == null));
  });

  it("drops lyrics only on notes a style rewrite replaces", () => {
    const score = asScore([
      n(60, 1, { lyric: syllable("小"), dynamic: "mf" }),
      n([64, 67], 1, { lyric: syllable("星") }),
      n(67, 1, { lyric: syllable("亮") }),
    ]);
    const next = arrangeScore(score, "lively");
    assert.notEqual(next, score);
    assert.equal(next.notes.some((note) => note.lyric?.text === "星"), true);
    assert.equal(lyricsDropped(score.notes, next.notes), true);
    assert.ok(next.notes.filter((note) => note.pitches.length > 1).every((note) => note.lyric?.text === "星"));
  });

  it("sanitizes stored lyrics and strips them from rests", () => {
    const cleaned = cleanScore(
      asScore([
        n(60, 1, { lyric: { text: "  小星星  ", syllabic: "begin", extend: true } }),
        n(-1, 1, { lyric: syllable("休") }),
        n(62, 1, { lyric: { text: "x", syllabic: "nope" as "single" } }),
      ]),
    );
    assert.equal(cleaned.notes[0].lyric?.text, "小星星");
    assert.equal(cleaned.notes[0].lyric?.syllabic, "begin");
    assert.equal(cleaned.notes[0].lyric?.extend, true);
    assert.equal(cleaned.notes[1].lyric, undefined);
    assert.equal(cleaned.notes[2].lyric?.syllabic, "single");
    assert.equal(cleanNote({ pitches: [60], dur: 1 }).lyric, undefined);
  });
});

describe("lyric engraving", () => {
  it("aligns syllables under notes, not under rests, chords pitches, or tie fragments", () => {
    const notes = [
      n([60, 64], 1, { lyric: syllable("和"), dynamic: "mf" }),
      n(-1),
      n(62, 5, { lyric: syllable("长") }),
      n(64, 1, { lyric: { text: "啊", syllabic: "single", extend: true } }),
      n(65, 1, { lyric: { text: "", syllabic: "single", extend: true } }),
      n(67, 1, { lyric: { text: "尾", syllabic: "single" } }),
    ];
    const engraved = engraveAbc(asScore(notes));
    assert.match(engraved.abc, /^w: /m);
    const { rows, warnings } = sung(engraved.abc, engraved.hits);
    assert.equal(warnings.join("\n"), "", warnings.join("\n"));
    const byIndex = new Map<number, string[]>();
    for (const row of rows) {
      assert.notEqual(row.index, null);
      const list = byIndex.get(row.index ?? -1) ?? [];
      list.push(row.text);
      byIndex.set(row.index ?? -1, list);
    }
    assert.deepEqual(byIndex.get(0), ["和"]);
    assert.equal(byIndex.has(1), false);
    assert.equal(byIndex.get(2)?.[0], "长");
    assert.ok((byIndex.get(2) ?? []).slice(1).every((text) => text === ""));
    assert.equal(byIndex.get(3)?.[0], "啊");
    assert.equal(byIndex.get(4)?.every((text) => text === ""), true);
    assert.equal(byIndex.get(5)?.[0], "尾");
    assert.doesNotMatch(engraveAbc(asScore([n(60), n(62)])).abc, /^w: /m);
  });

  it("draws a hyphen between Latin syllables and keeps them on separate notes", () => {
    const notes = assignLyrics([n(60), n(62), n(64)], "Hel-lo star").notes;
    const engraved = engraveAbc(asScore(notes));
    const { rows } = sung(engraved.abc, engraved.hits);
    assert.equal(rows[0].text, "Hel");
    assert.equal(rows[0].divider, "-");
    assert.equal(rows[1].text, "lo");
    assert.equal(rows[2].text, "star");
  });

  it("renders lyric text under the matching noteheads and leaves range marks on the heads", () => {
    const notes = [
      n(60, 1, { lyric: syllable("小") }),
      n(-1),
      n([64, 67], 1, { lyric: syllable("星") }),
      n(72, 1, { lyric: syllable("亮") }),
    ];
    const score = asScore(notes);
    const engraved = engraveAbc(score, 2);
    const paper = document.getElementById("paper");
    if (!paper) throw new Error("missing paper");
    paper.replaceChildren();
    const tunes = abcjs.renderAbc(paper, engraved.abc, {
      add_classes: true,
      vocalfont: {
        face: '"WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif',
        size: 15,
        weight: "normal",
        style: "normal",
        decoration: "none",
      },
    });
    const lyricNodes = [...paper.querySelectorAll(".abcjs-lyric")];
    const lyrics = lyricNodes.map((node) => (node.textContent ?? "").replace(/\s+/g, ""));
    assert.deepEqual(lyrics, ["小", "星", "亮"]);
    const xs = lyricNodes.map((node) => Number(node.getAttribute("x")));
    const ys = lyricNodes.map((node) => Number(node.getAttribute("y")));
    assert.ok(xs.every((value) => Number.isFinite(value)));
    assert.ok(xs[0] < xs[1] && xs[1] < xs[2]);
    assert.ok(xs[1] - xs[0] > xs[2] - xs[1]);
    assert.ok(ys.every((value) => value > 100));
    paintNotes(tunes, engraved.hits, [2], 0, {
      hits: [],
      mark: true,
      notes,
      instrument: "bb",
      key: "C",
      mode: "major",
    });
    assert.equal(paper.querySelectorAll(".abcjs-lyric.is-chosen").length, 0);
    assert.equal(paper.querySelectorAll(".abcjs-lyric.is-sounding").length, 0);
    assert.ok(paper.querySelector(".abcjs-note.is-chosen, .abcjs-note .is-chosen"));
  });

  it("keeps the syllable after a percent when the lyric is engraved", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1"><measure number="1">
          <attributes>
            <divisions>1</divisions>
            <key><fifths>0</fifths><mode>major</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time>
          </attributes>
          ${[
            ["C", "100%"],
            ["D", "Go"],
            ["E", "a*b"],
            ["F", "rock_n"],
            ["G", "A|B"],
            ["A", "oh no"],
            ["B", "well-known"],
            ["C", "end"],
          ]
            .map(
              ([step, text]) => `<note>
                <pitch><step>${step}</step><octave>${step === "C" && text === "end" ? 5 : 4}</octave></pitch>
                <duration>1</duration>
                <lyric number="1"><syllabic>single</syllabic><text>${text}</text></lyric>
              </note>`,
            )
            .join("")}
        </measure></part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "百分");
    const engraved = engraveAbc(imported.score);
    assert.match(engraved.abc, /^w: 100\\% Go a\\\*b rock\\_n A\\\|B oh~no well\\-known end/m);
    const { rows, warnings } = sung(engraved.abc, engraved.hits);
    assert.equal(warnings.join("\n"), "");
    const text = rows.map((row) => row.text.replace(/\u200B/g, "").replace(/\u00A0/g, " "));
    assert.equal(text[0], "100％");
    assert.deepEqual(text.slice(1), ["Go", "a*b", "rock_n", "A|B", "oh no", "well-known", "end"]);
    assert.deepEqual(
      rows.map((row) => row.index),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
  });

  it("draws the extender through later holds, a tied split, and the next system", () => {
    const held = engraveAbc(
      asScore([
        n(60, 5, {
          lyric: { text: "Ah", syllabic: "single", extend: true, extendType: "start", extendEnd: "stop" },
        }),
        n(62, 1, { lyric: { text: "", syllabic: "single", extend: true, extendType: "continue" } }),
        n(64, 1, { lyric: { text: "", syllabic: "single", extend: true, extendType: "stop" } }),
        n(65, 1, { lyric: syllable("Go") }),
      ]),
    );
    assert.match(held.abc, /^w: Ah_ _ _ Go/m);
    const heldSung = sung(held.abc, held.hits);
    assert.equal(heldSung.warnings.join("\n"), "");
    assert.deepEqual(
      heldSung.rows.map((row) => [row.index, row.text, row.divider]),
      [
        [0, "Ah", "_"],
        [0, "", " "],
        [1, "", " "],
        [2, "", " "],
        [3, "Go", " "],
      ],
    );

    const across = engraveAbc(
      asScore([
        n(60, 4),
        n(60, 4),
        n(60, 4),
        n(60, 4, { lyric: { text: "Ah", syllabic: "single", extend: true } }),
        n(62, 4, { lyric: { text: "", syllabic: "single", extend: true, extendType: "stop" } }),
        n(64, 4, { lyric: syllable("Go") }),
      ]),
    );
    const lyricLines = across.abc.split("\n").filter((line) => line.startsWith("w:"));
    assert.deepEqual(lyricLines, ["w: * * * Ah_", "w: _ Go"]);
    const acrossSung = sung(across.abc, across.hits);
    assert.equal(acrossSung.warnings.join("\n"), "");
    assert.deepEqual(
      acrossSung.rows.filter((row) => row.index != null && row.index >= 3).map((row) => [row.index, row.text, row.divider]),
      [
        [3, "Ah", "_"],
        [4, "", " "],
        [5, "Go", " "],
      ],
    );
  });
});

describe("MusicXML lyrics", () => {
  it("round-trips text, syllabic, extender, blank, chord, rest, and a tie", () => {
    const notes = [
      n([60, 64], 1, { lyric: syllable("和") }),
      n(-1, 1),
      n(62, 5, { lyric: { text: "Hel", syllabic: "begin" } }),
      n(64, 1, { lyric: { text: "lo", syllabic: "end", extend: true } }),
      n(65, 1, { lyric: { text: "", syllabic: "single", extend: true } }),
      n(67, 1, { lyric: { text: "", syllabic: "single" } }),
    ];
    const xml = scoreToMusicXml(asScore(notes, { title: "歌词" }));
    assert.match(xml, /<lyric number="1">/);
    assert.equal(xml.split("<lyric ").length - 1, 5);
    assert.match(xml, /<syllabic>begin<\/syllabic>\s*<text>Hel<\/text>/);
    assert.match(xml, /<syllabic>end<\/syllabic>\s*<text>lo<\/text>\s*<extend\/>/);
    assert.match(xml, /<lyric number="1">\s*<extend\/>\s*<\/lyric>/);
    const restNote = xml.split("<note>").find((part) => part.includes("<rest/>"));
    assert.ok(restNote);
    assert.equal(restNote.includes("<lyric"), false);
    const back = musicXmlToScore(xml, "fallback");
    assert.equal(back.score.notes[0].lyric?.text, "和");
    assert.equal(back.score.notes[1].lyric, undefined);
    assert.equal(back.score.notes[2].lyric?.text, "Hel");
    assert.equal(back.score.notes[2].lyric?.syllabic, "begin");
    assert.equal(back.score.notes[3].lyric?.text, "lo");
    assert.equal(back.score.notes[3].lyric?.extend, true);
    assert.equal(back.score.notes[4].lyric?.extend, true);
    assert.equal(back.score.notes[4].lyric?.text, "");
    assert.deepEqual(back.score.notes[5].lyric, { text: "", syllabic: "single" });
    assert.doesNotMatch(back.notice, /已略过歌词/);
  });

  it("keeps verse 1, skips a rest lyric, and does not merge another verse", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note>
              <rest/>
              <duration>1</duration>
              <lyric number="1"><text>休</text></lyric>
            </note>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <lyric number="1"><syllabic>single</syllabic><text>小</text></lyric>
              <lyric number="2"><text>第二段</text></lyric>
            </note>
            <note>
              <chord/>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <lyric number="1"><text>多</text></lyric>
            </note>
            <note>
              <pitch><step>G</step><octave>4</octave></pitch>
              <duration>1</duration>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "段");
    assert.equal(imported.score.notes[0].lyric, undefined);
    assert.equal(imported.score.notes[1].lyric?.text, "小");
    assert.equal(imported.score.notes[1].pitches.length, 2);
    assert.equal(imported.score.notes[2].lyric, undefined);
    assert.match(imported.notice, /第 1 段/);
    assert.match(imported.notice, /休止符上的歌词/);
    assert.match(imported.notice, /和弦上多出来的歌词/);
    assert.equal(imported.score.notes.some((note) => note.lyric?.text === "第二段"), false);
    assert.equal(imported.score.notes.some((note) => note.lyric?.text === "休"), false);
    assert.equal(imported.score.notes.some((note) => note.lyric?.text === "多"), false);
  });

  it("round-trips an extender start, continue, and stop onto the same notes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1"><measure number="1">
          <attributes>
            <divisions>1</divisions>
            <key><fifths>0</fifths><mode>major</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time>
          </attributes>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
            <lyric number="1"><text>Ah</text><extend type="start"/></lyric>
          </note>
          <note>
            <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
            <lyric number="1"><extend type="continue"/></lyric>
          </note>
          <note>
            <pitch><step>E</step><octave>4</octave></pitch><duration>1</duration>
            <lyric number="1"><extend type="stop"/></lyric>
          </note>
          <note>
            <pitch><step>F</step><octave>4</octave></pitch><duration>1</duration>
            <lyric number="1"><text>Go</text></lyric>
          </note>
        </measure></part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "延");
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extendType, "start");
    assert.equal(imported.score.notes[1].lyric?.text, "");
    assert.equal(imported.score.notes[1].lyric?.extendType, "continue");
    assert.equal(imported.score.notes[2].lyric?.text, "");
    assert.equal(imported.score.notes[2].lyric?.extendType, "stop");
    assert.equal(imported.score.notes[2].lyric?.extend, true);
    assert.equal(imported.score.notes[3].lyric?.text, "Go");
    assert.equal(imported.score.notes[3].lyric?.extendType, undefined);
    const exported = scoreToMusicXml(imported.score);
    assert.match(exported, /<text>Ah<\/text>\s*<extend type="start"\/>/);
    assert.match(exported, /<lyric number="1">\s*<extend type="continue"\/>\s*<\/lyric>/);
    assert.match(exported, /<lyric number="1">\s*<extend type="stop"\/>\s*<\/lyric>/);
    const back = musicXmlToScore(exported, "延");
    assert.deepEqual(
      back.score.notes.map((note) => note.lyric?.extendType ?? note.lyric?.text),
      ["start", "continue", "stop", "Go"],
    );
    const engraved = engraveAbc(back.score);
    assert.match(engraved.abc, /^w: Ah_ _ Go/m);
    const { rows, warnings } = sung(engraved.abc, engraved.hits);
    assert.equal(warnings.join("\n"), "");
    assert.deepEqual(
      rows.map((row) => [row.index, row.text, row.divider]),
      [
        [0, "Ah", "_"],
        [1, "", " "],
        [2, "", " "],
        [3, "Go", " "],
      ],
    );
  });

  it("keeps an extender stop on the far side of a tie across a bar", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>4</duration>
              <tie type="start"/>
              <lyric number="1"><text>Ah</text><extend type="start"/></lyric>
            </note>
          </measure>
          <measure number="2">
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
              <lyric number="1"><extend type="stop"/></lyric>
            </note>
            <note>
              <pitch><step>D</step><octave>4</octave></pitch>
              <duration>1</duration>
              <lyric number="1"><text>Go</text></lyric>
            </note>
            <note><rest/><duration>2</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "连延");
    assert.equal(imported.score.notes[0].dur, 5);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extendType, "start");
    assert.equal(imported.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(imported.score.notes[1].lyric?.text, "Go");
    assert.doesNotMatch(imported.notice, /连音后面/);
    const exported = scoreToMusicXml(imported.score);
    const measures = exported.split("<measure");
    assert.match(measures[1], /<text>Ah<\/text>\s*<extend type="start"\/>/);
    const stopNote = measures[2].split("<note>")[1] ?? "";
    assert.match(stopNote, /<extend type="stop"\/>/);
    assert.doesNotMatch(stopNote, /Ah/);
    const back = musicXmlToScore(exported, "连延");
    assert.equal(back.score.notes[0].lyric?.extendType, "start");
    assert.equal(back.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(back.score.notes[1].lyric?.text, "Go");
    const engraved = engraveAbc(back.score);
    const { rows, warnings } = sung(engraved.abc, engraved.hits);
    assert.equal(warnings.join("\n"), "");
    assert.deepEqual(
      rows.map((row) => [row.index, row.text, row.divider]),
      [
        [0, "Ah", "_"],
        [0, "", " "],
        [1, "Go", " "],
      ],
    );
  });

  it("keeps a same-bar tie stop and a headless stop on the last fragment", () => {
    const sameBar = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/><lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><lyric number="1"><extend type="stop"/></lyric></note>
        <note><rest/><duration>2</duration></note>
      </measure></part></score-partwise>`;
    const same = musicXmlToScore(sameBar, "同小节");
    assert.equal(same.score.notes[0].dur, 2);
    assert.equal(same.score.notes[0].lyric?.text, "Ah");
    assert.equal(same.score.notes[0].lyric?.extendType, "start");
    assert.equal(same.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(same.score.notes[0].lyric?.extendEndAt, 1);
    const sameOut = scoreToMusicXml(same.score);
    const sameNotes = [...sameOut.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(sameNotes.length, 2);
    assert.match(sameNotes[0], /<type>quarter<\/type>/);
    assert.match(sameNotes[0], /tie type="start"/);
    assert.match(sameNotes[0], /<text>Ah<\/text>[\s\S]*<extend type="start"\/>/);
    assert.match(sameNotes[1], /<type>quarter<\/type>/);
    assert.match(sameNotes[1], /tie type="stop"/);
    assert.match(sameNotes[1], /<extend type="stop"\/>/);
    assert.doesNotMatch(sameNotes[1], /Ah/);
    const sameBack = musicXmlToScore(sameOut, "同小节");
    assert.equal(sameBack.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(sameBack.score.notes[0].lyric?.extendEndAt, 1);

    const headless = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>
            <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        </measure>
        <measure number="2">
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>
            <tie type="start"/></note>
        </measure>
        <measure number="3">
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
            <tie type="stop"/><lyric number="1"><extend type="stop"/></lyric></note>
          <note><rest/><duration>3</duration></note>
        </measure>
      </part></score-partwise>`;
    const open = musicXmlToScore(headless, "无头");
    assert.equal(open.score.notes[0].lyric?.text, "Ah");
    assert.equal(open.score.notes[0].lyric?.extendType, "start");
    assert.equal(open.score.notes[1].dur, 5);
    assert.equal(open.score.notes[1].lyric?.text, "");
    assert.equal(open.score.notes[1].lyric?.extendType, undefined);
    assert.equal(open.score.notes[1].lyric?.extendEnd, "stop");
    assert.equal(open.score.notes[1].lyric?.extendEndAt, 4);
    const openOut = scoreToMusicXml(open.score);
    const openMeasures = openOut.split("<measure");
    assert.match(openMeasures[1], /<text>Ah<\/text>[\s\S]*<extend type="start"\/>/);
    assert.doesNotMatch(openMeasures[2], /<extend /);
    assert.match(openMeasures[3], /tie type="stop"[\s\S]*<extend type="stop"\/>/);
    assert.doesNotMatch(openMeasures[3].split("<note>")[1] ?? "", /<extend type="start"/);
    const openBack = musicXmlToScore(openOut, "无头");
    assert.equal(openBack.score.notes[1].lyric?.extendEnd, "stop");
    assert.equal(openBack.score.notes[1].lyric?.extendEndAt, 4);
    assert.equal(openBack.score.notes[1].lyric?.extendType, undefined);

    const inside = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><rest/><duration>2</duration></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>
          <tie type="start"/></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>
          <tie type="stop"/><lyric number="1"><extend type="stop"/></lyric></note>
        <note><rest/><duration>4</duration></note>
      </measure></part></score-partwise>`;
    const beat = musicXmlToScore(inside, "拍中");
    assert.equal(beat.score.notes[1].dur, 1);
    assert.equal(beat.score.notes[1].lyric?.extendEnd, "stop");
    assert.equal(beat.score.notes[1].lyric?.extendEndAt, 0.5);
    assert.equal(beat.score.notes[1].lyric?.extendType, undefined);
    const beatOut = scoreToMusicXml(beat.score);
    const eighths = [...beatOut.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(eighths.length, 2);
    assert.match(eighths[0], /<type>eighth<\/type>/);
    assert.match(eighths[0], /tie type="start"/);
    assert.doesNotMatch(eighths[0], /<extend /);
    assert.match(eighths[1], /<type>eighth<\/type>/);
    assert.match(eighths[1], /tie type="stop"/);
    assert.match(eighths[1], /<extend type="stop"\/>/);
    const beatBack = musicXmlToScore(beatOut, "拍中");
    assert.equal(beatBack.score.notes[1].lyric?.extendEndAt, 0.5);
    assert.equal(beatBack.score.notes[1].lyric?.extendEnd, "stop");
  });

  it("keeps a stop on the tied fragment that starts at its offset", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
            <tie type="start"/>
            <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration>
            <tie type="stop"/><tie type="start"/>
            <lyric number="1"><extend type="stop"/></lyric></note>
        </measure>
        <measure number="2">
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
            <tie type="stop"/></note>
          <note><rest/><duration>3</duration></note>
        </measure>
      </part></score-partwise>`;
    const imported = musicXmlToScore(xml, "三段");
    assert.equal(imported.score.notes[0].dur, 5);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extendType, "start");
    assert.equal(imported.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(imported.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(imported.score.notes[0].lyric?.extendEndDur, 3);
    const exported = scoreToMusicXml(imported.score);
    const sounded = [...exported.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(sounded.length, 3);
    assert.match(sounded[0], /<type>quarter<\/type>/);
    assert.match(sounded[0], /tie type="start"/);
    assert.match(sounded[0], /<text>Ah<\/text>[\s\S]*<extend type="start"\/>/);
    assert.doesNotMatch(sounded[0], /extend type="stop"/);
    assert.match(sounded[1], /<type>half<\/type>\s*<dot\/>/);
    assert.match(sounded[1], /tie type="stop"/);
    assert.match(sounded[1], /tie type="start"/);
    assert.match(sounded[1], /<extend type="stop"\/>/);
    assert.doesNotMatch(sounded[1], /continue/);
    assert.match(sounded[2], /<type>quarter<\/type>/);
    assert.match(sounded[2], /tie type="stop"/);
    assert.doesNotMatch(sounded[2], /<extend /);
    assert.doesNotMatch(exported, /extend type="continue"/);
    const again = musicXmlToScore(exported, "三段");
    assert.equal(again.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(again.score.notes[0].lyric?.extendEndDur, 3);
    assert.equal(again.score.notes[0].lyric?.extendEnd, "stop");
    const twice = scoreToMusicXml(again.score);
    const twiceSounded = [...twice.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(twiceSounded.length, 3);
    assert.match(twiceSounded[1], /<extend type="stop"\/>/);
    assert.doesNotMatch(twiceSounded[2], /<extend /);
    assert.doesNotMatch(twice, /extend type="continue"/);

    const crossing = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
      </measure></part></score-partwise>`;
    const split = musicXmlToScore(crossing, "跨小节停");
    assert.equal(split.score.notes[0].dur, 5);
    assert.equal(split.score.notes[0].lyric?.extendEndAt, 3);
    assert.equal(split.score.notes[0].lyric?.extendEndDur, 2);
    const splitOut = scoreToMusicXml(split.score);
    const splitNotes = [...splitOut.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(splitNotes.length, 2);
    assert.deepEqual(split.score.measureEnds, [5]);
    assert.match(splitNotes[0], /<type>half<\/type>\s*<dot\/>/);
    assert.match(splitNotes[0], /<extend type="start"\/>/);
    assert.match(splitNotes[1], /<type>half<\/type>/);
    assert.match(splitNotes[1], /<extend type="stop"\/>/);

    assert.doesNotMatch(splitOut, /extend type="continue"/);
    const splitBack = musicXmlToScore(splitOut, "跨小节停");
    assert.equal(splitBack.score.notes[0].lyric?.extendEndAt, 3);
    assert.equal(splitBack.score.notes[0].lyric?.extendEnd, "stop");
    assert.doesNotMatch(scoreToMusicXml(splitBack.score), /extend type="continue"/);
  });

  it("keeps an extender when a dynamic blocks the tie from merging", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note>
          <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric>
        </note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note>
          <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend type="stop"/></lyric>
        </note>
        <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
        <note>
          <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Go</text><extend type="start"/></lyric>
        </note>
        <direction><direction-type><dynamics><mp/></dynamics></direction-type></direction>
        <note>
          <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Go</text><extend type="continue"/></lyric>
        </note>
      </measure></part></score-partwise>`;
    const imported = musicXmlToScore(xml, "分开");
    assert.equal(imported.score.notes.length, 4);
    assert.equal(imported.score.notes[0].dur, 1);
    assert.equal(imported.score.notes[0].dynamic, undefined);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extendType, "start");
    assert.equal(imported.score.notes[1].dur, 1);
    assert.equal(imported.score.notes[1].pitches[0], 60);
    assert.equal(imported.score.notes[1].dynamic, "f");
    assert.equal(imported.score.notes[1].lyric?.text, "");
    assert.equal(imported.score.notes[1].lyric?.extendType, "stop");
    assert.equal(imported.score.notes[2].dynamic, "p");
    assert.equal(imported.score.notes[2].lyric?.text, "Go");
    assert.equal(imported.score.notes[2].lyric?.extendType, "start");
    assert.equal(imported.score.notes[3].dur, 1);
    assert.equal(imported.score.notes[3].pitches[0], 62);
    assert.equal(imported.score.notes[3].dynamic, "mp");
    assert.equal(imported.score.notes[3].lyric?.text, "");
    assert.equal(imported.score.notes[3].lyric?.extendType, "continue");
    const back = musicXmlToScore(scoreToMusicXml(imported.score), "分开");
    assert.equal(back.score.notes.length, 4);
    assert.equal(back.score.notes[0].lyric?.text, "Ah");
    assert.equal(back.score.notes[0].lyric?.extendType, "start");
    assert.equal(back.score.notes[0].dynamic, undefined);
    assert.equal(back.score.notes[1].dynamic, "f");
    assert.equal(back.score.notes[1].lyric?.text, "");
    assert.equal(back.score.notes[1].lyric?.extendType, "stop");
    assert.equal(back.score.notes[1].dur, 1);
    assert.equal(back.score.notes[3].lyric?.extendType, "continue");
    assert.equal(back.score.notes[3].lyric?.text, "");
    assert.equal(back.score.notes[3].dynamic, "mp");

    const bare = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
        <note><rest/><duration>2</duration></note>
      </measure></part></score-partwise>`;
    const textless = musicXmlToScore(bare, "空停");
    assert.equal(textless.score.notes[1].dynamic, "mf");
    assert.equal(textless.score.notes[1].lyric?.text, "");
    assert.equal(textless.score.notes[1].lyric?.extendType, "stop");
    assert.equal(textless.score.notes[0].lyric?.text, "Ah");
    const textlessBack = musicXmlToScore(scoreToMusicXml(textless.score), "空停");
    assert.equal(textlessBack.score.notes[1].dynamic, "mf");
    assert.equal(textlessBack.score.notes[1].lyric?.extendType, "stop");
    assert.equal(textlessBack.score.notes[1].lyric?.text, "");
  });

  it("uses the first syllable of a tie for every later fragment", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="continue"/></lyric></note>
        <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend type="stop"/></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const imported = musicXmlToScore(xml, "三截");
    assert.deepEqual(
      imported.score.notes.slice(0, 3).map((note) => note.lyric?.text),
      ["Ah", "", ""],
    );
    assert.deepEqual(
      imported.score.notes.slice(0, 3).map((note) => note.lyric?.extendType),
      ["start", "continue", "stop"],
    );
    assert.deepEqual(
      imported.score.notes.slice(0, 3).map((note) => note.dynamic),
      [undefined, "f", "p"],
    );
    assert.deepEqual(
      imported.score.notes.slice(0, 3).map((note) => note.dur),
      [1, 1, 1],
    );
    const back = musicXmlToScore(scoreToMusicXml(imported.score), "三截");
    assert.deepEqual(
      back.score.notes.slice(0, 3).map((note) => note.lyric?.text),
      ["Ah", "", ""],
    );
    assert.deepEqual(
      back.score.notes.slice(0, 3).map((note) => note.lyric?.extendType),
      ["start", "continue", "stop"],
    );
    assert.deepEqual(
      back.score.notes.slice(0, 3).map((note) => note.dynamic),
      [undefined, "f", "p"],
    );
    assert.ok(back.score.notes.slice(0, 3).every((note) => note.dur === 1));

    const textlessMiddle = xml.replace(
      "<text>Ah</text><extend type=\"continue\"/>",
      "<extend type=\"continue\"/>",
    );
    const middle = musicXmlToScore(textlessMiddle, "空续");
    assert.deepEqual(
      middle.score.notes.slice(0, 3).map((note) => note.lyric?.text),
      ["Ah", "", ""],
    );
    assert.deepEqual(
      middle.score.notes.slice(0, 3).map((note) => note.lyric?.extendType),
      ["start", "continue", "stop"],
    );

    const otherWord = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>No</text><extend type="stop"/></lyric></note>
        <note><rest/><duration>1</duration></note>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration>
          <lyric number="1"><text>Ah</text></lyric></note>
      </measure></part></score-partwise>`;
    const changed = musicXmlToScore(otherWord, "换字");
    assert.equal(changed.score.notes[0].lyric?.text, "Ah");
    assert.equal(changed.score.notes[1].lyric?.text, "No");
    assert.equal(changed.score.notes[1].lyric?.extendType, "stop");
    assert.equal(changed.score.notes[1].dynamic, "f");
    assert.equal(changed.score.notes[3].lyric?.text, "Ah");
    assert.equal(changed.score.notes[2].pitches.length, 0);

    const untied = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const separate = musicXmlToScore(untied, "各写");
    assert.deepEqual(
      separate.score.notes.map((note) => note.lyric?.text ?? ""),
      ["Ah", "Ah", "Ah", ""],
    );

    const mixed = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="continue"/></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend type="stop"/></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const joined = musicXmlToScore(mixed, "半并");
    assert.equal(joined.score.notes[0].dur, 2);
    assert.equal(joined.score.notes[0].lyric?.text, "Ah");
    assert.equal(joined.score.notes[0].lyric?.extendType, "start");
    assert.equal(joined.score.notes[0].lyric?.extendEnd, "continue");
    assert.equal(joined.score.notes[1].dur, 1);
    assert.equal(joined.score.notes[1].dynamic, "f");
    assert.equal(joined.score.notes[1].lyric?.text, "");
    assert.equal(joined.score.notes[1].lyric?.extendType, "stop");
  });

  it("does not revive a syllable when a cleared tie fragment is merged", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const imported = musicXmlToScore(xml, "并回");
    assert.equal(imported.score.notes.length, 3);
    assert.equal(imported.score.notes[0].dur, 1);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].dynamic, undefined);
    assert.equal(imported.score.notes[1].dur, 2);
    assert.equal(imported.score.notes[1].dynamic, "f");
    assert.equal(imported.score.notes[1].lyric, undefined);
    assert.equal(imported.score.notes[2].pitches.length, 0);
    assert.equal(imported.score.notes[2].dur, 1);
    const back = musicXmlToScore(scoreToMusicXml(imported.score), "并回");
    assert.equal(back.score.notes[0].dur, 1);
    assert.equal(back.score.notes[0].lyric?.text, "Ah");
    assert.equal(back.score.notes[1].dur, 2);
    assert.equal(back.score.notes[1].dynamic, "f");
    assert.equal(back.score.notes[1].lyric, undefined);

    const marked = xml.replace(
      "<lyric number=\"1\"><text>Ah</text></lyric></note>\n        <note><rest/>",
      "<lyric number=\"1\"><text>Ah</text><extend type=\"stop\"/></lyric></note>\n        <note><rest/>",
    );
    const withStop = musicXmlToScore(marked, "并停");
    assert.equal(withStop.score.notes[0].lyric?.text, "Ah");
    assert.equal(withStop.score.notes[1].dur, 2);
    assert.equal(withStop.score.notes[1].dynamic, "f");
    assert.equal(withStop.score.notes[1].lyric?.text, "");
    assert.equal(withStop.score.notes[1].lyric?.extendEnd, "stop");
    assert.equal(withStop.score.notes[1].lyric?.extendEndAt, 1);
    assert.equal(withStop.score.notes[1].lyric?.extendEndDur, 1);
  });

  it("does not join a tie across a forward, a rest, or a different pitch", () => {
    const gap = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <forward><duration>1</duration></forward>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const forwarded = musicXmlToScore(gap, "空拍");
    assert.deepEqual(
      forwarded.score.notes.map((note) => note.pitches[0] ?? null),
      [60, null, 60, null],
    );
    assert.deepEqual(
      forwarded.score.notes.map((note) => note.dur),
      [1, 1, 1, 1],
    );
    assert.deepEqual(
      forwarded.score.notes.map((note) => note.lyric?.text ?? ""),
      ["Ah", "", "Ah", ""],
    );

    const rest = gap.replace("<forward><duration>1</duration></forward>", "<note><rest/><duration>1</duration></note>");
    const rested = musicXmlToScore(rest, "休止");
    assert.deepEqual(
      rested.score.notes.map((note) => note.pitches[0] ?? null),
      [60, null, 60, null],
    );
    assert.deepEqual(
      rested.score.notes.map((note) => note.dur),
      [1, 1, 1, 1],
    );
    assert.deepEqual(
      rested.score.notes.map((note) => note.lyric?.text ?? ""),
      ["Ah", "", "Ah", ""],
    );

    const otherPitch = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text></lyric></note>
      </measure></part></score-partwise>`;
    const moved = musicXmlToScore(otherPitch, "换音");
    assert.deepEqual(
      moved.score.notes.map((note) => note.pitches[0]),
      [60, 62],
    );
    assert.deepEqual(
      moved.score.notes.map((note) => note.dur),
      [1, 1],
    );
    assert.deepEqual(
      moved.score.notes.map((note) => note.lyric?.text),
      ["Ah", "Ah"],
    );
  });

  it("keeps a bare extender on the tied fragment that carries it", () => {
    const textless = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><syllabic>single</syllabic><text>Ah</text></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend/></lyric></note>
      </measure></part></score-partwise>`;
    const imported = musicXmlToScore(textless, "空延");
    assert.equal(imported.score.notes.length, 1);
    assert.equal(imported.score.notes[0].dur, 2);
    assert.equal(imported.score.notes[0].pitches[0], 60);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extend, undefined);
    assert.equal(imported.score.notes[0].lyric?.extendType, undefined);
    assert.equal(imported.score.notes[0].lyric?.extendEnd, undefined);
    assert.equal(imported.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(imported.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(imported.score.notes[0].lyric?.extendEndDur, 1);
    const out = scoreToMusicXml(imported.score);
    assert.equal(out.match(/<note>/g)?.length, 2);
    assert.match(out, /<text>Ah<\/text>/);
    assert.match(out, /<extend\/>/);
    assert.doesNotMatch(out, /extend type=/);
    const ah = out.slice(out.indexOf("<text>Ah</text>"), out.indexOf("<extend/>"));
    assert.doesNotMatch(ah, /<extend/);
    const back = musicXmlToScore(out, "空延");
    assert.equal(back.score.notes.length, 1);
    assert.equal(back.score.notes[0].dur, 2);
    assert.equal(back.score.notes[0].lyric?.text, "Ah");
    assert.equal(back.score.notes[0].lyric?.extend, undefined);
    assert.equal(back.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(back.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(back.score.notes[0].lyric?.extendEndDur, 1);
    assert.equal(back.score.notes[0].lyric?.extendType, undefined);

    const repeated = textless.replace(
      "<lyric number=\"1\"><extend/></lyric>",
      "<lyric number=\"1\"><text>Ah</text><extend/></lyric>",
    );
    const duplicate = musicXmlToScore(repeated, "重复延");
    assert.equal(duplicate.score.notes.length, 1);
    assert.equal(duplicate.score.notes[0].dur, 2);
    assert.equal(duplicate.score.notes[0].lyric?.text, "Ah");
    assert.equal(duplicate.score.notes[0].lyric?.extend, undefined);
    assert.equal(duplicate.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(duplicate.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(duplicate.score.notes[0].lyric?.extendEndDur, 1);
    const dupOut = scoreToMusicXml(duplicate.score);
    assert.doesNotMatch(dupOut, /extend type=/);
    assert.match(dupOut, /<extend\/>/);
    const dupBack = musicXmlToScore(dupOut, "重复延");
    assert.equal(dupBack.score.notes[0].lyric?.text, "Ah");
    assert.equal(dupBack.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(dupBack.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(dupBack.score.notes[0].lyric?.extendEndDur, 1);
    assert.equal(dupBack.score.notes[0].lyric?.extend, undefined);

    const headless = textless.replace(
      "<lyric number=\"1\"><syllabic>single</syllabic><text>Ah</text></lyric>",
      "",
    );
    const open = musicXmlToScore(headless, "无头延");
    assert.equal(open.score.notes[0].dur, 2);
    assert.equal(open.score.notes[0].lyric?.text, "");
    assert.equal(open.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(open.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(open.score.notes[0].lyric?.extendEndDur, 1);
    const headOut = scoreToMusicXml(open.score);
    assert.match(headOut, /<extend\/>/);
    assert.doesNotMatch(headOut, /<text>/);
    const headBack = musicXmlToScore(headOut, "无头延");
    assert.equal(headBack.score.notes[0].lyric?.extendEndBare, true);
    assert.equal(headBack.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(headBack.score.notes[0].lyric?.text, "");

    const held = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend/></lyric></note>
      </measure></part></score-partwise>`;
    const apart = musicXmlToScore(held, "分开延");
    assert.equal(apart.score.notes.length, 2);
    assert.equal(apart.score.notes[0].lyric?.text, "Ah");
    assert.equal(apart.score.notes[0].lyric?.extend, undefined);
    assert.equal(apart.score.notes[1].dur, 1);
    assert.equal(apart.score.notes[1].dynamic, "f");
    assert.equal(apart.score.notes[1].lyric?.text, "");
    assert.equal(apart.score.notes[1].lyric?.extend, true);
    assert.equal(apart.score.notes[1].lyric?.extendType, undefined);
    assert.equal(apart.score.notes[1].lyric?.extendEndBare, undefined);
  });

  it("keeps every extender on a tied chain", () => {
    const chain = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend/></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const mixed = musicXmlToScore(chain, "停后又延");
    assert.equal(mixed.score.notes[0].dur, 3);
    assert.equal(mixed.score.notes[0].lyric?.text, "Ah");
    assert.equal(mixed.score.notes[0].lyric?.extendType, "start");
    assert.equal(mixed.score.notes[0].lyric?.extendEnd, undefined);
    assert.deepEqual(mixed.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
      { at: 2, dur: 1 },
    ]);
    const pitchNotes = (xml: string) =>
      [...xml.matchAll(/<note>[\s\S]*?<\/note>/g)]
        .map((match) => match[0])
        .filter((note) => note.includes("<pitch>"));
    const mixedNotes = pitchNotes(scoreToMusicXml(mixed.score));
    assert.equal(mixedNotes.length, 3);
    assert.match(mixedNotes[0], /<text>Ah<\/text>[\s\S]*<extend type="start"\/>/);
    assert.match(mixedNotes[1], /<extend type="stop"\/>/);
    assert.doesNotMatch(mixedNotes[1], /Ah/);
    assert.match(mixedNotes[2], /<extend\/>/);
    assert.doesNotMatch(mixedNotes[2], /extend type=/);
    assert.doesNotMatch(mixedNotes[2], /Ah/);
    const mixedBack = musicXmlToScore(scoreToMusicXml(mixed.score), "停后又延");
    assert.equal(mixedBack.score.notes[0].dur, 3);
    assert.equal(mixedBack.score.notes[0].lyric?.extendType, "start");
    assert.deepEqual(mixedBack.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
      { at: 2, dur: 1 },
    ]);
    assert.deepEqual(cleanLyric(mixedBack.score.notes[0].lyric)?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
      { at: 2, dur: 1 },
    ]);
    assert.equal(cleanLyric(mixedBack.score.notes[0].lyric)?.extendEnd, undefined);

    const bares = chain
      .replace("<text>Ah</text><extend type=\"start\"/>", "<text>Ah</text>")
      .replace("<extend type=\"stop\"/>", "<extend/>");
    const repeated = musicXmlToScore(bares, "两截空延");
    assert.equal(repeated.score.notes[0].dur, 3);
    assert.equal(repeated.score.notes[0].lyric?.text, "Ah");
    assert.equal(repeated.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(repeated.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1 },
      { at: 2, dur: 1 },
    ]);
    const bareOut = scoreToMusicXml(repeated.score);
    const bareNotes = pitchNotes(bareOut);
    assert.equal(bareNotes.length, 3);
    assert.match(bareNotes[0], /<text>Ah<\/text>/);
    assert.doesNotMatch(bareNotes[0], /<extend/);
    assert.match(bareNotes[1], /<extend\/>/);
    assert.match(bareNotes[2], /<extend\/>/);
    assert.doesNotMatch(bareOut, /extend type=/);
    assert.deepEqual(musicXmlToScore(bareOut, "两截空延").score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1 },
      { at: 2, dur: 1 },
    ]);

    const typed = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="continue"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="continue"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
      </measure></part></score-partwise>`;
    const longs = musicXmlToScore(typed, "四截");
    assert.equal(longs.score.notes[0].dur, 4);
    assert.deepEqual(longs.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "continue" },
      { at: 2, dur: 1, extendType: "continue" },
      { at: 3, dur: 1, extendType: "stop" },
    ]);
    const longNotes = pitchNotes(scoreToMusicXml(longs.score));
    assert.equal(longNotes.length, 4);
    assert.match(longNotes[0], /<extend type="start"\/>/);
    assert.match(longNotes[1], /<extend type="continue"\/>/);
    assert.match(longNotes[2], /<extend type="continue"\/>/);
    assert.match(longNotes[3], /<extend type="stop"\/>/);
    const longBack = musicXmlToScore(scoreToMusicXml(longs.score), "四截");
    assert.equal(longBack.score.notes[0].dur, 4);
    assert.deepEqual(longBack.score.notes[0].lyric?.fragments, longs.score.notes[0].lyric?.fragments);

    const heldApart = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend/></lyric></note>
        <note><rest/><duration>1</duration></note>
      </measure></part></score-partwise>`;
    const split = musicXmlToScore(heldApart, "力度切开");
    assert.equal(split.score.notes[0].dur, 2);
    assert.equal(split.score.notes[0].lyric?.extendType, "start");
    assert.deepEqual(split.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);
    assert.equal(split.score.notes[1].dur, 1);
    assert.equal(split.score.notes[1].dynamic, "f");
    assert.equal(split.score.notes[1].lyric?.text, "");
    assert.equal(split.score.notes[1].lyric?.extend, true);
    assert.equal(split.score.notes[1].lyric?.extendType, undefined);
    assert.equal(split.score.notes[1].lyric?.fragments, undefined);

    const moved = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><text>Ah</text><extend type="start"/></lyric></note>
        <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend/></lyric></note>
      </measure></part></score-partwise>`;
    const joined = musicXmlToScore(moved, "停后并");
    assert.equal(joined.score.notes[0].dur, 1);
    assert.equal(joined.score.notes[0].lyric?.text, "Ah");
    assert.equal(joined.score.notes[0].lyric?.extendType, "start");
    assert.equal(joined.score.notes[1].dur, 2);
    assert.equal(joined.score.notes[1].dynamic, "f");
    assert.equal(joined.score.notes[1].lyric?.text, "");
    assert.equal(joined.score.notes[1].lyric?.extendType, "stop");
    assert.deepEqual(joined.score.notes[1].lyric?.fragments, [{ at: 1, dur: 1 }]);
    const joinedNotes = pitchNotes(scoreToMusicXml(joined.score));
    assert.equal(joinedNotes.length, 3);
    assert.match(joinedNotes[1], /<extend type="stop"\/>/);
    assert.match(joinedNotes[2], /<extend\/>/);
    assert.equal(joinedNotes[2].includes("extend type="), false);
    const joinedBack = musicXmlToScore(scoreToMusicXml(joined.score), "停后并");
    assert.equal(joinedBack.score.notes[1].lyric?.extendType, "stop");
    assert.deepEqual(joinedBack.score.notes[1].lyric?.fragments, [{ at: 1, dur: 1 }]);
    assert.equal(joinedBack.score.notes[1].dynamic, "f");

    const headless = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend/></lyric></note>
      </measure></part></score-partwise>`;
    const open = musicXmlToScore(headless, "无头链");
    assert.equal(open.score.notes[0].dur, 3);
    assert.equal(open.score.notes[0].lyric?.text, "");
    assert.equal(open.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(open.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
      { at: 2, dur: 1 },
    ]);
    const headNotes = pitchNotes(scoreToMusicXml(open.score));
    assert.equal(headNotes.length, 3);
    assert.doesNotMatch(headNotes[0], /<lyric/);
    assert.match(headNotes[1], /<extend type="stop"\/>/);
    assert.match(headNotes[2], /<extend\/>/);
    assert.deepEqual(
      musicXmlToScore(scoreToMusicXml(open.score), "无头链").score.notes[0].lyric?.fragments,
      open.score.notes[0].lyric?.fragments,
    );
  });

  it("keeps an opening bare extender when a later typed mark is joined", () => {
    const textless = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><extend/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><extend type="stop"/></lyric></note>
      </measure></part></score-partwise>`;
    const openBare = musicXmlToScore(textless, "空头延");
    assert.equal(openBare.score.notes.length, 1);
    assert.equal(openBare.score.notes[0].dur, 2);
    assert.equal(openBare.score.notes[0].lyric?.text, "");
    assert.equal(openBare.score.notes[0].lyric?.extend, true);
    assert.equal(openBare.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(openBare.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);
    const openOut = scoreToMusicXml(openBare.score);
    const openNotes = [...openOut.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.equal(openNotes.length, 2);
    assert.match(openNotes[0], /<extend\/>/);
    assert.doesNotMatch(openNotes[0], /extend type=/);
    assert.doesNotMatch(openNotes[0], /<text>/);
    assert.match(openNotes[1], /<extend type="stop"\/>/);
    const openBack = musicXmlToScore(openOut, "空头延");
    assert.equal(openBack.score.notes[0].lyric?.text, "");
    assert.equal(openBack.score.notes[0].lyric?.extend, true);
    assert.equal(openBack.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(openBack.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);

    const withWord = textless.replace(
      "<lyric number=\"1\"><extend/></lyric>",
      "<lyric number=\"1\"><text>Ah</text><extend/></lyric>",
    );
    const word = musicXmlToScore(withWord, "字头延");
    assert.equal(word.score.notes[0].dur, 2);
    assert.equal(word.score.notes[0].lyric?.text, "Ah");
    assert.equal(word.score.notes[0].lyric?.extend, true);
    assert.equal(word.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(word.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);
    const wordOut = scoreToMusicXml(word.score);
    const wordNotes = [...wordOut.matchAll(/<note>[\s\S]*?<\/note>/g)]
      .map((match) => match[0])
      .filter((note) => note.includes("<pitch>"));
    assert.match(wordNotes[0], /<text>Ah<\/text>[\s\S]*<extend\/>/);
    assert.doesNotMatch(wordNotes[0], /extend type=/);
    assert.match(wordNotes[1], /<extend type="stop"\/>/);
    const wordBack = musicXmlToScore(wordOut, "字头延");
    assert.equal(wordBack.score.notes[0].lyric?.text, "Ah");
    assert.equal(wordBack.score.notes[0].lyric?.extend, true);
    assert.equal(wordBack.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(wordBack.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);
  });

  it("treats an empty fragment list as clearing the old continuation slot", () => {
    const stale = {
      text: "Ah",
      syllabic: "single" as const,
      fragments: [] as [],
      extendEnd: "stop" as const,
      extendEndAt: 1,
      extendEndDur: 1,
    };
    const cleared = cleanLyric(stale);
    assert.deepEqual(cleared?.fragments, []);
    assert.equal(cleared?.extendEnd, undefined);
    assert.equal(cleared?.extendEndAt, undefined);
    assert.equal(cleared?.extendEndDur, undefined);
    assert.equal(cleared?.extendEndBare, undefined);
    assert.equal(cleared?.extend, undefined);
    assert.deepEqual(cleanLyric(cleared), cleared);

    const invalid = cleanLyric({
      text: "Ah",
      syllabic: "single",
      fragments: [{ at: "no", dur: 1 }],
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.deepEqual(invalid?.fragments, []);
    assert.equal(invalid?.extendEnd, undefined);
    assert.equal(invalid?.extend, undefined);
    assert.deepEqual(cleanLyric(invalid), invalid);

    const migrated = cleanLyric({
      text: "Ah",
      syllabic: "single",
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.deepEqual(migrated?.fragments, [{ at: 1, dur: 1, extendType: "stop" }]);
    assert.equal(migrated?.extendEnd, "stop");
    assert.equal(migrated?.extendEndAt, 1);
    assert.equal(migrated?.extend, undefined);

    const xml = scoreToMusicXml(asScore([n(60, 2, { lyric: cleared })]));
    assert.doesNotMatch(xml, /<extend/);
    const back = musicXmlToScore(xml, "空表");
    assert.equal(back.score.notes[0].lyric?.text, "Ah");
    assert.equal(back.score.notes[0].lyric?.extend, undefined);
    assert.equal(back.score.notes[0].lyric?.extendEnd, undefined);
    assert.equal(back.score.notes[0].lyric?.fragments, undefined);
  });

  it("does not invent an opening extender from a legacy continuation", () => {
    const pitchNotes = (xml: string) =>
      [...xml.matchAll(/<note>[\s\S]*?<\/note>/g)]
        .map((match) => match[0])
        .filter((note) => note.includes("<pitch>"));
    const legacy = cleanLyric({
      text: "Ah",
      syllabic: "single",
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.equal(legacy?.extend, undefined);
    assert.equal(legacy?.extendType, undefined);
    assert.deepEqual(legacy?.fragments, [{ at: 1, dur: 1, extendType: "stop" }]);
    assert.deepEqual(cleanLyric(legacy), legacy);
    const notes = pitchNotes(scoreToMusicXml(asScore([n(60, 2, { lyric: legacy })])));
    assert.equal(notes.length, 2);
    assert.match(notes[0], /<text>Ah<\/text>/);
    assert.doesNotMatch(notes[0], /<extend/);
    assert.match(notes[1], /<extend type="stop"\/>/);
    assert.doesNotMatch(notes[1], /Ah/);

    const blank = cleanLyric({
      text: "",
      syllabic: "single",
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.equal(blank?.text, "");
    assert.equal(blank?.extend, undefined);
    assert.equal(blank?.extendType, undefined);
    assert.deepEqual(blank?.fragments, [{ at: 1, dur: 1, extendType: "stop" }]);
    assert.deepEqual(cleanLyric(blank), blank);
    const blankNotes = pitchNotes(scoreToMusicXml(asScore([n(60, 2, { lyric: blank })])));
    assert.equal(blankNotes.length, 2);
    assert.doesNotMatch(blankNotes[0], /<lyric/);
    assert.doesNotMatch(blankNotes[0], /<extend/);
    assert.match(blankNotes[1], /<extend type="stop"\/>/);

    const bare = cleanLyric({
      text: "Ah",
      syllabic: "single",
      extend: true,
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.equal(bare?.extend, true);
    assert.equal(bare?.extendType, undefined);
    const bareNotes = pitchNotes(scoreToMusicXml(asScore([n(60, 2, { lyric: bare })])));
    assert.match(bareNotes[0], /<text>Ah<\/text>[\s\S]*<extend\/>/);
    assert.doesNotMatch(bareNotes[0], /extend type=/);
    assert.match(bareNotes[1], /<extend type="stop"\/>/);

    const started = cleanLyric({
      text: "Ah",
      syllabic: "single",
      extend: true,
      extendType: "start",
      extendEnd: "stop",
      extendEndAt: 1,
      extendEndDur: 1,
    });
    assert.equal(started?.extendType, "start");
    const startNotes = pitchNotes(scoreToMusicXml(asScore([n(60, 2, { lyric: started })])));
    assert.match(startNotes[0], /<text>Ah<\/text>[\s\S]*<extend type="start"\/>/);
    assert.match(startNotes[1], /<extend type="stop"\/>/);
  });

  it("keeps a headless continuation's marker on its own fragment", () => {
    const pitchNotes = (xml: string) =>
      [...xml.matchAll(/<note>[\s\S]*?<\/note>/g)]
        .map((match) => match[0])
        .filter((note) => note.includes("<pitch>"));
    const file = (mark: string) => `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text>${mark}</lyric></note>
      </measure></part></score-partwise>`;
    const expectTail = (
      source: string,
      fragment: { at: number; dur: number; extendType?: "stop" | "continue" },
      tail: RegExp,
    ) => {
      const imported = musicXmlToScore(source, "后字");
      assert.equal(imported.score.notes.length, 1);
      assert.equal(imported.score.notes[0].dur, 2);
      assert.equal(imported.score.notes[0].lyric?.text, "Ah");
      assert.equal(imported.score.notes[0].lyric?.extend, undefined);
      assert.equal(imported.score.notes[0].lyric?.extendType, undefined);
      assert.deepEqual(imported.score.notes[0].lyric?.fragments, [fragment]);
      const cleaned = cleanLyric(imported.score.notes[0].lyric);
      assert.equal(cleaned?.extend, undefined);
      assert.equal(cleaned?.extendType, undefined);
      assert.deepEqual(cleaned?.fragments, [fragment]);
      assert.deepEqual(cleanLyric(cleaned), cleaned);
      const written = scoreToMusicXml(asScore([n(60, 2, { lyric: cleaned })]));
      const notes = pitchNotes(written);
      assert.equal(notes.length, 2);
      assert.match(notes[0], /<text>Ah<\/text>/);
      assert.doesNotMatch(notes[0], /<extend/);
      assert.match(notes[1], tail);
      assert.doesNotMatch(notes[1], /Ah/);
      const back = musicXmlToScore(written, "后字");
      assert.equal(back.score.notes[0].lyric?.text, "Ah");
      assert.equal(back.score.notes[0].lyric?.extend, undefined);
      assert.equal(back.score.notes[0].lyric?.extendType, undefined);
      assert.deepEqual(back.score.notes[0].lyric?.fragments, [fragment]);
    };
    expectTail(file("<extend type=\"stop\"/>"), { at: 1, dur: 1, extendType: "stop" }, /<extend type="stop"\/>/);
    expectTail(file("<extend/>"), { at: 1, dur: 1 }, /<extend\/>/);
    expectTail(
      file("<extend type=\"continue\"/>"),
      { at: 1, dur: 1, extendType: "continue" },
      /<extend type="continue"\/>/,
    );
  });

  it("keeps the first word when an earlier fragment was only a marker", () => {
    const pitchNotes = (xml: string) =>
      [...xml.matchAll(/<note>[\s\S]*?<\/note>/g)]
        .map((match) => match[0])
        .filter((note) => note.includes("<pitch>"));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/><tie type="start"/>
          <lyric number="1"><extend type="continue"/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend type="stop"/></lyric></note>
      </measure></part></score-partwise>`;
    const imported = musicXmlToScore(xml, "先记号");
    assert.equal(imported.score.notes.length, 1);
    assert.equal(imported.score.notes[0].dur, 3);
    assert.equal(imported.score.notes[0].lyric?.text, "Ah");
    assert.equal(imported.score.notes[0].lyric?.extend, undefined);
    assert.equal(imported.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(imported.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "continue" },
      { at: 2, dur: 1, extendType: "stop" },
    ]);
    assert.doesNotMatch(imported.notice, /连音后面/);
    const cleaned = cleanLyric(imported.score.notes[0].lyric);
    assert.equal(cleaned?.text, "Ah");
    assert.equal(cleaned?.extend, undefined);
    assert.deepEqual(cleaned?.fragments, imported.score.notes[0].lyric?.fragments);
    assert.deepEqual(cleanLyric(cleaned), cleaned);
    const written = scoreToMusicXml(asScore([{ pitches: [60], dur: 3, lyric: cleaned }], { beats: 3 }));
    const notes = pitchNotes(written);
    assert.equal(notes.length, 3);
    assert.match(notes[0], /<text>Ah<\/text>/);
    assert.doesNotMatch(notes[0], /<extend/);
    assert.match(notes[1], /<extend type="continue"\/>/);
    assert.doesNotMatch(notes[1], /Ah/);
    assert.match(notes[2], /<extend type="stop"\/>/);
    assert.doesNotMatch(notes[2], /Ah/);
    const back = musicXmlToScore(written, "先记号");
    assert.equal(back.score.notes[0].dur, 3);
    assert.equal(back.score.notes[0].lyric?.text, "Ah");
    assert.equal(back.score.notes[0].lyric?.extend, undefined);
    assert.equal(back.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(back.score.notes[0].lyric?.fragments, cleaned?.fragments);

    const bareHead = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="start"/>
          <lyric number="1"><extend/></lyric></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
          <tie type="stop"/>
          <lyric number="1"><text>Ah</text><extend type="stop"/></lyric></note>
      </measure></part></score-partwise>`;
    const headed = musicXmlToScore(bareHead, "空头后字");
    assert.equal(headed.score.notes[0].lyric?.text, "Ah");
    assert.equal(headed.score.notes[0].lyric?.extend, true);
    assert.equal(headed.score.notes[0].lyric?.extendType, undefined);
    assert.deepEqual(headed.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "stop" },
    ]);

    const wordOnly = xml.replace(
      "<lyric number=\"1\"><text>Ah</text><extend type=\"stop\"/></lyric>",
      "<lyric number=\"1\"><text>Ah</text></lyric>",
    );
    const word = musicXmlToScore(wordOnly, "后字无记号");
    assert.equal(word.score.notes[0].lyric?.text, "Ah");
    assert.equal(word.score.notes[0].lyric?.extend, undefined);
    assert.deepEqual(word.score.notes[0].lyric?.fragments, [
      { at: 1, dur: 1, extendType: "continue" },
    ]);
    assert.doesNotMatch(word.notice, /连音后面/);
  });

  it("does not copy a lyric onto the second half of a tie", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>4</duration>
              <tie type="start"/>
              <lyric number="1"><text>长</text></lyric>
            </note>
          </measure>
          <measure number="2">
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
              <lyric number="1"><text>又</text></lyric>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "连");
    assert.equal(imported.score.notes.length, 1);
    assert.equal(imported.score.notes[0].dur, 5);
    assert.equal(imported.score.notes[0].lyric?.text, "长");
    assert.match(imported.notice, /连音后面/);
  });
});

describe("lyric export limits", () => {
  it("leaves jianpu and MIDI free of lyric text", () => {
    const notes = [n(60, 1, { lyric: syllable("小") }), n(62, 1, { lyric: syllable("star") })];
    const withLyrics = asScore(notes);
    const bare = asScore([n(60), n(62)]);
    assert.equal(formatJianpu(withLyrics), formatJianpu(bare));
    assert.deepEqual(scoreToMidi(withLyrics), scoreToMidi(bare));
    assert.equal(formatJianpu(withLyrics).includes("小"), false);
  });
});

describe("abc lyric slots", () => {
  it("writes an underscore for a tie skip and each following hold", () => {
    const atoms: LyricAtom[] = [
      { kind: "syllable", lyric: { text: "Ah", syllabic: "single", extend: true } },
      { kind: "skip" },
      { kind: "hold" },
      { kind: "syllable", lyric: { text: "Go", syllabic: "begin" } },
      { kind: "syllable", lyric: { text: "ing", syllabic: "end" } },
    ];
    assert.equal(formatAbcLyrics(atoms), "w: Ah_ _ Go- ing");
    assert.equal(formatAbcLyrics([{ kind: "skip" }, { kind: "skip" }]), null);
  });
});

before(() => {
  assert.equal(typeof document, "object");
});

 it("explains an unsegmented English word on 42 sounding notes without losing text", () => {
   const notes: ScoreNote[] = Array.from({ length: 42 }, () => ({ pitches: [60], dur: 1 }));
   const result = assignLyrics(notes, "Twinkletwinklelittlestar");
   assert.equal(result.notes[0].lyric?.text, "Twinkletwinklelittlestar");
   assert.match(result.notice!, /后面还有 41 个音没有歌词/);
   assert.match(result.notice!, /英文请用空格分词/);
   assert.match(result.notice!, /Hel-lo \/ Twin-kle/);
   assert.deepEqual(parseLyricLine("Twin-kle twin-kle lit-tle star").slots.map(x => x.text),
     ["Twin", "kle", "twin", "kle", "lit", "tle", "star"]);
 });

describe("lyric fill against Dolce 123 §5", () => {
  const notes = (...pitches: number[]) => pitches.map((p) => (p < 0 ? { pitches: [], dur: 1 } : { pitches: [p], dur: 1 }));
  const texts = (list: { lyric?: { text: string } }[]) => list.map((note) => note.lyric?.text ?? null);
  const fourFour = (at: number) => (Math.floor(at / 4) + 1) * 4;

  it("skips rests, keeps / as a Shift-free skip and {} as several characters on one note", () => {
    const result = assignLyrics(notes(60, -1, 62, 64, 65, 67), "一/{二三}四五");
    assert.deepEqual(texts(result.notes), ["一", null, "", "二三", "四", "五"]);
    const back = parseLyricLine(formatLyricLine(result.notes));
    assert.deepEqual(back.slots.map((slot) => slot.text), ["一", "", "二三", "四", "五"]);
  });

  it("punctuation takes no note; 、 from an IME is flagged", () => {
    const parsed = parseLyricLine("主，祢。“爱”、我");
    assert.deepEqual(parsed.slots.map((slot) => slot.text), ["主", "祢", "爱", "我"]);
    assert.ok(parsed.notices.some((n) => n.includes("、")));
  });

  it("| jumps to the first note of the next bar when a bar function is given", () => {
    const line = notes(60, 62, 64, 65, 67, 69, 71, 72);
    const jumped = assignLyrics(line, "一二|三四五六", fourFour);
    assert.deepEqual(texts(jumped.notes), ["一", "二", null, null, "三", "四", "五", "六"]);
    assert.match(jumped.notice ?? "", /跳到下一小节 1 次/);
    // Without bar information `|` is only a separator.
    assert.deepEqual(texts(assignLyrics(line, "一二|三四", undefined).notes).slice(0, 4), ["一", "二", "三", "四"]);
    // A bar mark right on the barline does not skip anything.
    assert.deepEqual(texts(assignLyrics(line, "一二三四|五", fourFour).notes)[4], "五");
  });

  it("an extension (one long note) or a hold takes exactly one syllable", () => {
    const line = [{ pitches: [60], dur: 3 }, { pitches: [62], dur: 1 }, { pitches: [64], dur: 1 }];
    const result = assignLyrics(line, "长_短");
    assert.deepEqual(result.notes.map((n) => [n.lyric?.text ?? null, n.lyric?.extend === true]), [["长", true], ["", true], ["短", false]]);
  });
});
