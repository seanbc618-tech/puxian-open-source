import test from "node:test";
import assert from "node:assert/strict";
import {
  SPEED_MAX,
  SPEED_MIN,
  barStarts,
  barOfQuarter,
  clampSpeed,
  countInClicks,
  practicePass,
  practiceQuarterAt,
} from "./practice.ts";
import { describeLoop, practiceLoopStatus, karaokeLine, loopFromBars, loopFromSelection, practiceChange, resumeRange } from "./practice-text.ts";
import { playbackPlan } from "./playback.ts";
import type { Score } from "./theory.ts";

const base: Score = {
  title: "t", bpm: 60, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: Array.from({ length: 16 }, (_, i) => ({ pitches: [60 + (i % 5)], dur: 1 })),
};

test("speed clamps to 50%–120% and rejects junk", () => {
  assert.equal(SPEED_MIN, 0.5);
  assert.equal(SPEED_MAX, 1.2);
  assert.equal(clampSpeed(0.1), 0.5);
  assert.equal(clampSpeed(3), 1.2);
  assert.equal(clampSpeed(Number.NaN), 1);
  assert.equal(clampSpeed(0.83), 0.85, "snaps to 5% steps");
});

test("bars follow meter changes; loops by bar and by selected notes", () => {
  const score = { ...base, changes: [{ at: 8, beats: 3, beatUnit: 4 }] };
  assert.deepEqual(barStarts(score), [0, 4, 8, 11, 14]);
  assert.equal(barOfQuarter(score, 0), 1);
  assert.equal(barOfQuarter(score, 9), 3);
  assert.equal(barOfQuarter(score, 15.5), 5);
  assert.deepEqual(loopFromBars(score, 2, 3), { from: 4, to: 11 });
  assert.deepEqual(loopFromBars(score, 3, 2), { from: 4, to: 11 }, "reversed order is fine");
  assert.deepEqual(loopFromBars(score, 5, 9), { from: 14, to: 16 }, "last bar ends at the music");
  assert.equal(loopFromBars(score, 0, 0), null);
  assert.deepEqual(loopFromSelection(score, 0, [6, 3]), { from: 3, to: 7 });
  assert.equal(loopFromSelection(score, 1, [0]), null, "missing voice");
  assert.equal(loopFromSelection(score, 0, []), null);
  assert.equal(describeLoop(score, { from: 4, to: 11 }), "第 2–3 小节");
  assert.equal(describeLoop(score, { from: 4, to: 8 }), "第 2 小节");
  assert.equal(describeLoop(score, { from: 3, to: 7 }), "第 1–2 小节（选中的音）");
});

test("one practice pass: only the loop, re-timed by speed, pitch untouched", () => {
  const plan = playbackPlan(base);
  const pass = practicePass(base, plan, { from: 4, to: 8 }, 0.5);
  assert.equal(pass.length, 8, "4 quarters at 60 bpm, half speed");
  assert.deepEqual(pass.notes.map((n) => n.midi), [64, 60, 61, 62], "same pitches as written");
  assert.deepEqual(pass.notes.map((n) => n.when), [0, 2, 4, 6]);
  assert.ok(pass.notes.every((n) => n.seconds > 1.5 && n.seconds <= 2));
  assert.deepEqual(pass.clicks.map((c) => [c.when, c.accent]), [[0, true], [2, false], [4, false], [6, false]]);
  assert.deepEqual(pass.events.map((e) => e.note), [4, 5, 6, 7], "follow keeps the original note index");
  // A note held into the loop start is clipped, not dropped.
  const held = { ...base, notes: [{ pitches: [60], dur: 6 }, { pitches: [62], dur: 2 }] };
  const clipped = practicePass(held, playbackPlan(held), { from: 4, to: 8 }, 1);
  assert.deepEqual(clipped.events.map((e) => [e.note, e.start]), [[0, 4], [1, 6]]);
  assert.ok(clipped.events.every((e) => e.dur > 1 && e.dur <= 2), "clipped to the loop end");
  assert.equal(practiceQuarterAt(base, { from: 4, to: 8 }, 0.5, 3), 5.5);
});

test("count-in: one or two bars in the loop's meter and tempo", () => {
  const score = { ...base, changes: [{ at: 8, bpm: 120, beats: 3, beatUnit: 4 }] };
  const one = countInClicks(score, 8, 1, 1);
  assert.deepEqual(one.clicks.map((c) => [c.when, c.accent]), [[0, true], [0.5, false], [1, false]]);
  assert.equal(one.length, 1.5);
  const two = countInClicks(base, 0, 2, 0.5);
  assert.equal(two.clicks.length, 8);
  assert.equal(two.length, 16);
  assert.equal(countInClicks(base, 0, 0, 1).clicks.length, 0);
});

test("karaoke line: the phrase around the sung note, sung / now / next", () => {
  const lyric = (text: string) => ({ text, syllabic: "single" as const });
  const words = ["一", "闪", "一", "闪", "亮", "晶", "晶", "满", "天", "都", "是", "小", "星", "星", "啊", "啊"];
  const score = { ...base, notes: base.notes.map((n, i) => ({ ...n, lyric: lyric(words[i]) })) };
  const line = karaokeLine(score.notes, score, 5, 2);
  assert.equal(line?.map((s) => s.text).join(""), "一闪一闪亮晶晶满");
  assert.deepEqual(line?.map((s) => s.state).slice(4, 7), ["sung", "now", "next"]);
  assert.equal(karaokeLine(score.notes, score, 9, 2)?.[0].text, "天");
  assert.equal(karaokeLine(base.notes, base, 2, 2), null, "no lyrics, no strip");
  assert.ok(karaokeLine(score.notes, score, -1, 2)?.every((s) => s.state === "next"), "before singing nothing is lit");
  const latin = [
    { pitches: [60], dur: 1, lyric: { text: "Twin", syllabic: "begin" as const } },
    { pitches: [60], dur: 1, lyric: { text: "kle", syllabic: "end" as const } },
    { pitches: [67], dur: 1, lyric: { text: "star", syllabic: "single" as const } },
  ];
  assert.deepEqual(karaokeLine(latin, base, 0, 2)?.map((s) => [s.text, s.joinNext]), [["Twin", true], ["kle", false], ["star", false]]);
});

class FakeParam { setValueAtTime() {} cancelScheduledValues() {} exponentialRampToValueAtTime() {} value = 0; }
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "";
  connect() {}
  disconnect() {}
  start(when: number) { FakeCtx.current!.starts.push(when); }
  stop() {}
}
class FakeCtx {
  static current: FakeCtx | null = null;
  currentTime = 0;
  state = "running";
  destination = {};
  starts: number[] = [];
  constructor() { FakeCtx.current = this; }
  resume() { return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  addEventListener() {}
  removeEventListener() {}
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
}

test("practice playback: count-in frames, looping passes, stop silences without closing the context", async () => {
  const { playScore, isPlainPractice, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  assert.equal(isPlainPractice(undefined), true);
  assert.equal(isPlainPractice({ speed: 1, countInBars: 0, loop: false }), true);
  assert.equal(isPlainPractice({ speed: 0.8 }), false);
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { ctx: g.AudioContext, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  let queued: (() => void) | null = null;
  g.AudioContext = FakeCtx;
  g.requestAnimationFrame = (fn: () => void) => { queued = fn; return 1; };
  g.cancelAnimationFrame = () => { queued = null; };
  try {
    const frames: { ratio: number; countIn?: number; pass?: number; slots: { note: number }[] }[] = [];
    const handle = playScore(base, (frame) => frames.push(frame), {
      practice: { range: { from: 4, to: 8 }, loop: true, speed: 1, countInBars: 1 },
    });
    const ctx = FakeCtx.current!;
    const step = (t: number) => { ctx.currentTime = t; const run = queued; queued = null; run?.(); };
    step(0.5);
    assert.equal(frames.at(-1)?.countIn, 4, "first count-in beat");
    step(1.5);
    assert.equal(frames.at(-1)?.countIn, 3, "4/4 at 60 bpm: second beat, three left");
    assert.equal(frames.at(-1)?.ratio, 0);
    step(4.06 + 0.5);
    assert.equal(frames.at(-1)?.slots[0]?.note, 4, "loop starts on note 5 (index 4)");
    step(7);
    assert.ok(ctx.starts.some((t) => Math.abs(t - 8.06) < 1e-6), "pass 2 is queued before it starts");
    step(4.06 + 4 + 1.5);
    assert.equal(frames.at(-1)?.pass, 1);
    assert.equal(frames.at(-1)?.slots[0]?.note, 5, "second pass follows the same notes");
    step(11);
    assert.ok(ctx.starts.some((t) => Math.abs(t - 12.06) < 1e-6), "and pass 3 after that");
    handle.stop();
    assert.notEqual(ctx.state, "closed", "stop silences but must not close the shared context");
    assert.equal(queued, null);
  } finally {
    const { resetPlaybackContextForTests } = await import("./playback.ts");
    resetPlaybackContextForTests();
    g.AudioContext = saved.ctx;
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
  }
});

test("resumeRange：慢速滑杆续播从当前位置到循环末尾", () => {
  const range = { from: 4, to: 12 };
  assert.deepEqual(resumeRange(range, 7.5), { from: 7.5, to: 12 });
  assert.equal(resumeRange(range, 4), null, "at the loop start a normal pass is the same");
  assert.equal(resumeRange(range, 12), null);
  assert.equal(resumeRange(range, 2), null);
  assert.equal(resumeRange(range, null), null);
  assert.equal(resumeRange(range, Number.NaN), null);
});

test("practiceChange：只动速度→续播不预备拍；其他改动→重启；没变→不动", () => {
  const base = { speed: 0.8, countInBars: 2, loopOn: true, from: 0, to: 8 };
  assert.equal(practiceChange(base, { ...base, speed: 0.6 }), "resume");
  assert.equal(practiceChange(base, { ...base }), "none");
  assert.equal(practiceChange(base, { ...base, speed: 0.801 }), "none", "same snapped speed");
  assert.equal(practiceChange(base, { ...base, countInBars: 1 }), "restart");
  assert.equal(practiceChange(base, { ...base, loopOn: false }), "restart");
  assert.equal(practiceChange(base, { ...base, to: 12, speed: 0.6 }), "restart");
  assert.equal(practiceChange({ ...base, from: undefined, to: undefined }, { ...base, from: undefined, to: undefined, speed: 1 }), "resume");
});

test("practicePass：续播的后半段与完整一遍的对应部分时间一致", () => {
  const score = base;
  const plan = playbackPlan(score);
  const range = { from: 0, to: 8 };
  const full = practicePass(score, plan, range, 0.5);
  const rest = practicePass(score, plan, { from: 4, to: 8 }, 0.5);
  const offset = full.length - rest.length;
  const tail = full.notes.filter((n) => n.when >= offset - 1e-6);
  assert.equal(rest.notes.length, tail.length);
  rest.notes.forEach((n, i) => assert.ok(Math.abs(n.when + offset - tail[i].when) < 1e-6));
});

test("practice loop status says 正在循环 only while playing", () => {
  const range = { from: 0, to: 4 };
  assert.equal(
    practiceLoopStatus({ playing: false, loopOn: true, loopRange: range, label: "第 1–3 小节" }),
    "已设循环第 1–3 小节，播放时反复这一段。",
  );
  assert.match(
    practiceLoopStatus({ playing: true, loopOn: true, loopRange: range, label: "第 1–3 小节" }),
    /^正在循环第 1–3 小节/,
  );
  assert.match(
    practiceLoopStatus({ playing: false, loopOn: false, loopRange: range, label: "第 1–3 小节" }),
    /^不循环/,
  );
});

test('渐进调度：逐遍预备拍使用新档速度，目标档结束停止；暂停从原档原位置继续', async () => {
  const { playScore, isPlainPractice, resetPlaybackContextForTests } = await import('./playback.ts');
  resetPlaybackContextForTests();
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { ctx: g.AudioContext, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  let queued: (() => void) | null = null;
  g.AudioContext = FakeCtx;
  g.requestAnimationFrame = (fn: () => void) => { queued = fn; return 1; };
  g.cancelAnimationFrame = () => { queued = null; };
  try {
    const settings = { start: 50, target: 100, step: 50, repeats: 1, countEach: true };
    let completed = 0;
    const frames: { ratio: number; countIn?: number; position?: number }[] = [];
    const practice = { range: { from: 4, to: 5 }, countInBars: 1, training: { settings, completed, onProgress: (n: number) => { completed = n; } } };
    assert.equal(isPlainPractice({ training: practice.training }), false);
    const handle = playScore(base, frame => frames.push(frame), { practice });
    const step = (t: number) => { FakeCtx.current!.currentTime = t; const run = queued; queued = null; run?.(); };
    step(.56);
    assert.equal(frames.at(-1)?.countIn, 4);
    step(8.56);
    assert.ok(Math.abs((frames.at(-1)?.position ?? 0) - 4.25) < 1e-6);
    const position = frames.at(-1)!.position;
    handle.stop();
    assert.notEqual(FakeCtx.current!.state, 'closed', "stop must keep the shared context alive");
    // Reused context keeps wall-clock time; this test drives an absolute clock from 0.
    FakeCtx.current!.currentTime = 0;
    // A resumed partial pass has no new count-in and does not consume an extra repetition.
    const resumed = playScore(base, frame => frames.push(frame), { practice: { ...practice, startAt: position, training: { ...practice.training, completed } } });
    step(.56);
    assert.equal(completed, 0);
    assert.equal(frames.at(-1)?.countIn, undefined);
    assert.ok(Math.abs((frames.at(-1)?.position ?? 0) - 4.5) < 1e-6);
    step(1.6);
    assert.equal(completed, 1);
    assert.equal(frames.at(-1)?.countIn, 4, 'second stage at 100% has four seconds of count-in');
    assert.equal(frames.at(-1)?.position, 4, 'pausing during a new count-in must not resume near the old pass end');
    step(4.6);
    assert.equal(frames.at(-1)?.countIn, 1);
    step(5.7);
    assert.equal(frames.at(-1)?.countIn, undefined);
    step(6.6);
    assert.equal(completed, 2);
    assert.equal(frames.at(-1)?.ratio, 1);
    assert.equal(queued, null, 'no further pass after the target stage');
    resumed.stop();
  } finally {
    resetPlaybackContextForTests();
    g.AudioContext = saved.ctx; g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf;
  }
});
