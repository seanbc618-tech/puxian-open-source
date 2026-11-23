import { test } from "node:test";
import assert from "node:assert/strict";
import { handPlaybackPlan } from "./practice-hands.ts";
import { playbackPlan } from "./playback.ts";
import type { Score } from "./theory.ts";
const freshScore = (): Score => ({
  title: "练习",
  bpm: 60,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [],
});
import { practicePass, countInClicks } from "./practice.ts";
import { DEFAULT_PRACTICE, cleanPractice, loadPractice, savePractice } from "./practice-store.ts";
test("分手播放过滤与30%音量保留动态、时间、节拍和原计划，伴奏跟随另一手", () => {
  const score = {
    ...freshScore(),
    notes: [{ dur: 4, pitches: [60] }],
    voice2: [{ dur: 4, pitches: [48] }],
    extraVoices: [[{ dur: 4, pitches: [36] }]],
  };
  const plan = playbackPlan(score),
    original = structuredClone(plan);
  assert.equal(handPlaybackPlan(plan), plan);
  assert.deepEqual(
    handPlaybackPlan(plan, "right").events.map((e) => e.voice),
    [0],
  );
  assert.deepEqual(
    handPlaybackPlan(plan, "left").events.map((e) => e.voice),
    [1],
  );
  const quiet = handPlaybackPlan(plan, "left", "quiet");
  assert.deepEqual(
    quiet.events.map((e) => e.gain),
    plan.events.map((e) => e.gain * (e.voice === 1 ? 1 : 0.3)),
  );
  assert.equal(quiet.clicks, plan.clicks);
  assert.equal(quiet.quarters, plan.quarters);
  assert.deepEqual(plan, original);
  const pass = practicePass(score, quiet, { from: 0, to: 4 }, 0.5);
  assert.equal(pass.notes.length, 3);
  assert.equal(pass.notes[0].gain, quiet.events[0].gain);
  assert.ok(countInClicks(score, 0, 1, 0.5).length > 0);
});
test("分手设置只按曲存本机，兼容默认数据并清洗非法值", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  savePractice(store, "a", { ...DEFAULT_PRACTICE, hand: "left", otherHand: "quiet" });
  assert.equal(loadPractice(store, "a").hand, "left");
  assert.equal(loadPractice(store, "a").otherHand, "quiet");
  assert.deepEqual(loadPractice(store, "b"), DEFAULT_PRACTICE);
  assert.deepEqual(
    cleanPractice({ ...DEFAULT_PRACTICE, hand: "unknown", otherHand: 1 }),
    DEFAULT_PRACTICE,
  );
  savePractice(store, "a", DEFAULT_PRACTICE);
  assert.equal(values.size, 0);
});
