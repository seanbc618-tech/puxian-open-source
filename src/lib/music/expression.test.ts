import assert from "node:assert/strict";
import { describe, it } from "node:test";
import abcjs from "abcjs";
import { arrangeScore } from "./arrange.ts";
import {
  ACCENT_GAIN,
  DYNAMIC_GAIN,
  GATE,
  applyMark,
  cleanNote,
  noteGains,
  retainMarks,
  soundingEvents,
} from "./expression.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { scoreToMidi } from "./midi.ts";
import { engraveAbc, noteIndexAt, toAbc } from "./notation.ts";
import { transposeScore, type Score, type ScoreNote } from "./theory.ts";

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

function n(midi: number, dur = 1, extra: Partial<ScoreNote> = {}): ScoreNote {
  return { pitches: midi < 0 ? [] : [midi], dur, ...extra };
}

type Parsed = {
  index: number | null;
  decorations: string[];
  slur: boolean;
  slurEnd: boolean;
  grace: string | null;
  warnings: string[];
};

type ParsedElem = {
  el_type?: string;
  startChar?: number;
  endChar?: number;
  decoration?: string[];
  startSlur?: unknown;
  endSlur?: unknown;
  gracenotes?: Array<{ acciaccatura?: boolean; name?: string }>;
  pitches?: Array<{ startSlur?: unknown; endSlur?: unknown }>;
};

function parsedNotes(abc: string, hits: { index: number; start: number; end: number }[]): Parsed[] {
  const tune = abcjs.parseOnly(abc)[0] as {
    warnings?: Array<{ message?: string } | string>;
    lines?: Array<{ staff?: Array<{ voices?: ParsedElem[][] }> }>;
  };
  const warnings = (tune.warnings ?? []).map((warning) =>
    String(typeof warning === "string" ? warning : (warning.message ?? warning)).replace(
      /<[^>]+>/g,
      "",
    ),
  );
  const notes: Parsed[] = [];
  for (const line of tune.lines ?? []) {
    for (const staff of line.staff ?? []) {
      for (const voice of staff.voices ?? []) {
        for (const elem of voice) {
          if (elem.el_type !== "note") continue;
          const start = elem.startChar ?? 0;
          const end = elem.endChar ?? start;
          notes.push({
            index: noteIndexAt(hits, start, end),
            decorations: elem.decoration ?? [],
            slur: Boolean(elem.startSlur || elem.pitches?.[0]?.startSlur),
            slurEnd: Boolean(elem.endSlur || elem.pitches?.[0]?.endSlur),
            grace: elem.gracenotes?.[0]?.acciaccatura ? (elem.gracenotes[0].name ?? null) : null,
            warnings,
          });
        }
      }
    }
  }
  return notes;
}

describe("expression marks", () => {
  it("toggles a dynamic on the first selected note and lets it carry forward", () => {
    const notes = [n(60), n(62), n(64)];
    const marked = applyMark(notes, [1, 2], { type: "dynamic", value: "p" });
    assert.equal(marked[0].dynamic, undefined);
    assert.equal(marked[1].dynamic, "p");
    assert.equal(marked[2].dynamic, undefined);
    const again = applyMark(marked, [1], { type: "dynamic", value: "p" });
    assert.equal(again[1].dynamic, undefined);

    const gains = noteGains(asScore(marked));
    assert.equal(gains[0], 1);
    assert.equal(gains[1], DYNAMIC_GAIN.p);
    assert.equal(gains[2], DYNAMIC_GAIN.p);
    assert.ok(DYNAMIC_GAIN.p < DYNAMIC_GAIN.mp && DYNAMIC_GAIN.mp < DYNAMIC_GAIN.mf);
    assert.ok(DYNAMIC_GAIN.mf < DYNAMIC_GAIN.f);
  });

  it("shortens staccato, holds tenuto, and keeps the next note on the beat", () => {
    const notes = applyMark([n(60), n(62), n(64)], [0], {
      type: "articulation",
      value: "staccato",
    });
    const held = applyMark(notes, [1], { type: "articulation", value: "tenuto" });
    const events = soundingEvents(asScore(held));
    assert.equal(events[0].dur, GATE.staccato);
    assert.equal(events[0].start, 0);
    assert.equal(events[1].dur, GATE.tenuto);
    assert.equal(events[1].start, 1);
    assert.equal(events[2].start, 2);
    assert.equal(events[2].dur, GATE.normal);
    const off = applyMark(held, [0], { type: "articulation", value: "staccato" });
    assert.equal(off[0].articulations, undefined);
  });

  it("boosts an accent without changing when the note speaks", () => {
    const notes = applyMark([n(60)], [0], { type: "articulation", value: "accent" });
    const [event] = soundingEvents(asScore(notes));
    assert.equal(event.gain, ACCENT_GAIN);
    assert.equal(event.attack, "accent");
    assert.equal(event.start, 0);
    assert.equal(event.dur, GATE.normal);
  });

  it("draws a slur between sounding notes and plays them more legato", () => {
    const notes = applyMark([n(60), n(-1), n(64), n(65)], [0, 1, 2], { type: "slur" });
    assert.equal(notes[0].slurStart, true);
    assert.equal(notes[2].slurEnd, true);
    assert.equal(notes[1].slurStart, undefined);
    const events = soundingEvents(asScore(notes));
    assert.equal(events[0].dur, GATE.slur);
    assert.equal(events[0].attack, "legato");
    assert.equal(events[1].start, 2);
    assert.equal(events[1].dur, GATE.slur);
    const removed = applyMark(notes, [0, 1, 2], { type: "slur" });
    assert.equal(removed[0].slurStart, undefined);
    assert.equal(removed[2].slurEnd, undefined);
    const single = [n(60)];
    assert.equal(applyMark(single, [0], { type: "slur" }), single);
  });

  it("removes a slur when only one end is cleared", () => {
    const notes = applyMark([n(60), n(62), n(64)], [0, 1, 2], { type: "slur" });
    const cleared = applyMark(notes, [0], { type: "clear" });
    assert.equal(cleared[0].slurStart, undefined);
    assert.equal(cleared[2].slurEnd, undefined);
  });

  it("interpolates a hairpin and then keeps the arrived level", () => {
    const notes = applyMark([n(60), n(62), n(64), n(65)], [0, 1, 2], {
      type: "hairpin",
      value: "cresc",
    });
    assert.equal(notes[0].hairpin, "cresc");
    assert.equal(notes[2].hairpinEnd, true);
    const gains = noteGains(asScore(notes));
    assert.equal(gains[0], 1);
    assert.ok(gains[1] > gains[0] && gains[1] < DYNAMIC_GAIN.f);
    assert.equal(gains[2], DYNAMIC_GAIN.f);
    assert.equal(gains[3], DYNAMIC_GAIN.f);
    const dim = applyMark(notes, [0, 1, 2], { type: "hairpin", value: "dim" });
    assert.equal(dim[0].hairpin, "dim");
    assert.equal(noteGains(asScore(dim))[2], DYNAMIC_GAIN.p);
  });

  it("reaches a hairpin's target at the start of a note tied across a bar", () => {
    const score = asScore([
      n(60, 1, { hairpin: "cresc" }),
      n(62, 5, { hairpinEnd: true }),
      n(64, 1),
    ]);
    const gains = noteGains(score);
    assert.equal(gains[0], 1);
    assert.equal(gains[1], DYNAMIC_GAIN.f);
    assert.equal(gains[2], DYNAMIC_GAIN.f);
    const engraved = engraveAbc(score);
    const fragments = engraved.hits.filter((hit) => hit.index === 1);
    assert.ok(fragments.length >= 2);
    const text = (hit: { start: number; end: number }) => engraved.abc.slice(hit.start, hit.end);
    assert.match(text(fragments[0]), /!<\)!/);
    assert.doesNotMatch(text(fragments[1]), /!<\)!/);
    assert.equal(engraved.abc.split("!<)!").length - 1, 1);
  });

  it("closes a second hairpin that starts where the first one ends", () => {
    const notes = [
      n(60, 1, { hairpin: "cresc" }),
      n(62, 1, { hairpinEnd: true, hairpin: "dim" }),
      n(64, 1, { hairpinEnd: true }),
    ];
    const gains = noteGains(asScore(notes));
    assert.equal(gains[0], 1);
    assert.equal(gains[1], DYNAMIC_GAIN.f);
    assert.equal(gains[2], DYNAMIC_GAIN.p);
    const engraved = engraveAbc(asScore(notes));
    const middle = engraved.hits.find((hit) => hit.index === 1);
    const last = engraved.hits.find((hit) => hit.index === 2);
    assert.ok(middle && last);
    const at = (hit: { start: number; end: number }) => engraved.abc.slice(hit.start, hit.end);
    assert.match(at(middle), /!<\)!/);
    assert.match(at(middle), /!>\(!/);
    assert.match(at(last), /!>\)!/);
    assert.equal(engraved.abc.split("!<)!").length - 1, 1);
    assert.equal(engraved.abc.split("!>)!").length - 1, 1);
  });

  it("trills to the upper neighbor and ends on the written note", () => {
    const notes = applyMark([n(60, 1), n(64)], [0], { type: "ornament", value: "trill" });
    const events = soundingEvents(asScore(notes));
    const trill = events.filter((event) => event.start < 1);
    assert.ok(trill.length >= 5);
    assert.equal(trill.length % 2, 1);
    assert.equal(trill[0].midi, 60);
    assert.equal(trill[1].midi, 62);
    assert.equal(trill[trill.length - 1].midi, 60);
    assert.equal(events.find((event) => event.midi === 64)?.start, 1);
  });

  it("puts an acciaccatura inside the written note", () => {
    const notes = applyMark([n(60), n(67)], [0], { type: "ornament", value: "grace" });
    const events = soundingEvents(asScore(notes));
    assert.equal(events[0].midi, 62);
    assert.equal(events[0].start, 0);
    assert.ok(events[0].dur < 0.2);
    assert.equal(events[1].midi, 60);
    assert.equal(events[1].start, events[0].dur);
    assert.equal(events[2].start, 1);
    assert.equal(events[2].midi, 67);
    const off = applyMark(notes, [0], { type: "ornament", value: "grace" });
    assert.equal(off[0].ornament, undefined);
  });

  it("plays an unslashed appoggiatura longer than a slashed grace and does not draw the slash", () => {
    const crushed = soundingEvents(asScore([n(60, 1, { ornament: "grace", gracePitch: 62 })]));
    const leaning = soundingEvents(
      asScore([n(60, 1, { ornament: "appoggiatura", gracePitch: 62 })]),
    );
    assert.ok(leaning[0].dur > crushed[0].dur);
    assert.equal(leaning[0].midi, 62);
    assert.equal(leaning[1].midi, 60);
    assert.equal(leaning[1].start, leaning[0].dur);
    assert.ok(leaning[0].dur + leaning[1].dur <= 1);
    const abc = toAbc(asScore([n(60, 1, { ornament: "appoggiatura", gracePitch: 64 })]));
    assert.match(abc, /\{E\}/);
    assert.doesNotMatch(abc, /\{\/E\}/);
  });

  it("keeps marks when the pitches transpose or the same text is parsed again", () => {
    const notes = applyMark([n(60), n(62)], [0, 1], { type: "slur" });
    notes[0].dynamic = "mf";
    const moved = transposeScore(asScore(notes), 2);
    assert.equal(moved.notes[0].dynamic, "mf");
    assert.equal(moved.notes[0].slurStart, true);
    assert.equal(moved.notes[0].pitches[0], 62);
    const same = retainMarks(notes, [
      { pitches: [60], dur: 1 },
      { pitches: [62], dur: 1 },
    ]);
    assert.equal(same[0].dynamic, "mf");
    assert.equal(same[1].slurEnd, true);
    const edited = retainMarks(notes, [
      { pitches: [60], dur: 1 },
      { pitches: [64], dur: 1 },
    ]);
    assert.equal(edited[0].dynamic, undefined);
  });

  it("drops unknown marks instead of engraving them", () => {
    const cleaned = cleanNote({
      pitches: [60],
      dur: 1,
      dynamic: "sfz" as "f",
      articulations: ["staccato", "marcato" as "accent"],
      ornament: "turn" as "trill",
      gracePitch: 4.2,
    });
    assert.equal(cleaned.dynamic, undefined);
    assert.deepEqual(cleaned.articulations, ["staccato"]);
    assert.equal(cleaned.ornament, undefined);
    assert.equal(cleaned.gracePitch, undefined);
  });

  it("engraves dynamics, articulations, slurs, trills, and grace notes", () => {
    const plain = toAbc(scoreFromExample(EXAMPLES[0]));
    assert.doesNotMatch(plain, /!|[()]|\{/);
    assert.equal(abcjs.parseOnly(plain)[0].warnings ?? null, null);

    const notes = [
      n(60, 1, { dynamic: "p", articulations: ["staccato", "accent"], slurStart: true }),
      n(62, 1, { ornament: "trill" }),
      n(64, 1, { slurEnd: true, ornament: "grace", hairpin: "cresc" }),
      n(65, 1, { hairpinEnd: true, dynamic: "f" }),
    ];
    const engraved = engraveAbc(asScore(notes));
    const parsed = parsedNotes(engraved.abc, engraved.hits);
    assert.deepEqual(
      parsed.map((note) => note.index),
      [0, 1, 2, 3],
    );
    assert.equal(parsed[0].warnings.length, 0);
    assert.ok(parsed[0].decorations.includes("p"));
    assert.ok(parsed[0].decorations.includes("staccato"));
    assert.ok(parsed[0].decorations.includes("accent"));
    assert.equal(parsed[0].slur, true);
    assert.ok(parsed[1].decorations.includes("trill"));
    assert.equal(parsed[2].grace, "F");
    assert.equal(parsed[2].slurEnd, true);
    assert.ok(parsed[2].decorations.includes("crescendo("));
    assert.ok(parsed[3].decorations.includes("crescendo)"));
    assert.ok(parsed[3].decorations.includes("f"));
  });

  it("prints a tied dynamic once, on the first fragment", () => {
    const engraved = engraveAbc(asScore([n(60, 5, { dynamic: "mf", articulations: ["tenuto"] })]));
    assert.equal(engraved.abc.split("!mf!").length - 1, 1);
    assert.equal(engraved.abc.split("!tenuto!").length - 1, 1);
    assert.deepEqual(
      engraved.hits.map((hit) => hit.index),
      [0, 0],
    );
    const parsed = parsedNotes(engraved.abc, engraved.hits);
    assert.ok(parsed.every((note) => note.index === 0));
    assert.equal(parsed.filter((note) => note.decorations.includes("mf")).length, 1);
  });

  it("writes the acciaccatura in the instrument's key", () => {
    const abc = toAbc(asScore([n(60, 1, { ornament: "grace" })]), 2);
    assert.match(abc, /^K:D$/m);
    assert.match(abc, /\{\/E\}D/);
  });

  it("puts dynamics into MIDI velocity and leaves the written length alone", () => {
    const quiet = asScore([n(60, 1, { dynamic: "p", articulations: ["staccato"] })]);
    const loud = asScore([n(60, 1, { dynamic: "f", articulations: ["accent"] })]);
    const plain = asScore([n(60)]);
    const velocity = (score: Score) =>
      scoreToMidi(score).find((byte, index, data) => data[index - 2] === 0x90);
    assert.equal(velocity(plain), 78);
    assert.ok((velocity(quiet) ?? 0) < 78);
    assert.ok((velocity(loud) ?? 127) > 78);
    assert.equal(
      scoreToMidi(quiet).filter(
        (byte, index, data) => data[index - 1] === 60 && data[index - 2] === 0x80,
      ).length,
      1,
    );
  });

  it("puts a dynamic on the whole chord and plays every pitch at that loudness", () => {
    const notes = applyMark([{ pitches: [60, 64, 67], dur: 1 }], [0], {
      type: "dynamic",
      value: "f",
    });
    assert.equal(notes[0].dynamic, "f");
    assert.deepEqual(notes[0].pitches, [60, 64, 67]);
    const events = soundingEvents(asScore(notes));
    assert.deepEqual(
      events.map((event) => event.midi),
      [60, 64, 67],
    );
    assert.ok(events.every((event) => event.note === 0 && event.gain === DYNAMIC_GAIN.f));
  });

  it("drops slurs when arrangement rewrites the line, and keeps a chord's dynamic", () => {
    const score = asScore([
      { pitches: [60, 64], dur: 1, dynamic: "f", slurStart: true },
      { pitches: [62], dur: 1, slurEnd: true },
    ]);
    const next = arrangeScore(score, "playful");
    assert.equal(next.notes[0].dynamic, "f");
    assert.equal(next.notes[0].slurStart, undefined);
    assert.ok(next.notes.every((note) => !note.slurStart && !note.slurEnd));
  });
});

describe("arpeggio ornament", () => {
  it("only stays on a chord, set or cleared from the mark bar", () => {
    const chord: ScoreNote = { pitches: [60, 64, 67], dur: 2 };
    const marked = applyMark([chord, n(62)], [0, 1], { type: "ornament", value: "arpeggio" });
    assert.equal(marked[0].ornament, "arpeggio");
    assert.equal(marked[1].ornament, undefined);
    assert.equal(cleanNote({ pitches: [60], dur: 1, ornament: "arpeggio" }).ornament, undefined);
    assert.equal(cleanNote({ pitches: [60, 64], dur: 1, ornament: "arpeggio" }).ornament, "arpeggio");
    const single = applyMark([n(60)], [0], { type: "ornament", value: "arpeggio" });
    assert.equal(single[0].ornament, undefined);
    const off = applyMark(marked, [0], { type: "ornament", value: "arpeggio" });
    assert.equal(off[0].ornament, undefined);
  });

  it("rolls the chord upward inside its length and releases together", () => {
    const events = soundingEvents(asScore([{ pitches: [67, 60, 64], dur: 2, ornament: "arpeggio" }]));
    assert.deepEqual(events.map((e) => e.midi), [60, 64, 67]);
    assert.equal(events[0].start, 0);
    assert.ok(events[1].start > 0 && events[2].start > events[1].start);
    assert.ok(events[2].start < 0.5);
    const ends = events.map((e) => e.start + e.dur);
    assert.ok(Math.max(...ends) - Math.min(...ends) < 1e-9);
    const plain = soundingEvents(asScore([{ pitches: [60, 64, 67], dur: 2 }]));
    assert.ok(plain.every((e) => e.start === 0));
  });

  it("engraves as an abc arpeggio decoration", () => {
    const abc = toAbc(asScore([{ pitches: [60, 64, 67], dur: 2, ornament: "arpeggio" }]));
    assert.match(abc, /!arpeggio!\[/);
    const tune = abcjs.parseOnly(abc)[0] as { warnings?: unknown[] };
    assert.equal(tune.warnings ?? null, null);
  });
});
