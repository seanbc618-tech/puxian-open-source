import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Score } from "./theory.ts";

/** A short audible phrase used as a generic second song, not a particular official example. */
const phrase: Score = {
  title: "phrase",
  bpm: 120,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [
    { pitches: [62], dur: 1 },
    { pitches: [64], dur: 1 },
  ],
};

class FakeParam {
  setValueAtTime() {}
  cancelScheduledValues() {}
  exponentialRampToValueAtTime() {}
  value = 0;
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "";
  pan = new FakeParam();
  Q = { value: 0 };
  connect() {}
  disconnect() {}
  start(when: number) {
    const ctx = SuspendedCtx.current;
    if (!ctx) return;
    ctx.starts.push({ when, state: ctx.state });
  }
  stop() {}
}

type Start = { when: number; state: string };

class SuspendedCtx {
  static current: SuspendedCtx | null = null;
  static created = 0;
  currentTime = 0;
  state = "suspended";
  destination = {};
  starts: Start[] = [];
  closed = false;
  /** "pending" (default), "never", or "reject" */
  resumeMode: "pending" | "never" | "reject" = "pending";
  private waiters: Array<() => void> = [];
  private listeners = new Map<string, Array<() => void>>();
  constructor() {
    SuspendedCtx.created += 1;
    SuspendedCtx.current = this;
  }
  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((listener) => listener !== fn),
    );
  }
  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  resume() {
    if (this.resumeMode === "never") return new Promise<void>(() => {});
    if (this.resumeMode === "reject") return Promise.reject(new Error("resume failed"));
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        if (this.state === "closed") return resolve();
        this.becomeRunning();
        resolve();
      });
    });
  }
  /** Complete the pending resume(), as the browser would after the context actually starts. */
  releaseResume() {
    const pending = this.waiters.splice(0);
    for (const done of pending) done();
  }
  /** Safari may start the context without ever settling resume(). */
  becomeRunning() {
    if (this.state === "closed") return;
    this.state = "running";
    this.emit("statechange");
  }
  close() {
    this.state = "closed";
    this.closed = true;
    this.emit("statechange");
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createStereoPanner() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const saved = {
  ctx: g.AudioContext,
  raf: g.requestAnimationFrame,
  caf: g.cancelAnimationFrame,
};
let queued: (() => void) | null = null;

function install() {
  SuspendedCtx.current = null;
  SuspendedCtx.created = 0;
  queued = null;
  g.AudioContext = SuspendedCtx;
  g.requestAnimationFrame = (fn: () => void) => {
    queued = fn;
    return 1;
  };
  g.cancelAnimationFrame = () => {
    queued = null;
  };
}

async function restore() {
  const imported = await import("./playback.ts");
  imported.resetPlaybackContextForTests?.();
  g.AudioContext = saved.ctx;
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
}

afterEach(restore);

test("playScore waits until the context is running before scheduling, including a second play after a natural end", async () => {
  install();
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();

  const first = playScore(phrase, () => {});
  const ctx1 = SuspendedCtx.current!;
  assert.equal(ctx1.state, "suspended");
  assert.equal(ctx1.starts.length, 0, "must not schedule tones while the context is still suspended");
  ctx1.releaseResume();
  await Promise.resolve();
  assert.equal(ctx1.state, "running");
  assert.ok(
    ctx1.starts.length > 0 && ctx1.starts.every((start) => start.state === "running"),
    `scheduled ${ctx1.starts.length} starts, states: ${ctx1.starts.map((s) => s.state).join(",")}`,
  );
  first.stop();
  assert.notEqual(ctx1.state, "closed", "stop must silence playback without closing the shared context");
  assert.equal(ctx1.closed, false);

  const startsAfterFirst = ctx1.starts.length;
  const second = playScore(phrase, () => {});
  const ctx2 = SuspendedCtx.current!;
  assert.equal(ctx2, ctx1, "later plays must reuse the shared context");
  assert.equal(SuspendedCtx.created, 1);
  assert.equal(ctx2.state, "running");
  // Already running: schedule synchronously.
  assert.ok(ctx2.starts.length > startsAfterFirst, "second play after stop must still produce scheduled notes");
  second.stop();
  assert.notEqual(ctx2.state, "closed");
});

test("stopping before the context is running does not schedule later", async () => {
  install();
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  const handle = playScore(phrase, () => {});
  const ctx = SuspendedCtx.current!;
  handle.stop();
  ctx.releaseResume();
  await Promise.resolve();
  ctx.becomeRunning();
  await Promise.resolve();
  assert.equal(ctx.starts.length, 0);
  assert.notEqual(ctx.state, "closed", "stop must not close the shared context");
});

function installMode(mode: "pending" | "never" | "reject") {
  install();
  const g2 = globalThis as unknown as Record<string, unknown>;
  g2.AudioContext = class extends SuspendedCtx {
    constructor() {
      super();
      this.resumeMode = mode;
    }
  };
}

test("a resume() that never settles still schedules once the context becomes running", async () => {
  installMode("never");
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  const hung = playScore(phrase, () => {});
  const ctxHung = SuspendedCtx.current!;
  assert.equal(ctxHung.state, "suspended");
  assert.equal(ctxHung.starts.length, 0);
  // Promise never settles. The browser may still transition to running.
  ctxHung.becomeRunning();
  await Promise.resolve();
  assert.equal(ctxHung.state, "running");
  assert.ok(
    ctxHung.starts.length > 0 && ctxHung.starts.every((start) => start.state === "running"),
    "must not hang forever if resume() never settles; statechange-to-running should arm sound",
  );
  hung.stop();
  assert.notEqual(ctxHung.state, "closed");
});

test("a rejected resume() still schedules once the context becomes running", async () => {
  installMode("reject");
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  const handle = playScore(phrase, () => {});
  const ctx = SuspendedCtx.current!;
  await Promise.resolve();
  assert.equal(ctx.starts.length, 0, "must not schedule while still suspended, even if resume rejected");
  ctx.becomeRunning();
  await Promise.resolve();
  assert.ok(ctx.starts.length > 0, "resume() rejection must not drop the only path to sound");
  handle.stop();
  assert.notEqual(ctx.state, "closed");
});

test("playPractice also arms after a hung resume once the context is running", async () => {
  installMode("never");
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  const handle = playScore(phrase, () => {}, { practice: { speed: 0.8 } });
  const ctx = SuspendedCtx.current!;
  assert.equal(ctx.starts.length, 0);
  ctx.becomeRunning();
  await Promise.resolve();
  assert.ok(ctx.starts.length > 0, "practice path must use the same running-context arming");
  handle.stop();
  assert.notEqual(ctx.state, "closed");
});

/** Multi-voice phrase shaped like a large example: opening rest, another voice sounding at once, a late long rest. */
const layered: Score = {
  title: "layered",
  bpm: 100,
  beats: 4,
  beatUnit: 4,
  key: "E",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [
    { pitches: [], dur: 1 },
    { pitches: [73], dur: 0.333333333 },
    { pitches: [76], dur: 0.333333333 },
    { pitches: [78], dur: 1 },
  ],
  voice2: [
    { pitches: [61], dur: 0.333333333 },
    { pitches: [64], dur: 0.333333333 },
    { pitches: [66], dur: 2 },
  ],
  extraVoices: [
    [
      { pitches: [], dur: 8 },
      { pitches: [54], dur: 2 },
    ],
    [
      { pitches: [], dur: 40 },
      { pitches: [52], dur: 1 },
    ],
  ],
};

test("a multi-voice score with an opening rest still schedules audible starts within the first second", async () => {
  install();
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();
  const handle = playScore(layered, () => {});
  const ctx = SuspendedCtx.current!;
  ctx.becomeRunning();
  await Promise.resolve();
  assert.ok(ctx.starts.length > 0, "must schedule the already-sounding inner voices, not wait on a later voice");
  const early = ctx.starts.filter((start) => start.when < 1);
  assert.ok(early.length > 0, `expected starts inside the first second, got ${ctx.starts.map((s) => s.when).join(",")}`);
  handle.stop();
  assert.notEqual(ctx.state, "closed");
});

test("after stop, playing a different multi-voice score on the shared context still schedules starts", async () => {
  install();
  const { playScore, resetPlaybackContextForTests } = await import("./playback.ts");
  resetPlaybackContextForTests();

  const first = playScore(phrase, () => {});
  const ctx = SuspendedCtx.current!;
  ctx.becomeRunning();
  await Promise.resolve();
  assert.ok(ctx.starts.length > 0);
  first.stop();
  assert.notEqual(ctx.state, "closed");

  const startsAfterStop = ctx.starts.length;
  const second = playScore(layered, () => {});
  assert.equal(SuspendedCtx.current, ctx, "song switch must reuse the shared context");
  assert.equal(ctx.state, "running");
  assert.ok(ctx.starts.length > startsAfterStop, "next play after stop must still produce scheduled notes");
  const newStarts = ctx.starts.slice(startsAfterStop);
  assert.ok(
    newStarts.some((start) => start.when < 1),
    "the next score must be audible within the first second, including after a previous stop",
  );
  second.stop();
  assert.notEqual(ctx.state, "closed");
});
