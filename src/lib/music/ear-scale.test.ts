import test from "node:test";
import assert from "node:assert/strict";
import {
  SCALES,
  pickScale,
  pickScaleRoot,
  scaleOf,
  scalePitches,
  scaleQuestionEvents,
  scaleSummary,
  cleanScaleStats,
  recordScaleAnswer,
} from "./ear-scale.ts";

test("scale table covers majors, minors, modes and color scales with Chinese labels", () => {
  assert.equal(SCALES.length, 13);
  assert.deepEqual(scaleOf("maj").up, [0, 2, 4, 5, 7, 9, 11, 12]);
  assert.equal(scaleOf("natMin").name, "自然小调音阶");
  assert.equal(scaleOf("mixolydian").label, "混合利");
  assert.deepEqual(scaleOf("blues").up, [0, 3, 5, 6, 7, 10, 12]);
  assert.deepEqual(scaleOf("melMin").down, [12, 10, 8, 7, 5, 3, 2, 0]);
});

test("pickScale uses the pool and avoids repeating the last question", () => {
  assert.equal(pickScale("basic", null, () => 0), "maj");
  assert.equal(pickScale("basic", "maj", () => 0), "natMin");
  assert.equal(pickScale("common", null, () => 0), "maj");
  assert.equal(pickScale("all", "whole", () => 0.999), "blues");
});

test("roots stay mid-range; ascending and traditional melodic minor down are spelled correctly", () => {
  assert.equal(pickScaleRoot(() => 0), 60);
  assert.deepEqual(scalePitches("maj", 60, "up"), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(scalePitches("natMin", 60, "up"), [60, 62, 63, 65, 67, 68, 70, 72]);
  assert.deepEqual(scalePitches("harMin", 60, "up"), [60, 62, 63, 65, 67, 68, 71, 72]);
  assert.deepEqual(scalePitches("melMin", 60, "up"), [60, 62, 63, 65, 67, 69, 71, 72]);
  assert.deepEqual(
    scalePitches("melMin", 60, "updown"),
    [60, 62, 63, 65, 67, 69, 71, 72, 70, 68, 67, 65, 63, 62, 60],
  );
  assert.deepEqual(
    scalePitches("maj", 60, "updown"),
    [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60],
  );
  const late = pickScaleRoot(() => 0.999);
  const top = scalePitches("maj", late, "up").at(-1)!;
  assert.ok(late >= 60 && top <= 79);
});

test("scale events rise one note at a time and keep written pitches", () => {
  const up = scaleQuestionEvents(scalePitches("maj", 60, "up"));
  assert.deepEqual(up.map((e) => e.midi), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.ok(up.every((e, i) => i === 0 || e.when > up[i - 1].when));
  const walk = scaleQuestionEvents(scalePitches("melMin", 60, "updown"));
  assert.equal(walk.length, 15);
  assert.equal(walk[0]!.midi, 60);
  assert.equal(walk.at(-1)!.midi, 60);
  assert.equal(walk[7]!.midi, 72);
  assert.equal(walk[8]!.midi, 70);
});

test("stats ignore junk, record first-try, and summarize the weakest scale", () => {
  assert.deepEqual(cleanScaleStats({ natMin: { right: 1, total: 4 }, no: { right: 1, total: 1 }, maj: "x" }), { natMin: { right: 1, total: 4 } });
  const once = recordScaleAnswer({}, "maj", true);
  const twice = recordScaleAnswer(once, "maj", false);
  assert.deepEqual(twice, { maj: { right: 1, total: 2 } });
  assert.equal(scaleSummary({}), "还没有音阶记录。");
  assert.equal(scaleSummary(twice), "音阶累计 2 题，一次答对 50%；最常错的是 大调音阶（1/2）。");
  assert.equal(
    scaleSummary({ maj: { right: 1, total: 1 }, natMin: { right: 0, total: 2 } }),
    "音阶累计 3 题，一次答对 33%；最常错的是 自然小调音阶（0/2）。",
  );
});
