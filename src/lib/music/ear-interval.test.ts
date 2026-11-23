import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERVALS,
  cleanIntervalStats,
  intervalOf,
  intervalQuestionEvents,
  intervalSummary,
  pickInterval,
  pickIntervalPair,
  recordIntervalAnswer,
} from "./ear-interval.ts";

test("interval table covers 1–12 semitones with Chinese labels", () => {
  assert.equal(INTERVALS.length, 12);
  assert.deepEqual(INTERVALS.map((i) => i.semitones), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(intervalOf("m3").name, "小三度");
  assert.equal(intervalOf("TT").label, "增4");
});

test("pickInterval uses the pool and avoids repeating the last question", () => {
  assert.equal(pickInterval("narrow", null, () => 0), "m2");
  assert.equal(pickInterval("narrow", "m2", () => 0), "M2");
  assert.equal(pickInterval("common", null, () => 0), "M2");
  assert.equal(pickInterval("all", "P8", () => 0.999), "M7");
});

test("pairs stay in a mid range and keep the written span", () => {
  const first = pickIntervalPair(1, () => 0);
  assert.deepEqual(first, { low: 60, high: 61 });
  const wide = pickIntervalPair(12, () => 0);
  assert.deepEqual(wide, { low: 60, high: 72 });
  const late = pickIntervalPair(2, () => 0.999);
  assert.equal(late.high - late.low, 2);
  assert.ok(late.low >= 60 && late.high <= 72);
});

test("melodic events are staggered; harmonic events start together", () => {
  const melody = intervalQuestionEvents(60, 64, "melodic");
  assert.equal(melody.length, 2);
  assert.ok(melody[1].when > melody[0].when);
  assert.equal(melody[0].midi, 60);
  assert.equal(melody[1].midi, 64);
  const together = intervalQuestionEvents(60, 67, "harmonic");
  assert.deepEqual(together.map((e) => e.when), [0, 0]);
  assert.deepEqual(together.map((e) => e.midi), [60, 67]);
});

test("stats ignore junk, record first-try, and summarize the weakest interval", () => {
  assert.deepEqual(cleanIntervalStats({ m3: { right: 1, total: 4 }, no: { right: 1, total: 1 }, P5: "x" }), { m3: { right: 1, total: 4 } });
  const once = recordIntervalAnswer({}, "M3", true);
  const twice = recordIntervalAnswer(once, "M3", false);
  assert.deepEqual(twice, { M3: { right: 1, total: 2 } });
  assert.equal(intervalSummary({}), "还没有音程记录。");
  assert.equal(intervalSummary(twice), "音程累计 2 题，一次答对 50%；最常错的是 大三度（1/2）。");
  assert.equal(
    intervalSummary({ M3: { right: 1, total: 1 }, m3: { right: 0, total: 2 } }),
    "音程累计 3 题，一次答对 33%；最常错的是 小三度（0/2）。",
  );
});
