import assert from "node:assert/strict";
import test from "node:test";
import { barMuted, rampBpm, trainerTicks, metroTicks, GAP_OPTIONS, RAMP_OPTIONS, type TrainerSettings } from "./metronome.ts";

test("静音小节：响 2 停 1 循环", () => {
  const gap = { play: 2, mute: 1 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((b) => barMuted(gap, b)), [false, false, true, false, false, true, false]);
  assert.equal(barMuted(null, 3), false);
  assert.equal(barMuted({ play: 0, mute: 1 }, 0), false);
  assert.equal(GAP_OPTIONS[0].gap, null);
});

test("自动加速：每 N 小节加，不超过目标与上限", () => {
  const ramp = { step: 4, every: 2, target: 90 };
  assert.deepEqual([0, 1, 2, 3, 4, 9, 20].map((b) => rampBpm(80, ramp, b)), [80, 80, 84, 84, 88, 90, 90]);
  assert.equal(rampBpm(80, { step: 4, every: 2, target: 60 }, 10), 80, "a target below the start does nothing");
  assert.equal(rampBpm(230, { step: 5, every: 1, target: 400 }, 10), 240, "capped at the metronome range");
  assert.equal(rampBpm(80, null, 10), 80);
  assert.equal(RAMP_OPTIONS[0].step, 0);
});

const base: TrainerSettings = { bpm: 120, accents: ["strong", "normal"], subdivision: 1 };

test("不开训练时与原节拍器的时间一致", () => {
  const plain = metroTicks(base, 1, 0, 5).clicks.map((c) => +c.when.toFixed(6));
  const trainer = trainerTicks(base, { index: 0, when: 1 }, 5).clicks.map((c) => +c.when.toFixed(6));
  assert.deepEqual(trainer, plain);
});

test("静音小节不发声但仍回报拍位，续排不重不漏", () => {
  const settings = { ...base, gap: { play: 1, mute: 1 } };
  const first = trainerTicks(settings, { index: 0, when: 0 }, 1.1);
  const rest = trainerTicks(settings, first.cursor, 2.1);
  const all = [...first.clicks, ...rest.clicks];
  assert.deepEqual(all.map((c) => c.when), [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(all.map((c) => c.silent), [false, false, true, true, false]);
  assert.deepEqual(all.map((c) => c.level), [1, 0.6, 0, 0, 1]);
  assert.equal(all[2].accent, false);
});

test("加速按小节换速度，拍位间隔随之变短", () => {
  const settings = { ...base, bpm: 60, accents: ["strong"] as const, ramp: { step: 60, every: 1, target: 240 } };
  const { clicks } = trainerTicks(settings, { index: 0, when: 0 }, 2);
  assert.deepEqual(clicks.map((c) => c.bpm), [60, 120, 180, 240]);
  assert.deepEqual(clicks.map((c) => +c.when.toFixed(4)), [0, 1, 1.5, 1.8333, 2.0833].filter((w) => w < 2));
});

test("细分音在静音小节也不响；被静音的拍不回报", () => {
  const settings: TrainerSettings = { bpm: 120, accents: ["strong", "mute"], subdivision: 2, gap: { play: 1, mute: 1 } };
  const { clicks } = trainerTicks(settings, { index: 0, when: 0 }, 2);
  const sounding = clicks.filter((c) => c.level > 0);
  assert.ok(sounding.every((c) => c.bar === 0));
  assert.deepEqual(clicks.filter((c) => c.bar === 1).map((c) => [c.beat, c.sub, c.silent]), [[0, 0, true]], "silent bar: beat 1 only (beat 2 is muted)");
});
