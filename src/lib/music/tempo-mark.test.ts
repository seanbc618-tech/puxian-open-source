import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secondsAt } from "./playback-clock.ts";
import type { Score, ScoreNote } from "./theory.ts";
import {
  CHANGE_BPM_MAX,
  CHANGE_BPM_MIN,
  barNumberAt,
  clearTempoChange,
  hasTempoMark,
  setTempoChange,
  tempoAt,
  tempoMarkSummary,
  tempoMarks,
} from "./tempo-mark.ts";

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

describe("tempo marks", () => {
  it("sets a mid-score tempo from a note onset and leaves earlier music at the old speed", () => {
    const base = score([n(60), n(62), n(64), n(65)]);
    const next = setTempoChange(base, 2, 60);
    assert.deepEqual(tempoMarks(next), [{ at: 2, bpm: 60 }]);
    assert.equal(hasTempoMark(next, 2), true);
    assert.equal(hasTempoMark(next, 0), false);
    assert.equal(tempoAt(next, 1.9), 120);
    assert.equal(tempoAt(next, 2), 60);
    assert.equal(next.bpm, 120);
    // Two quarters at 120 BPM are 1 s, then two at 60 BPM are 2 s.
    assert.ok(Math.abs(secondsAt(next, 2) - 1) < 1e-9, `mid ${secondsAt(next, 2)}`);
    assert.ok(Math.abs(secondsAt(next, 4) - 3) < 1e-9, `end ${secondsAt(next, 4)}`);
  });

  it("writes the opening tempo when the mark sits at the start, and never stores a change at 0", () => {
    const next = setTempoChange(score([n(60, 4)]), 0, 72);
    assert.equal(next.bpm, 72);
    assert.equal(next.changes, undefined);
    assert.equal(tempoAt(next, 0), 72);
    assert.equal(hasTempoMark(next, 0), false);
    const cleared = clearTempoChange(next, 0);
    assert.equal(cleared.bpm, 72);
  });

  it("clamps the mark to the stored mid-score tempo range", () => {
    const slow = setTempoChange(score([n(60, 4)]), 1, 10);
    const fast = setTempoChange(score([n(60, 4)]), 1, 999);
    assert.equal(tempoMarks(slow)[0]?.bpm, CHANGE_BPM_MIN);
    assert.equal(tempoMarks(fast)[0]?.bpm, CHANGE_BPM_MAX);
  });

  it("merges with a key or meter change at the same position, and clear keeps those fields", () => {
    const base = score([n(60, 2), n(64, 2)], {
      changes: [{ at: 2, beats: 3, beatUnit: 4, key: "G", mode: "major" }],
    });
    const marked = setTempoChange(base, 2, 88);
    assert.deepEqual(marked.changes, [{ at: 2, beats: 3, beatUnit: 4, key: "G", mode: "major", bpm: 88 }]);
    const cleared = clearTempoChange(marked, 2);
    assert.deepEqual(cleared.changes, [{ at: 2, beats: 3, beatUnit: 4, key: "G", mode: "major" }]);
    const onlyTempo = clearTempoChange(setTempoChange(score([n(60, 4)]), 2, 90), 2);
    assert.equal(onlyTempo.changes, undefined);
  });

  it("summarizes mid-score marks by bar and ignores the opening tempo", () => {
    const next = setTempoChange(score([n(60), n(62), n(64), n(65), n(67), n(69)]), 4, 96);
    assert.equal(barNumberAt(next, 4), 2);
    assert.equal(tempoMarkSummary(next), "第 2 小节 ♩=96");
    assert.equal(tempoMarkSummary(score([n(60, 4)])), "");
  });
});
