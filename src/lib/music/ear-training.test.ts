import test from "node:test";
import assert from "node:assert/strict";
import {
  EAR_STORE_KEY,
  cadenceChords,
  cleanEarStats,
  degreeLabel,
  degreePitch,
  earSummary,
  earTonic,
  eventsLength,
  pickDegree,
  questionEvents,
  readEarStats,
  recordAnswer,
  resolution,
  resolutionEvents,
  writeEarStats,
} from "./ear-training.ts";

test("级数音高：大调与小调，1̇ 高八度", () => {
  const c = earTonic("C");
  assert.equal(c, 60);
  assert.equal(earTonic("B"), 71);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((d) => degreePitch(c, "major", d as 1)), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual([3, 6, 7].map((d) => degreePitch(69, "minor", d as 3)), [72, 77, 79]);
  assert.equal(degreeLabel(8), "1̇");
  assert.equal(degreeLabel(5), "5");
});

test("I–IV–V–I：小调 V 用升高的导音", () => {
  assert.deepEqual(cadenceChords(60, "major"), [[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67], [48, 60, 64, 67]]);
  const minor = cadenceChords(57, "minor");
  assert.deepEqual(minor[0], [45, 57, 60, 64]);
  assert.ok(minor[2].includes(56), "G# in E major chord over A minor");
});

test("回到主音：下半往 1、上半往 1̇", () => {
  assert.deepEqual(resolution(1), [1]);
  assert.deepEqual(resolution(4), [4, 3, 2, 1]);
  assert.deepEqual(resolution(5), [5, 6, 7, 8]);
  assert.deepEqual(resolution(7), [7, 8]);
  assert.deepEqual(resolution(8), [8]);
});

test("出题：只在本级内，不连续重复", () => {
  assert.equal(pickDegree("low", null, () => 0), 1);
  assert.equal(pickDegree("low", 1, () => 0), 2);
  assert.equal(pickDegree("high", null, () => 0.999), 8);
  assert.equal(pickDegree("unknown", null, () => 0.5), 3, "unknown level falls back to 1 2 3 4");
  for (let i = 0; i < 50; i += 1) {
    const d = pickDegree("scale", 4);
    assert.ok(d >= 1 && d <= 7 && d !== 4);
  }
});

test("题目与解决的事件：先和弦后目标音，解决最后一音拉长", () => {
  const q = questionEvents(60, "major", 5);
  assert.equal(q.length, 17);
  assert.deepEqual(q.at(-1), { midi: 67, when: 2.9, dur: 0.9, gain: 0.3 });
  assert.equal(Math.round(eventsLength(q) * 10) / 10, 3.8);
  assert.deepEqual(questionEvents(60, "major", 2, false), [{ midi: 62, when: 0, dur: 0.9, gain: 0.3 }]);
  const r = resolutionEvents(60, "major", 6);
  assert.deepEqual(r.map((e) => e.midi), [69, 71, 72]);
  assert.equal(r.at(-1)?.dur, 0.8);
});

test("统计：一次答对才算对；摘要找最常错的级数", () => {
  let stats = recordAnswer({}, 4, false);
  stats = recordAnswer(stats, 4, true);
  stats = recordAnswer(stats, 1, true);
  stats = recordAnswer(stats, 5, false);
  assert.deepEqual(stats, { 1: { right: 1, total: 1 }, 4: { right: 1, total: 2 }, 5: { right: 0, total: 1 } });
  assert.equal(earSummary(stats), "累计 4 题，一次答对 50%；最常错的是 5（0/1）。");
  assert.equal(earSummary({ 1: { right: 2, total: 2 } }), "累计 2 题，一次答对 100%。");
  assert.equal(earSummary({}), "还没有练耳记录。");
});

test("统计存取：坏数据丢掉", () => {
  assert.deepEqual(cleanEarStats({ 1: { right: 1, total: 2 }, 9: { right: 0, total: 1 }, 2: { right: 3, total: 2 }, x: 1, 3: null }), { 1: { right: 1, total: 2 } });
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(writeEarStats(store, { 8: { right: 1, total: 1 } }), true);
  assert.deepEqual(readEarStats(store), { 8: { right: 1, total: 1 } });
  data.set(EAR_STORE_KEY, "nope");
  assert.deepEqual(readEarStats(store), {});
});
