import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardNotes, keyboardRange } from "./visual-keyboard.ts";
import { isBlackKey } from "./fingering.ts";
import { transposeScore, type Score } from "./theory.ts";
const score: Score = {
  title: "t",
  bpm: 60,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [
    { pitches: [60, 64, 67], dur: 1, fingers: [1, 3, 5] },
    { pitches: [], dur: 1 },
  ],
  voice2: [{ pitches: [48, 60], dur: 2, fingers: [5, 1] }],
};
const slots = [
  { voice: 0 as const, note: 0 },
  { voice: 1 as const, note: 0 },
];
test("和弦所有pitches、两声部同音、左右手过滤、休止和无效槽位", () => {
  assert.deepEqual(
    keyboardNotes(score, slots, "both", true).map((n) => [n.midi, n.voice, n.finger]),
    [
      [60, 0, 1],
      [64, 0, 3],
      [67, 0, 5],
      [48, 1, 5],
      [60, 1, 1],
    ],
  );
  assert.equal(keyboardNotes(score, slots, "right").length, 3);
  assert.equal(keyboardNotes(score, slots, "left").length, 2);
  assert.equal(
    keyboardNotes(score, [
      { voice: 0, note: 1 },
      { voice: 1, note: 90 },
    ]).length,
    0,
  );
});
test("使用实际移调音高；指法仅在开启且未移调时显示", () => {
  const shifted = transposeScore(score, 2);
  assert.deepEqual(
    keyboardNotes(shifted, slots, "right", true, true).map((n) => n.midi),
    [62, 66, 69],
  );
  assert.ok(keyboardNotes(shifted, slots, "both", true, true).every((n) => n.finger === undefined));
  assert.ok(keyboardNotes(score, slots).every((n) => n.finger === undefined));
});
test("自动音域包含两声部，至少两八度且白键对齐，兼容空曲和极端音", () => {
  for (const notes of [
    score,
    { notes: [], voice2: [] },
    { notes: [{ pitches: [1, 126], dur: 1 }] },
    { notes: [{ pitches: [61], dur: 1 }] },
  ]) {
    const range = keyboardRange(notes);
    assert.ok(range.high - range.low >= 24);
    assert.equal(isBlackKey(range.low), false);
    assert.equal(isBlackKey(range.high), false);
  }
  assert.ok(keyboardRange(score).low <= 48);
  assert.ok(keyboardRange(score).high >= 67);
});

test("琴键只映射前两个声部，不把其余声部误认作右手", () => {
  assert.deepEqual(keyboardNotes(score, [{ voice: 2, note: 0 }, { voice: 15, note: 0 }]), []);
});
