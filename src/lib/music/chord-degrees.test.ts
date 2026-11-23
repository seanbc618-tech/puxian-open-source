import test from "node:test";
import assert from "node:assert/strict";
import {
  diatonicChords,
  chordDegree,
  expandProgression,
  mergeProgression,
} from "./chord-degrees.ts";
import type { Score } from "./theory.ts";
const score: Score = {
  title: "t",
  key: "C",
  mode: "major",
  bpm: 80,
  beats: 4,
  beatUnit: 4,
  clef: "treble",
  tonicOctave: 4,
  notes: Array.from({ length: 8 }, () => ({ pitches: [60], dur: 4 })),
};
test("diatonic triads preserve sharp/flat spelling and minor qualities", () => {
  assert.deepEqual(diatonicChords("Eb", "major"), ["Eb", "Fm", "Gm", "Ab", "Bb", "Cm", "Ddim"]);
  assert.deepEqual(diatonicChords("F#", "major"), ["F#", "G#m", "A#m", "B", "C#", "D#m", "E#dim"]);
  assert.deepEqual(diatonicChords("A", "minor"), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
  assert.deepEqual(diatonicChords("Bb", "minor"), ["Bbm", "Cdim", "Db", "Ebm", "Fm", "Gb", "Ab"]);
});
test("roman and numeric degrees work in major/minor and chromatic chords", () => {
  assert.deepEqual(
    diatonicChords("Eb", "major").map((s) => chordDegree(s, "Eb", "major")),
    ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
  );
  assert.deepEqual(
    diatonicChords("F#", "major").map((s) => chordDegree(s, "F#", "major", true)),
    ["1", "2m", "3m", "4", "5", "6m", "7°"],
  );
  assert.deepEqual(
    diatonicChords("A", "minor").map((s) => chordDegree(s, "A", "minor")),
    ["i", "ii°", "III", "iv", "v", "VI", "VII"],
  );
  assert.equal(chordDegree("Bb7", "C", "major"), "♭VII7");
  assert.equal(chordDegree("G7/B", "C", "major"), "V7/VII");
});
test("progressions start on selected measure, respect changes and stop at score end", () => {
  assert.deepEqual(expandProgression(score, [1, 5, 6, 4], 5), [
    { at: 4, symbol: "C" },
    { at: 8, symbol: "G" },
    { at: 12, symbol: "Am" },
    { at: 16, symbol: "F" },
  ]);
  assert.deepEqual(
    expandProgression({ ...score, key: "Eb" }, [1, 5, 6, 4]).map((s) => s.symbol),
    ["Eb", "Bb", "Cm", "Ab"],
  );
  assert.deepEqual(
    expandProgression({ ...score, key: "A", mode: "minor" }, [1, 4, 5]).map((s) => s.symbol),
    ["Am", "Dm", "Em"],
  );
  const changed = {
    ...score,
    changes: [{ at: 4, key: "Bb" as const, mode: "minor" as const, beats: 3, beatUnit: 4 }],
  };
  assert.deepEqual(expandProgression(changed, [1, 2, 3]), [
    { at: 0, symbol: "C" },
    { at: 4, symbol: "Cdim" },
    { at: 7, symbol: "Db" },
  ]);
  assert.equal(expandProgression(score, [1, 5, 6, 4], 29).length, 1);
});
test("preview merging preserves existing marks until explicitly confirmed, without mutation", () => {
  const old = [
      { at: 0, symbol: "Dm" },
      { at: 2, symbol: "E7" },
    ],
    preview = [
      { at: 0, symbol: "C" },
      { at: 4, symbol: "G" },
    ];
  assert.deepEqual(mergeProgression(old, preview), [...old, preview[1]]);
  assert.deepEqual(mergeProgression(old, preview, true), [preview[0], old[1], preview[1]]);
  assert.equal(old[0].symbol, "Dm");
});
