import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRAINING,
  cleanTraining,
  trainingProgress,
  trainingStages,
  advanceTraining,
} from "./speed-training.ts";
import { countInClicks, practicePass } from "./practice.ts";
import { playbackPlan } from "./playback.ts";
import type { Score } from "./theory.ts";
test("50→100，+10，每档4遍，目标档也练满，共24遍", () => {
  assert.deepEqual(trainingStages(DEFAULT_TRAINING), [50, 60, 70, 80, 90, 100]);
  let state = trainingProgress(DEFAULT_TRAINING, 0);
  const speeds: number[] = [];
  while (!state.done) {
    speeds.push(state.speed);
    state = advanceTraining(DEFAULT_TRAINING, state.completed);
  }
  assert.equal(speeds.length, 24);
  assert.deepEqual(speeds.slice(0, 4), [0.5, 0.5, 0.5, 0.5]);
  assert.equal(speeds[4], 0.6);
  assert.deepEqual(speeds.slice(-4), [1, 1, 1, 1]);
  assert.equal(state.completed, 24);
  assert.equal(advanceTraining(DEFAULT_TRAINING, 24).completed, 24);
});
test("边界、非整除、清洗、暂停持有同一个completed可续播", () => {
  assert.deepEqual(trainingStages({ ...DEFAULT_TRAINING, start: 100, target: 80 }), [80]);
  assert.deepEqual(trainingStages({ ...DEFAULT_TRAINING, start: 80, target: 80 }), [80]);
  assert.deepEqual(trainingStages({ ...DEFAULT_TRAINING, step: 17 }), [50, 67, 84, 100]);
  const settings = cleanTraining({ start: -2, target: 999, step: 0, repeats: Infinity });
  assert.deepEqual(settings, { start: 50, target: 120, step: 1, repeats: 4, countEach: false });
  assert.deepEqual(trainingProgress(DEFAULT_TRAINING, 7), trainingProgress(DEFAULT_TRAINING, 7));
  assert.equal(trainingProgress(DEFAULT_TRAINING, 7).stagePass, 4);
  assert.equal(advanceTraining(DEFAULT_TRAINING, 7).speed, 0.7);
});
test("任意百分比步长，音符和预备拍都按即将播放的速度计时", () => {
  const score: Score = {
    title: "t",
    bpm: 60,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes: [],
  };
  score.notes = [{ pitches: [60], dur: 4 }];
  score.bpm = 60;
  const pass = practicePass(score, playbackPlan(score), { from: 0, to: 4 }, 0.67);
  assert.ok(Math.abs(pass.length - 4 / 0.67) < 1e-6);
  assert.ok(Math.abs(countInClicks(score, 0, 1, 0.67).beatSeconds - 1 / 0.67) < 1e-6);
});
