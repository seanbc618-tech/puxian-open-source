import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secondsAt } from "./playback-clock.ts";
import { isScore } from "./score-storage.ts";
import { decodeSharePayload, encodeSharePayload } from "./share-link.ts";
import type { Score, ScoreNote } from "./theory.ts";
import {
  DEFAULT_ACCEL_RATIO,
  DEFAULT_RIT_RATIO,
  clearGradualTempo,
  defaultGradualEnd,
  gradualTempoSummary,
  gradualTempos,
  hasGradualStart,
  resolveGradualTarget,
  scoreWithGradualTempo,
  setGradualTempo,
  unrollGradualTempos,
  type ScoreWithGradual,
} from "./gradual-tempo.ts";

function score(notes: ScoreNote[], extra: Partial<Score> = {}): Score {
  return {
    title: "t",
    bpm: 120,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
    ...extra,
  };
}

const n = (midi: number, dur = 1): ScoreNote => ({ pitches: [midi], dur });

describe("gradual tempos", () => {
  it("sets a rit. from a note across four beats and uses the default slower ratio", () => {
    const base = score([n(60), n(62), n(64), n(65), n(67), n(69), n(71), n(72)]);
    const next = setGradualTempo(base, { from: 2, to: 6, kind: "rit" });
    const span = gradualTempos(next)[0];
    assert.deepEqual({ from: span?.from, to: span?.to, kind: span?.kind }, { from: 2, to: 6, kind: "rit" });
    assert.equal(hasGradualStart(next, 2), true);
    assert.equal(resolveGradualTarget(next, span!), 90);
    assert.equal(DEFAULT_RIT_RATIO, 0.75);
    assert.equal(next.bpm, 120);
    assert.equal(next.changes, undefined);
    assert.equal(gradualTempoSummary(next), "第 1–2 小节 渐慢 rit. 至 ♩=90");
    assert.equal(isScore(next), true);
  });

  it("sets accel. between selected onsets with a target metronome mark", () => {
    const next = setGradualTempo(score([n(60), n(62), n(64), n(65)]), {
      from: 0,
      to: 4,
      kind: "accel",
      toBpm: 160,
    });
    const span = gradualTempos(next)[0]!;
    assert.equal(span.kind, "accel");
    assert.equal(span.toBpm, 160);
    assert.equal(resolveGradualTarget(next, span), 160);
    assert.equal(DEFAULT_ACCEL_RATIO, 4 / 3);
  });

  it("ends at the next mid-score tempo mark and uses that mark as the target", () => {
    const base = score([n(60), n(62), n(64), n(65), n(67), n(69)], {
      changes: [{ at: 3, bpm: 72 }],
    });
    assert.equal(defaultGradualEnd(base, 1, "next-mark"), 3);
    const next = setGradualTempo(base, { from: 1, to: 3, kind: "rit" });
    const span = gradualTempos(next)[0]!;
    assert.equal(span.to, 3);
    assert.equal(resolveGradualTarget(next, span), 72);
    assert.deepEqual(next.changes, [{ at: 3, bpm: 72 }]);
  });

  it("plays a smooth rit. without rewriting written durations, close to a linear-BPM integral", () => {
    const marked = setGradualTempo(score([n(60, 1), n(62, 1), n(64, 1), n(65, 1)]), {
      from: 0,
      to: 4,
      kind: "rit",
      toBpm: 60,
    });
    assert.deepEqual(marked.notes.map((note) => note.dur), [1, 1, 1, 1]);
    const timed = scoreWithGradualTempo(marked);
    assert.equal((timed as ScoreWithGradual).gradualTempos, undefined);
    assert.ok((timed.changes?.filter((change) => change.bpm !== undefined).length ?? 0) >= 4);
    const duration = secondsAt(timed, 4);
    // ∫ 60 / (120 + (60-120)*t/4) dt over 4 quarters = 4 ln 2 ≈ 2.7726 s
    const analytic = 4 * Math.log(2);
    assert.ok(Math.abs(duration - analytic) / analytic < 0.02, `duration ${duration} vs ${analytic}`);
    assert.ok(duration > 2 + 0.2, "slower than a constant 120");
    assert.ok(duration < 4 - 0.2, "faster than a constant 60");
    // After the span the arrived tempo holds.
    const later = secondsAt(timed, 5) - secondsAt(timed, 4);
    assert.ok(Math.abs(later - 1) < 1e-6, `held ${later}`);
  });

  it("clears a span in one step and leaves mid-score tempo marks alone", () => {
    const marked = setGradualTempo(
      score([n(60, 4), n(64, 4)], { changes: [{ at: 4, bpm: 80 }] }),
      { from: 1, to: 4, kind: "rit" },
    );
    const cleared = clearGradualTempo(marked, 2);
    assert.deepEqual(gradualTempos(cleared), []);
    assert.deepEqual(cleared.changes, [{ at: 4, bpm: 80 }]);
    assert.equal((clearGradualTempo(score([n(60, 4)]), 1) as ScoreWithGradual).gradualTempos, undefined);
  });

  it("clamps the target, replaces an overlapping span, and remaps unrolled repeats", () => {
    const slow = setGradualTempo(score([n(60, 8)]), { from: 0, to: 4, kind: "rit", toBpm: 10 });
    const fast = setGradualTempo(score([n(60, 8)]), { from: 0, to: 4, kind: "accel", toBpm: 999 });
    assert.equal(gradualTempos(slow)[0]?.toBpm, 40);
    assert.equal(gradualTempos(fast)[0]?.toBpm, 220);
    const replaced = setGradualTempo(slow, { from: 2, to: 6, kind: "accel", ratio: 1.5 });
    assert.deepEqual(
      gradualTempos(replaced).map((span) => ({ from: span.from, to: span.to, kind: span.kind })),
      [{ from: 2, to: 6, kind: "accel" }],
    );
    const moved = unrollGradualTempos(gradualTempos(replaced), [
      { at: 0, from: 0, to: 4 },
      { at: 4, from: 0, to: 4 },
    ]);
    assert.deepEqual(
      moved?.map((span) => ({ from: span.from, to: span.to })),
      [
        { from: 2, to: 4 },
        { from: 6, to: 8 },
      ],
    );
  });

  it("keeps gradualTempos on a share link without changing isScore", () => {
    const marked = setGradualTempo(score([n(60), n(62), n(64), n(65)]), {
      from: 1,
      to: 3,
      kind: "rit",
      ratio: 0.5,
    });
    const back = decodeSharePayload(encodeSharePayload(marked));
    assert.ok(back && isScore(back));
    assert.deepEqual(gradualTempos(back!), gradualTempos(marked));
  });
});
