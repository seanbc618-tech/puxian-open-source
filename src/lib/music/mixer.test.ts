import { test } from "node:test";
import assert from "node:assert/strict";
import { alignMixer, channelLevel, defaultChannel, mixEvent, mixerFolds, mixerPrograms } from "./mixer.ts";
import { loadMixer, saveMixer, MIXER_STORE_KEY } from "./mixer-store.ts";
import { playbackPlan } from "./playback.ts";
import { handPlaybackPlan } from "./practice-hands.ts";
import { practicePass } from "./practice.ts";
import type { Score } from "./theory.ts";
const blankScore: Score = {
  title: "混音测试",
  bpm: 60,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [],
};

test("混音：默认不改增益、音量相乘、声像归一化，静音优先于多独奏", () => {
  const channels = alignMixer(undefined, 3);
  const event = { voice: 0, gain: 0.8 };
  assert.deepEqual(mixEvent(event, channels), { gain: 0.8, pan: 0, timbre: "piano" });
  channels[0] = { ...channels[0], volume: 50, pan: -100 };
  assert.deepEqual(mixEvent(event, channels), { gain: 0.4, pan: -1, timbre: "piano" });
  channels[1].solo = true;
  assert.equal(mixEvent(event, channels).gain, 0);
  channels[0].solo = true;
  assert.equal(mixEvent(event, channels).gain, 0.4);
  channels[0].mute = true;
  assert.equal(mixEvent(event, channels).gain, 0);
  assert.equal(mixEvent({ voice: 1, gain: 0.8 }, channels).gain, 0.8);
  assert.equal(mixEvent({ voice: 2, gain: 0.8 }, channels).gain, 0);
  channels[1].volume = 0;
  assert.equal(mixEvent({ voice: 1, gain: 1 }, channels).gain, 0);
});

test("分手筛选先于混音：独奏不能救回静音另一手，30%再乘音量；变速保留声部", () => {
  const score = {
    ...blankScore,
    notes: [{ pitches: [60], dur: 4 }],
    voice2: [{ pitches: [48], dur: 4 }],
  };
  const original = playbackPlan(score);
  const snapshot = structuredClone(original);
  const channels = alignMixer(
    [{ solo: true }, { solo: true, volume: 50, pan: 100, timbre: "bass" }],
    2,
  );
  const muted = handPlaybackPlan(original, "right", "mute");
  assert.deepEqual(
    muted.events.map((e) => e.voice),
    [0],
  );
  const quiet = handPlaybackPlan(original, "right", "quiet");
  const pass = practicePass(score, quiet, { from: 1, to: 3 }, 0.5);
  assert.deepEqual(
    pass.events.map((n) => n.voice),
    [0, 1],
  );
  assert.deepEqual(mixEvent(pass.events[1], channels), {
    gain: original.events[1].gain * 0.3 * 0.5,
    pan: 1,
    timbre: "bass",
  });
  assert.deepEqual(original, snapshot);
  assert.equal(quiet.clicks, original.clicks);
});

test("声部对齐与坏数据：补默认、截掉已删声部、限制16行；非法字段丢弃", () => {
  const bad = [
    { volume: Infinity, pan: 101, mute: "yes", solo: 1, timbre: "__proto__", timbreChanged: true },
    null,
  ];
  assert.deepEqual(alignMixer(bad, 2), [defaultChannel(), defaultChannel()]);
  assert.deepEqual(alignMixer([{ volume: -1, pan: NaN }], 1), [defaultChannel()]);
  const rows = alignMixer([{ timbre: "flute", timbreChanged: true }], 16);
  assert.equal(rows.length, 16);
  assert.equal(alignMixer(rows, 1).length, 1);
  assert.equal(alignMixer(rows, 99).length, 16);
  assert.deepEqual(alignMixer(rows, NaN), []);
  assert.equal(alignMixer(rows, 1)[0].timbre, "flute");
  assert.deepEqual(
    mixerPrograms(alignMixer([{ timbre: "flute" }, { timbre: "piano", timbreChanged: true }], 2)),
    [undefined, 0],
  );
});

test("按曲本机存储：隔离、清洗、默认删除、最多50曲与拒绝存储", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const channels = alignMixer([{ volume: 40, timbre: "guitar", timbreChanged: true }], 2);
  saveMixer(storage, "a", channels);
  assert.deepEqual(loadMixer(storage, "a", 2), channels);
  assert.deepEqual(loadMixer(storage, "b", 2), alignMixer(null, 2));
  assert.equal(loadMixer(storage, "a", 1).length, 1);
  saveMixer(storage, "a", alignMixer(null, 2));
  assert.equal(values.size, 0);
  values.set(MIXER_STORE_KEY, "{broken");
  assert.deepEqual(loadMixer(storage, "a", 1), [defaultChannel()]);
  for (let i = 0; i < 51; i++) saveMixer(storage, `song-${i}`, channels, i);
  assert.equal(Object.keys(JSON.parse(values.get(MIXER_STORE_KEY)!)).length, 50);
  assert.deepEqual(loadMixer(storage, "song-0", 1), [defaultChannel()]);
  const denied = {
    ...storage,
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  assert.deepEqual(loadMixer(denied, "a", 1), [defaultChannel()]);
  assert.doesNotThrow(() => saveMixer(denied, "a", channels));
});

test("channelLevel is the live bus level: volume, mute, solo", () => {
  const a = { ...defaultChannel(), volume: 50 };
  const b = defaultChannel();
  assert.equal(channelLevel(0, [a, b]), 0.5);
  assert.equal(channelLevel(1, [a, { ...b, mute: true }]), 0);
  assert.equal(channelLevel(0, [a, { ...b, solo: true }]), 0);
  assert.equal(channelLevel(1, [a, { ...b, solo: true, mute: true }]), 0);
  assert.equal(channelLevel(5, []), 1);
  assert.equal(mixEvent({ voice: 0, gain: 0.3 }, [a]).gain, 0.15);
});

test("mixerFolds: only one untouched voice folds", () => {
  assert.equal(mixerFolds([defaultChannel()]), true);
  assert.equal(mixerFolds([defaultChannel(), defaultChannel()]), false);
  assert.equal(mixerFolds([{ ...defaultChannel(), volume: 80 }]), false);
  assert.equal(mixerFolds([{ ...defaultChannel(), timbre: "flute", timbreChanged: true }]), false);
  assert.equal(mixerFolds([]), false);
});
