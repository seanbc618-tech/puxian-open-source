import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRANGE_LIMIT, ARRANGE_STYLES, arrangeScore, type ArrangeStyle } from "./arrange.ts";
import {
  formatJianpu,
  formatLetters,
  importJianpu,
  jianpuShareText,
  parseJianpu,
  parseLetters,
} from "./notation.ts";
import { midiToScore, scoreToMidi } from "./midi.ts";
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

function n(midi: number | number[], dur: number): ScoreNote {
  const pitches = Array.isArray(midi) ? midi : midi < 0 ? [] : [midi];
  return { pitches, dur };
}

function pitchesOf(notes: ScoreNote[]): Array<number | null> {
  return notes.map((note) => (note.pitches.length ? note.pitches[0] : null));
}

function sameNotes(a: ScoreNote[], b: ScoreNote[]) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.deepEqual(a[i].pitches, b[i].pitches, `pitch ${i}`);
    assert.ok(Math.abs(a[i].dur - b[i].dur) < 1e-9, `dur ${i}: ${a[i].dur} vs ${b[i].dur}`);
  }
}

function durationOf(notes: ScoreNote[]) {
  return notes.reduce((sum, note) => sum + note.dur, 0);
}

describe("arrange styles", () => {
  it("names the three beginner styles and states the harmony limit", () => {
    assert.deepEqual(
      ARRANGE_STYLES.map((style) => style.label),
      ["活泼", "俏皮", "抒情"],
    );
    assert.deepEqual(
      ARRANGE_STYLES.map((style) => style.id),
      ["lively", "playful", "lyrical"],
    );
    assert.match(ARRANGE_LIMIT, /不重新配和声/);
  });

  it("活泼 splits a stepwise quarter into the note plus an upper neighbor", () => {
    const score = asScore([n(60, 1), n(62, 1), n(64, 1), n(65, 1)]);
    const next = arrangeScore(score, "lively");
    assert.deepEqual(pitchesOf(next.notes), [60, 62, 62, 64, 64, 65, 65, 67]);
    assert.deepEqual(
      next.notes.map((note) => note.dur),
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    );
  });

  it("活泼 puts the scale tone between a third on the second eighth", () => {
    const score = asScore([n(60, 1), n(64, 1)]);
    const next = arrangeScore(score, "lively");
    assert.deepEqual(pitchesOf(next.notes), [60, 62, 64, 65]);
    assert.ok(next.notes.every((note) => note.dur === 0.5));
  });

  it("活泼 keeps the front of a long note and only fills the last beat", () => {
    const score = asScore([n(60, 2), n(64, 1)]);
    const next = arrangeScore(score, "lively");
    assert.deepEqual(pitchesOf(next.notes).slice(0, 3), [60, 60, 62]);
    assert.deepEqual(
      next.notes.slice(0, 3).map((note) => note.dur),
      [1, 0.5, 0.5],
    );
    assert.equal(durationOf(next.notes), 3);
  });

  it("活泼 uses the minor scale for the neighbor", () => {
    const score = asScore([n(62, 1)], { mode: "minor" });
    const next = arrangeScore(score, "lively");
    assert.deepEqual(pitchesOf(next.notes), [62, 63]);
  });

  it("俏皮 turns a downbeat quarter into an offbeat eighth", () => {
    const score = asScore([n(60, 1)]);
    const next = arrangeScore(score, "playful");
    assert.deepEqual(pitchesOf(next.notes), [null, 60]);
    assert.deepEqual(
      next.notes.map((note) => note.dur),
      [0.5, 0.5],
    );
  });

  it("俏皮 ornaments a weak-beat quarter with an upper neighbor", () => {
    const score = asScore([n(-1, 1), n(60, 1)]);
    const next = arrangeScore(score, "playful");
    assert.deepEqual(next.notes[0], n(-1, 1));
    assert.deepEqual(pitchesOf(next.notes.slice(1)), [62, 60]);
    assert.deepEqual(
      next.notes.slice(1).map((note) => note.dur),
      [0.5, 0.5],
    );
  });

  it("俏皮 leaves the tail of a long downbeat note in place", () => {
    const score = asScore([n(60, 2)]);
    const next = arrangeScore(score, "playful");
    assert.deepEqual(pitchesOf(next.notes), [null, 60, 60]);
    assert.deepEqual(
      next.notes.map((note) => note.dur),
      [0.5, 0.5, 1],
    );
  });

  it("俏皮 in 4/4 accents beats 1 and 3 of every bar", () => {
    const score = asScore([n(60, 1), n(62, 1), n(64, 1), n(65, 1), n(67, 1)]);
    const next = arrangeScore(score, "playful");
    assert.equal(durationOf(next.notes), durationOf(score.notes));
    assert.equal(next.beats, 4);
    assert.equal(next.beatUnit, 4);
    assert.deepEqual(pitchesOf(next.notes), [null, 60, 64, 62, null, 64, 67, 65, null, 67]);
  });

  it("俏皮 in 3/4 accents only each bar's downbeat across the barline", () => {
    const score = asScore([n(60, 1), n(62, 1), n(64, 1), n(65, 1), n(67, 1), n(69, 1)], {
      beats: 3,
      beatUnit: 4,
      bpm: 108,
    });
    const next = arrangeScore(score, "playful");
    assert.equal(next.key, "C");
    assert.equal(next.beats, 3);
    assert.equal(next.beatUnit, 4);
    assert.equal(next.bpm, 108);
    assert.equal(durationOf(next.notes), 6);
    assert.deepEqual(
      next.notes.map((note) => note.dur),
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    );
    assert.deepEqual(pitchesOf(next.notes), [null, 60, 64, 62, 65, 64, null, 65, 69, 67, 71, 69]);
  });

  it("俏皮 in 6/8 accents both groups of three in every bar", () => {
    const line = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
    const score = asScore(
      line.map((midi) => n(midi, 0.5)),
      { beats: 6, beatUnit: 8 },
    );
    const next = arrangeScore(score, "playful");
    assert.equal(next.beats, 6);
    assert.equal(next.beatUnit, 8);
    assert.equal(next.key, score.key);
    assert.equal(next.mode, score.mode);
    assert.equal(durationOf(next.notes), 6);
    assert.ok(next.notes.every((note) => note.dur === 0.25));
    assert.deepEqual(pitchesOf(next.notes), [
      null,
      60,
      64,
      62,
      65,
      64,
      null,
      65,
      69,
      67,
      71,
      69,
      null,
      71,
      74,
      72,
      76,
      74,
      null,
      76,
      79,
      77,
      81,
      79,
    ]);
  });

  it("round-trips a playful 3/4 line through MIDI, and the kept original still exports", () => {
    const score = asScore([n(60, 1), n(62, 1), n(64, 1), n(65, 1), n(67, 1), n(69, 1)], {
      title: "圆舞",
      bpm: 120,
      beats: 3,
      beatUnit: 4,
    });
    const kept = structuredClone(score);
    const arranged = arrangeScore(score, "playful");
    const exported = midiToScore(scoreToMidi(arranged), "fallback");
    assert.equal(exported.title, "圆舞");
    assert.equal(exported.bpm, 120);
    assert.equal(exported.beats, 3);
    assert.equal(exported.beatUnit, 4);
    sameNotes(arranged.notes, exported.notes);

    assert.deepEqual(score, kept);
    const restored = midiToScore(scoreToMidi(kept), "fallback");
    assert.equal(restored.beats, 3);
    assert.equal(restored.beatUnit, 4);
    sameNotes(kept.notes, restored.notes);
  });

  it("抒情 leaves a stepwise line untouched", () => {
    const score = asScore([n(60, 1), n(62, 1), n(64, 1)]);
    assert.equal(arrangeScore(score, "lyrical"), score);
  });

  it("抒情 adds one passing tone before a leap, including downward", () => {
    const up = arrangeScore(asScore([n(60, 1), n(67, 1)]), "lyrical");
    assert.deepEqual(pitchesOf(up.notes), [60, 62, 67]);
    assert.deepEqual(
      up.notes.map((note) => note.dur),
      [0.5, 0.5, 1],
    );

    const down = arrangeScore(asScore([n(67, 1), n(60, 1)]), "lyrical");
    assert.deepEqual(pitchesOf(down.notes), [67, 65, 60]);
    assert.deepEqual(
      down.notes.map((note) => note.dur),
      [0.5, 0.5, 1],
    );
  });

  it("抒情 walks the minor scale between a minor third", () => {
    const score = asScore([n(60, 1), n(63, 1)], { mode: "minor" });
    const next = arrangeScore(score, "lyrical");
    assert.deepEqual(pitchesOf(next.notes), [60, 62, 63]);
  });

  it("leaves chords, chromatic notes, rests, and tuplets as they are", () => {
    const chord = n([60, 64, 67], 1);
    const chromatic = n(66, 1);
    const rest = n(-1, 1);
    const score = asScore([chord, chromatic, rest, n(60, 1 / 3), n(62, 1 / 3), n(64, 1 / 3)]);
    const styles: ArrangeStyle[] = ["lively", "playful", "lyrical"];
    for (const style of styles) {
      const next = arrangeScore(score, style);
      assert.equal(next.notes[0], chord, style);
      assert.equal(next.notes[1], chromatic, style);
      assert.equal(next.notes[2], rest, style);
      sameNotes(next.notes.slice(3), score.notes.slice(3));
    }
  });

  it("does not decorate a pitch that has no neighbor inside the piano", () => {
    const score = asScore([n(120, 1)]);
    assert.equal(arrangeScore(score, "lively"), score);
  });

  it("does not split a beat the notation cannot spell, such as 3/16", () => {
    const score = asScore([n(60, 0.25)], { beats: 3, beatUnit: 16 });
    assert.equal(arrangeScore(score, "playful"), score);
  });

  it("活泼 in 6/8 splits one eighth-beat into two sixteenths", () => {
    const score = asScore([n(60, 0.5), n(64, 0.5)], { beats: 6, beatUnit: 8 });
    const next = arrangeScore(score, "lively");
    assert.deepEqual(pitchesOf(next.notes), [60, 62, 64, 65]);
    assert.ok(next.notes.every((note) => note.dur === 0.25));
  });

  it("keeps the written score and the total length, and does not mutate the input", () => {
    const score = asScore([n(60, 1), n(64, 2)], { title: "原曲", bpm: 80, clef: "bass" });
    const snapshot = structuredClone(score);
    const next = arrangeScore(score, "lively");
    assert.deepEqual(score, snapshot);
    assert.equal(next.title, "原曲");
    assert.equal(next.bpm, 80);
    assert.equal(next.key, "C");
    assert.equal(next.mode, "major");
    assert.equal(next.clef, "bass");
    assert.equal(next.beats, 4);
    assert.equal(next.beatUnit, 4);
    assert.equal(next.tonicOctave, 4);
    assert.equal(durationOf(next.notes), durationOf(score.notes));
    assert.notEqual(next, score);
  });

  it("still pastes back to the same sounding pitches, including a written-key shift", () => {
    const score = asScore([n(60, 1), n(64, 1), n(67, 1), n(65, 1)]);
    const arranged = arrangeScore(score, "playful");
    for (const shift of [0, 2]) {
      const shared = jianpuShareText(arranged, shift);
      const imported = importJianpu(shared, arranged, shift);
      assert.equal(imported.error, null, shared);
      assert.equal(imported.key, "C");
      assert.equal(imported.beats, 4);
      assert.equal(imported.beatUnit, 4);
      sameNotes(arranged.notes, imported.notes);
    }
    const letters = formatLetters(arranged);
    const parsed = parseLetters(letters);
    assert.equal(parsed.error, null, letters);
    sameNotes(arranged.notes, parsed.notes);
    const jianpu = formatJianpu(arranged);
    const again = parseJianpu(jianpu, arranged);
    assert.equal(again.error, null, jianpu);
    sameNotes(arranged.notes, again.notes);
  });

  it("transposes an arranged line by the same semitone shift as before", () => {
    const arranged = arrangeScore(asScore([n(60, 1), n(64, 1)]), "lyrical");
    const shifted = transposeScore(arranged, 2);
    assert.equal(arranged.key, "C");
    assert.equal(shifted.key, "D");
    assert.equal(shifted.bpm, arranged.bpm);
    assert.deepEqual(
      shifted.notes.map((note) => note.pitches),
      arranged.notes.map((note) => note.pitches.map((pitch) => pitch + 2)),
    );
    sameNotes(
      shifted.notes.map((note, index) => ({
        pitches: note.pitches,
        dur: arranged.notes[index].dur,
      })),
      shifted.notes,
    );
  });

  it("is deterministic", () => {
    const score = asScore([n(60, 1), n(62, 1), n(65, 2), n(-1, 1), n([60, 64], 1)]);
    for (const style of ["lively", "playful", "lyrical"] as const) {
      const a = arrangeScore(score, style);
      const b = arrangeScore(score, style);
      assert.deepEqual(a, b);
    }
  });
});
