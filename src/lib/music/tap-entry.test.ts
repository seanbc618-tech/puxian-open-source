import test from "node:test";
import assert from "node:assert/strict";
import {
  clampTapOctave,
  tapBackspace,
  tapCursor,
  tapCursorLabel,
  tapDuration,
  tapInsert,
  tapPitch,
} from "./tap-entry.ts";
import { parseJianpu } from "./notation.ts";

const ctx = { key: "C" as const, mode: "major" as const, tonicOctave: 4, beats: 4, beatUnit: 4 };
const n = (p: number, dur = 1) => ({ pitches: [p], dur });

test("keypad pitch matches the 唱名 text box: degree, octave dots, sharps and flats", () => {
  for (const [token, degree, octave, acc] of [
    ["1", 1, 0, 0], ["5'", 5, 1, 0], ["6,", 6, -1, 0], ["#4", 4, 0, 1], ["b7", 7, 0, -1], ["3''", 3, 2, 0],
  ] as const) {
    const parsed = parseJianpu(token, ctx);
    assert.equal(tapPitch(ctx, degree, octave, acc), parsed.notes[0].pitches[0], token);
  }
  assert.equal(tapPitch({ ...ctx, key: "G" }, 1, 0, 0), 67);
  assert.equal(tapPitch(ctx, 0, 0, 0), null, "0 is a rest");
  assert.equal(tapPitch(ctx, 8, 0, 0), null);
  assert.equal(clampTapOctave(5), 2);
  assert.equal(clampTapOctave(-9), -2);
});

test("durations and dots", () => {
  assert.equal(tapDuration(1, false), 1);
  assert.equal(tapDuration(0.5, true), 0.75);
  assert.equal(tapDuration(2, true), 3);
});

test("cursor: after the selected note, else the end; insert and backspace move it", () => {
  const notes = [n(60), n(62), n(64)];
  assert.equal(tapCursor(notes, []), 3);
  assert.equal(tapCursor(notes, [0]), 1);
  assert.equal(tapCursor(notes, [2, 1]), 3);
  assert.equal(tapCursor(notes, [9]), 3, "stale selection falls back to the end");
  const inserted = tapInsert(notes, 1, n(67));
  assert.deepEqual(inserted.notes.map((x) => x.pitches[0]), [60, 67, 62, 64]);
  assert.equal(inserted.index, 1);
  const back = tapBackspace(inserted.notes, 2);
  assert.deepEqual(back?.notes.map((x) => x.pitches[0]), [60, 62, 64]);
  assert.equal(back?.index, 0);
  assert.equal(tapBackspace(notes, 0), null);
  assert.equal(tapBackspace([n(60)], 1)?.index, -1);
  assert.equal(tapCursorLabel([], 0), "从头开始");
  assert.equal(tapCursorLabel(notes, 3), "接在末尾");
  assert.equal(tapCursorLabel(notes, 2), "插在第 2 个音后");
  assert.deepEqual(notes.map((x) => x.pitches[0]), [60, 62, 64], "inputs untouched");
});
