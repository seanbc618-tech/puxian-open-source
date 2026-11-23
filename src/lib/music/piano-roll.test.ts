import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import {
  isWhiteKey,
  layoutPianoRoll,
  midiOctaveName,
  pianoRollOf,
} from "./piano-roll.ts";
import type { Score } from "./theory.ts";

function base(over: Partial<Score> & { notes: Score["notes"] }): Score {
  return {
    title: "t",
    bpm: 60,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    ...over,
  };
}

test("小星星 pitches and durations match the staff (concert pitch)", () => {
  const score = scoreFromExample(EXAMPLES.find((item) => item.id === "twinkle")!);
  const frozen = structuredClone(score);
  const model = pianoRollOf(score);
  assert.equal(model.quarters, 48);
  assert.deepEqual(
    model.rects.slice(0, 8).map((r) => [r.midi, r.start, r.dur, r.voice, r.note]),
    [
      [60, 0, 1, 0, 0],
      [60, 1, 1, 0, 1],
      [67, 2, 1, 0, 2],
      [67, 3, 1, 0, 3],
      [69, 4, 1, 0, 4],
      [69, 5, 1, 0, 5],
      [67, 6, 2, 0, 6],
      [65, 8, 1, 0, 7],
    ],
  );
  assert.equal(model.rects.length, score.notes.filter((n) => n.pitches.length).length);
  assert.deepEqual(model.bars, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]);
  assert.ok(model.midiLow <= 58 && model.midiHigh >= 71);
  assert.deepEqual(score, frozen, "projection does not mutate the score");
});

test("two voices keep independent onsets; a chord makes one rect per pitch", () => {
  const score = base({
    notes: [
      { pitches: [60, 64, 67], dur: 1 },
      { pitches: [], dur: 1 },
      { pitches: [62], dur: 2 },
    ],
    voice2: [{ pitches: [48], dur: 4 }],
  });
  const model = pianoRollOf(score);
  assert.equal(model.quarters, 4);
  assert.deepEqual(
    model.rects.map((r) => [r.voice, r.note, r.midi, r.start, r.dur]),
    [
      [0, 0, 60, 0, 1],
      [0, 0, 64, 0, 1],
      [0, 0, 67, 0, 1],
      [0, 2, 62, 2, 2],
      [1, 0, 48, 0, 4],
    ],
  );
});

test("tempo changes do not change written start or duration", () => {
  const score = base({
    bpm: 60,
    changes: [{ at: 2, bpm: 120 }],
    notes: [
      { pitches: [60], dur: 2 },
      { pitches: [67], dur: 2 },
    ],
  });
  const model = pianoRollOf(score);
  assert.deepEqual(
    model.rects.map((r) => [r.midi, r.start, r.dur]),
    [
      [60, 0, 2],
      [67, 2, 2],
    ],
  );
  assert.equal(model.quarters, 4);
});

test("written pitch applies the instrument shift; sounding is the default and matches MIDI", () => {
  const score = base({ notes: [{ pitches: [60], dur: 1 }] });
  assert.equal(pianoRollOf(score).rects[0].midi, 60);
  assert.equal(pianoRollOf(score, { shift: 2 }).rects[0].midi, 60, "shift ignored at sounding pitch");
  assert.equal(pianoRollOf(score, { shift: 2, pitch: "written" }).rects[0].midi, 62);
  assert.equal(pianoRollOf(score, { shift: 2, pitch: "sounding" }).rects[0].midi, 60);
});

test("rests and junk durations occupy no rectangles; empty scores still have a range", () => {
  const score = base({
    notes: [
      { pitches: [], dur: 1 },
      { pitches: [60], dur: Number.NaN },
      { pitches: [64], dur: 0 },
    ],
  });
  const model = pianoRollOf(score);
  assert.equal(model.rects.length, 0);
  assert.equal(model.quarters, 1);
  assert.equal(model.midiLow, 48);
  assert.equal(model.midiHigh, 72);
});

test("layout: later notes sit further right, higher pitches sit higher, long scores scroll", () => {
  const score = base({
    notes: [
      { pitches: [60], dur: 1 },
      { pitches: [72], dur: 1 },
    ],
  });
  const model = pianoRollOf(score);
  const compact = layoutPianoRoll(model, 400);
  assert.ok(compact.xOf(1) > compact.xOf(0));
  assert.ok(compact.yOf(72) < compact.yOf(60));
  assert.equal(compact.wOf(1), compact.pxPerQuarter);
  const long = pianoRollOf(
    base({
      notes: Array.from({ length: 64 }, () => ({ pitches: [60], dur: 1 })),
    }),
  );
  const wide = layoutPianoRoll(long, 400);
  assert.ok(wide.width > 400, "a 64-quarter score does not shrink below 28px per quarter");
  assert.ok(wide.pxPerQuarter >= 28);
});

test("keyboard helpers name C octaves and classify black keys", () => {
  assert.equal(midiOctaveName(60), "C4");
  assert.equal(midiOctaveName(72), "C5");
  assert.equal(midiOctaveName(61), null);
  assert.equal(isWhiteKey(60), true);
  assert.equal(isWhiteKey(61), false);
});

test("written pitches stay in the roll even above the piano top", () => {
  const score = base({ notes: [{ pitches: [108], dur: 1 }] });
  const model = pianoRollOf(score, { shift: 9, pitch: "written" });
  assert.equal(model.rects[0].midi, 117);
  assert.ok(model.midiHigh >= 117);
});

test("minPlotHeight stretches rows to fill the available height", () => {
  const score = base({
    notes: [
      { pitches: [60], dur: 1 },
      { pitches: [72], dur: 1 },
    ],
  });
  const model = pianoRollOf(score);
  const compact = layoutPianoRoll(model, 400);
  const tall = layoutPianoRoll(model, 400, { minPlotHeight: 400 });
  assert.ok(tall.rowHeight > compact.rowHeight);
  assert.ok(tall.height >= 400 - 1);
});
