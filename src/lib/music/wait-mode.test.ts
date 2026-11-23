import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptWaitInput,
  newWaitState,
  waitTargets,
  waitResult,
  type WaitTarget,
  type WaitInput,
} from "./wait-mode.ts";
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
const targets: WaitTarget[] = [
  { quarter: 0, bar: 1, pitches: [60, 64, 67], slots: [{ voice: 0, note: 0 }] },
  { quarter: 4, bar: 2, pitches: [60], slots: [{ voice: 0, note: 1 }] },
];
const on = (midi: number, at: number): WaitInput => ({ kind: "on", midi, at });
const off = (midi: number, at: number): WaitInput => ({ kind: "off", midi, at });
const mic = (midi: number | null, at: number): WaitInput => ({ kind: "mic", midi, at });
test("按书写攻击组合双手、跳过休止与伴奏，循环段右端不包含，手与八度保持", () => {
  const score = {
    ...freshScore(),
    notes: [
      { dur: 1, pitches: [60, 64] },
      { dur: 1, pitches: [] },
      { dur: 2, pitches: [72] },
    ],
    voice2: [
      { dur: 2, pitches: [48] },
      { dur: 2, pitches: [50] },
    ],
    extraVoices: [[{ dur: 4, pitches: [36] }]],
  };
  assert.deepEqual(
    waitTargets(score).map((t) => t.pitches),
    [
      [48, 60, 64],
      [50, 72],
    ],
  );
  assert.deepEqual(
    waitTargets(score, "left").map((t) => t.pitches),
    [[48], [50]],
  );
  assert.deepEqual(
    waitTargets(score, "right", { from: 1, to: 3 }).map((t) => t.pitches),
    [[72]],
  );
  assert.equal(waitTargets(score, "right", { from: 0, to: 2 }).length, 1);
  assert.deepEqual(waitTargets({ ...score, notes: [] }, "right"), []);
  const sustained = waitTargets({ ...score, notes: [{ dur: 8, pitches: [60] }] }, "right", {
    from: 4,
    to: 8,
  });
  assert.equal(sustained[0].quarter, 4);
  assert.equal(sustained[0].bar, 2);
});
test("MIDI 和弦必须全部按住，300ms 边界通过，八度错计一次，纯函数不改输入", () => {
  const initial = newWaitState(0);
  let state = acceptWaitInput(initial, targets, on(60, 1));
  assert.equal(state.index, 0);
  assert.deepEqual(initial.held, {});
  state = acceptWaitInput(state, targets, on(64, 100));
  state = acceptWaitInput(state, targets, on(79, 200));
  assert.equal(state.errors, 1);
  assert.equal(state.feedback, "wrong");
  state = acceptWaitInput(state, targets, on(67, 301));
  assert.equal(state.index, 1);
  assert.equal(state.correct, 1);
  state = acceptWaitInput(state, targets, on(60, 302)); // still held: no retrigger
  assert.equal(state.finished, false);
  state = acceptWaitInput(state, targets, off(60, 303));
  state = acceptWaitInput(state, targets, on(60, 304));
  assert.equal(state.finished, true);
  assert.deepEqual(waitResult(state, 2304), {
    accuracy: 67,
    errors: 1,
    seconds: 2,
    bars: [{ bar: 1, errors: 1 }],
  });
});
test("过期与已松开的和弦音不凑数，松键重弹可恢复", () => {
  let state = acceptWaitInput(newWaitState(0), targets, on(60, 1));
  state = acceptWaitInput(state, targets, on(64, 100));
  state = acceptWaitInput(state, targets, on(67, 302));
  assert.equal(state.index, 0);
  state = acceptWaitInput(state, targets, off(60, 303));
  state = acceptWaitInput(state, targets, on(60, 304));
  assert.equal(state.index, 1);
  let released = acceptWaitInput(newWaitState(0), targets, on(60, 1));
  released = acceptWaitInput(released, targets, off(60, 2));
  released = acceptWaitInput(released, targets, on(64, 3));
  released = acceptWaitInput(released, targets, on(67, 4));
  assert.equal(released.index, 0);
  assert.equal(released.errors, 0);
});
test("MIDI 循环与无效输入、乱序事件，重复 note-on 不重复记错", () => {
  const one = [targets[1]];
  let state = acceptWaitInput(newWaitState(0), one, on(61, 1));
  state = acceptWaitInput(state, one, on(61, 2));
  assert.equal(state.errors, 1);
  assert.equal(acceptWaitInput(state, one, on(60, -1)), state);
  assert.equal(acceptWaitInput(state, one, on(NaN, 3)), state);
  state = acceptWaitInput(state, one, on(60, 3), true);
  assert.equal(state.index, 0);
  assert.equal(state.finished, false);
  assert.equal(state.correct, 1);
});
test("麦克风只检查最高音、±50音分且稳定80ms，拒绝八度，连续同音不自动跳", () => {
  const one = [targets[0], targets[0]];
  let state = acceptWaitInput(newWaitState(0), one, mic(67.49, 1));
  state = acceptWaitInput(state, one, mic(67.49, 80));
  assert.equal(state.correct, 0);
  state = acceptWaitInput(state, one, mic(67.49, 81));
  assert.equal(state.correct, 1);
  state = acceptWaitInput(state, one, mic(67.49, 200));
  assert.equal(state.correct, 1);
  state = acceptWaitInput(state, one, mic(null, 201));
  state = acceptWaitInput(state, one, mic(79, 202));
  state = acceptWaitInput(state, one, mic(79, 282));
  assert.equal(state.errors, 1);
  state = acceptWaitInput(state, one, mic(79, 400));
  assert.equal(state.errors, 1);
  state = acceptWaitInput(state, one, mic(67, 401));
  state = acceptWaitInput(state, one, mic(67, 481));
  assert.equal(state.finished, true);
});
test("麦克风稳定中断重算、容差边界与边界外", () => {
  const one = [targets[1]];
  let state = acceptWaitInput(newWaitState(0), one, mic(60, 1));
  state = acceptWaitInput(state, one, mic(null, 70));
  state = acceptWaitInput(state, one, mic(60, 80));
  state = acceptWaitInput(state, one, mic(60, 100));
  assert.equal(state.correct, 0);
  state = acceptWaitInput(state, one, mic(60.5, 200)); // rounded pitch changed, restart stability
  state = acceptWaitInput(state, one, mic(60.5, 280));
  assert.equal(state.finished, true);
  let wrong = acceptWaitInput(newWaitState(0), one, mic(60.501, 1));
  wrong = acceptWaitInput(wrong, one, mic(60.501, 81));
  assert.equal(wrong.errors, 1);
});
test("本次成绩：空尝试、部分退出、前三错小节排序、非负用时", () => {
  assert.deepEqual(waitResult(newWaitState(10), 0), {
    accuracy: 0,
    errors: 0,
    seconds: 0,
    bars: [],
  });
  const state = {
    ...newWaitState(100),
    correct: 8,
    errors: 2,
    errorsByBar: { 1: 2, 2: 5, 3: 2, 4: 3, 5: 1 },
  };
  assert.deepEqual(waitResult(state, 65100), {
    accuracy: 80,
    errors: 2,
    seconds: 65,
    bars: [
      { bar: 2, errors: 5 },
      { bar: 4, errors: 3 },
      { bar: 1, errors: 2 },
    ],
  });
});

test("本机实时 YIN 适配常见采样率与音区；静音不制造音符", async () => {
  const { livePitch } = await import("./audio.ts");
  for (const rate of [44100, 48000]) {
    assert.equal(livePitch(new Float32Array(Math.ceil(rate * 0.1)), rate), null);
    for (const midi of [48, 60, 69, 72]) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const samples = Float32Array.from(
        { length: Math.ceil(rate * 0.1) },
        (_, i) => 0.4 * Math.sin((2 * Math.PI * frequency * i) / rate),
      );
      const detected = livePitch(samples, rate);
      assert.ok(
        detected != null && Math.abs(detected - midi) < 0.15,
        `${rate}Hz: ${midi} → ${detected}`,
      );
    }
  }
});
