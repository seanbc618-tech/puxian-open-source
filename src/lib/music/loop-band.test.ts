import { test } from "node:test";
import assert from "node:assert/strict";
import { loopBands, notesInLoop } from "./loop-band.ts";

test("notesInLoop：按起点落在 [from, to) 的音（含休止）", () => {
  const notes = [{ dur: 1 }, { dur: 1 }, { dur: 2 }, { dur: 1 }, { dur: 1 }];
  assert.deepEqual([...notesInLoop(notes, { from: 1, to: 4 })], [1, 2]);
  assert.deepEqual([...notesInLoop(notes, { from: 0, to: 6 })], [0, 1, 2, 3, 4]);
  assert.equal(notesInLoop(notes, null).size, 0);
  assert.equal(notesInLoop(notes, { from: 9, to: 12 }).size, 0);
});

test("loopBands：每行一块底色，括号只在循环首尾", () => {
  const lines = new Map([[0, { y: 10, h: 60 }], [1, { y: 100, h: 60 }]]);
  const bands = loopBands(
    [
      { line: 0, x: 200, w: 10 },
      { line: 0, x: 240, w: 12 },
      { line: 1, x: 20, w: 10 },
      { line: 1, x: 60, w: 10 },
      { line: 7, x: 1, w: 1 }, // unknown line is ignored
    ],
    lines,
  );
  assert.deepEqual(bands, [
    { line: 0, x: 194, y: 10, w: 64, h: 60, start: true, end: false },
    { line: 1, x: 14, y: 100, w: 62, h: 60, start: false, end: true },
  ]);
  assert.deepEqual(loopBands([], lines), []);
  const one = loopBands([{ line: 1, x: 50, w: 10 }], lines);
  assert.equal(one.length, 1);
  assert.equal(one[0].start && one[0].end, true);
});
