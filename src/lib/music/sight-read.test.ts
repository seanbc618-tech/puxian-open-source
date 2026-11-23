import test from "node:test";
import assert from "node:assert/strict";
import {
  barQuarters,
  generateSightRead,
  sightInKey,
  sightPreviewScore,
} from "./sight-read.ts";
import type { Score } from "./theory.ts";

const base: Pick<Score, "title" | "bpm" | "beats" | "beatUnit" | "key" | "mode" | "clef" | "tonicOctave"> = {
  title: "t",
  bpm: 96,
  beats: 4,
  beatUnit: 4,
  key: "G",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
};

function total(notes: { dur: number }[]) {
  return notes.reduce((sum, note) => sum + note.dur, 0);
}

test("bar length follows the meter, including 6/8", () => {
  assert.equal(barQuarters(4, 4), 4);
  assert.equal(barQuarters(3, 4), 3);
  assert.equal(barQuarters(6, 8), 3);
});

test("two 4/4 bars stay in key and fill exactly two bars", () => {
  const drill = generateSightRead(base, "beats", 7);
  assert.equal(total(drill.notes), 8);
  assert.ok(sightInKey(base, drill.notes));
  assert.ok(drill.notes.every((note) => note.pitches.length === 1));
  assert.match(drill.line, /^1=G 4\/4  .+\s\|\s.+/);
  const preview = sightPreviewScore(base, drill.notes);
  assert.equal(preview.title, "视奏练习");
  assert.equal(preview.key, "G");
  assert.equal(preview.notes.length, drill.notes.length);
  assert.equal(base.title, "t", "source score is not mutated");
});

test("different seeds and densities change the drill; rests include a rest and a note", () => {
  const a = generateSightRead(base, "split", 1);
  const b = generateSightRead(base, "split", 2);
  assert.notDeepEqual(a.notes, b.notes);
  assert.equal(total(a.notes), 8);
  const same = generateSightRead(base, "split", 1);
  assert.deepEqual(same.notes, a.notes);
  const withRests = generateSightRead(base, "rests", 11);
  assert.ok(withRests.notes.some((note) => note.pitches.length === 0));
  assert.ok(withRests.notes.some((note) => note.pitches.length > 0));
  assert.ok(sightInKey(base, withRests.notes));
  assert.match(withRests.line, /-/);
});

test("6/8 drills fill two complete bars on the eighth-note pulse", () => {
  const compound = { ...base, beats: 6, beatUnit: 8, key: "C" as const, mode: "minor" as const };
  const drill = generateSightRead(compound, "split", 3);
  assert.equal(total(drill.notes), 6);
  assert.ok(sightInKey(compound, drill.notes));
  assert.match(drill.line, /^1=C 6\/8  /);
});

test("split density can use half-beat values", () => {
  const found = Array.from({ length: 20 }, (_, seed) => generateSightRead(base, "split", seed + 1))
    .some((drill) => drill.notes.some((note) => Math.abs(note.dur - 0.5) < 1e-9));
  assert.ok(found, "at least one mixed drill should contain eighths");
});
