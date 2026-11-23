import test from "node:test";
import assert from "node:assert/strict";
import { LATENCY_KEY, calibrationClicks, cleanLatency, compensate, estimateLatency, gradeTaps, readLatency, rhythmExercise, rhythmRange, rhythmSummary, weakBars, writeLatency } from "./rhythm-tap.ts";
import type { Score } from "./theory.ts";

const n = (dur: number, rest = false) => ({ pitches: rest ? [] : [60], dur });
// 4/4 at ♩=60: bar 1 = 1 1 1 1, bar 2 = 2 (rest 1) 0.5 0.5, bars 3–6 = whole notes.
const base: Score = {
  title: "t", bpm: 60, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: [n(1), n(1), n(1), n(1), n(2), n(1, true), n(0.5), n(0.5), n(4), n(4), n(4), n(4)],
};

test("range is the A-B loop when set, else the first four bars", () => {
  assert.deepEqual(rhythmRange(base, null), { from: 0, to: 16 });
  assert.deepEqual(rhythmRange(base, { from: 4, to: 8 }), { from: 4, to: 8 });
  assert.deepEqual(rhythmRange(base, { from: 20, to: 99 }), { from: 20, to: 24 }, "clipped to the score");
  const short = { ...base, notes: base.notes.slice(0, 4) };
  assert.deepEqual(rhythmRange(short, null), { from: 0, to: 4 }, "a one-bar score is the whole score");
});

test("targets skip rests, follow speed and tempo changes; one bar of count-in", () => {
  const ex = rhythmExercise(base, { from: 4, to: 8 });
  assert.deepEqual(ex.targets.map((t) => t.at), [0, 3, 3.5]);
  assert.deepEqual(ex.targets.map((t) => t.note), [4, 6, 7]);
  assert.deepEqual(ex.bars, [2, 2]);
  assert.deepEqual(ex.countIn.map((c) => c.when), [-4, -3, -2, -1]);
  assert.equal(ex.countIn[0].accent, true);
  assert.deepEqual(ex.clicks.map((c) => c.when), [0, 1, 2, 3]);
  assert.equal(ex.length, 4);
  const slow = rhythmExercise(base, { from: 4, to: 8 }, 0.5);
  assert.deepEqual(slow.targets.map((t) => t.at), [0, 6, 7]);
  assert.equal(slow.length, 8);
  const faster = rhythmExercise({ ...base, changes: [{ at: 2, bpm: 120 }] }, { from: 0, to: 4 });
  assert.deepEqual(faster.targets.map((t) => t.at), [0, 1, 2, 2.5], "beats 3–4 at ♩=120");
});

test("grading: 准 / 偏早 / 偏晚 / 漏拍 / 多拍, one tap per note", () => {
  const { targets } = rhythmExercise(base, { from: 0, to: 8 });
  // notes at 0 1 2 3 4 7 7.5
  const result = gradeTaps(targets, [0.02, 0.88, 2.1, 4.0, 5.5, 7.05, 7.35]);
  assert.deepEqual(result.marks.map((m) => m.verdict), ["good", "early", "late", "miss", "good", "good", "early"]);
  assert.deepEqual(result.extra, [5.5]);
  assert.equal(Math.round((result.marks[1].offset ?? 0) * 1000), -120);
  // Halfway rule: a tap at 7.32 is closer to 7.5 and cannot be taken by 7.
  const close = gradeTaps(targets.slice(-2), [7.32]);
  assert.deepEqual(close.marks.map((m) => m.verdict), ["miss", "early"]);
  assert.deepEqual(weakBars(result), [1, 2]);
});

test("summary line", () => {
  const { targets } = rhythmExercise(base, { from: 0, to: 4 });
  assert.equal(rhythmSummary(gradeTaps(targets, [0, 1, 2, 3])), "准 4 · 偏早 0 · 偏晚 0 · 漏拍 0 · 多拍 0；整体很稳，得分 100。");
  assert.equal(rhythmSummary(gradeTaps(targets, [0.1, 1.1, 2.1])), "准 0 · 偏早 0 · 偏晚 3 · 漏拍 1 · 多拍 0；整体偏晚 100 毫秒，得分 38。");
  assert.match(rhythmSummary(gradeTaps(targets, [])), /^没有拍到音符（共 4 个）/);
  assert.equal(rhythmSummary(gradeTaps([], [])), "这一段没有可拍的音符。");
});

test("延迟补偿：存取、夹在 −100…400 ms、补偿后再判定", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readLatency(store), 0);
  assert.equal(writeLatency(store, 182.4), true);
  assert.equal(data.get(LATENCY_KEY), "182");
  assert.equal(readLatency(store), 182);
  assert.equal(cleanLatency(900), 400);
  assert.equal(cleanLatency(-300), -100);
  assert.equal(cleanLatency("x"), 0);
  const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(readLatency(broken), 0);
  assert.equal(writeLatency(broken, 50), false);
  const { targets } = rhythmExercise(base, { from: 0, to: 4 });
  const late = [0.18, 1.19, 2.19, 3.18];
  assert.deepEqual(gradeTaps(targets, late).marks.map((m) => m.verdict), ["late", "late", "late", "late"]);
  assert.deepEqual(gradeTaps(targets, compensate(late, 190)).marks.map((m) => m.verdict), ["good", "good", "good", "good"]);
});

test("点按校准：去掉热身，取中位数；点得太少不给结果", () => {
  const clicks = calibrationClicks();
  assert.equal(clicks.length, 8);
  assert.equal(clicks[7], 4.2);
  // Warm-up taps are wild; then ~200 ms late plus one stray tap at 3.4.
  const taps = [0.5, 0.9, 1.41, 1.99, 2.62, 3.2, 3.4, 3.8, 4.4];
  assert.equal(estimateLatency(clicks, taps), 200);
  assert.equal(estimateLatency(clicks, [1.4, 2.0, 2.6]), null);
  assert.equal(estimateLatency(clicks, []), null);
});
