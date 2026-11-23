import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextBar } from "./score-timeline.ts";
import type { Score, ScoreNote } from "./theory.ts";
import {
  CHANGE_BEATS_MAX,
  barNumberAt,
  barStartAt,
  clearMeterChange,
  hasMeterMark,
  meterAt,
  meterBefore,
  meterMarkSummary,
  meterMarks,
  setMeterChange,
} from "./meter-mark.ts";

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

describe("meter marks", () => {
  it("sets a mid-score meter on the bar that holds the note, and earlier bars keep the old meter", () => {
    const base = score([n(60), n(62), n(64), n(65), n(67), n(69), n(71), n(72)]);
    const next = setMeterChange(base, 5, 3, 4);
    assert.equal(barStartAt(base, 5), 4);
    assert.deepEqual(meterMarks(next), [{ at: 4, beats: 3, beatUnit: 4 }]);
    assert.equal(hasMeterMark(next, 4), true);
    assert.equal(hasMeterMark(next, 5), false);
    assert.deepEqual(meterAt(next, 3.9), { beats: 4, beatUnit: 4 });
    assert.deepEqual(meterAt(next, 4), { beats: 3, beatUnit: 4 });
    assert.equal(next.beats, 4);
    assert.equal(next.beatUnit, 4);
    assert.ok(Math.abs(nextBar(next, 0) - 4) < 1e-9, `bar1 ${nextBar(next, 0)}`);
    assert.ok(Math.abs(nextBar(next, 4) - 7) < 1e-9, `bar2 ${nextBar(next, 4)}`);
  });

  it("writes the opening meter when the mark sits in the first bar, and never stores a change at 0", () => {
    const next = setMeterChange(score([n(60, 4)]), 2, 3, 8);
    assert.equal(next.beats, 3);
    assert.equal(next.beatUnit, 8);
    assert.equal(next.changes, undefined);
    assert.deepEqual(meterAt(next, 0), { beats: 3, beatUnit: 8 });
    assert.equal(hasMeterMark(next, 0), false);
    const cleared = clearMeterChange(next, 0);
    assert.equal(cleared.beats, 3);
    assert.equal(cleared.beatUnit, 8);
  });

  it("clamps beats and only allows known denominators", () => {
    const wide = setMeterChange(score([n(60, 8)]), 4, 99, 5);
    const thin = setMeterChange(score([n(60, 8)]), 4, 0, 4);
    assert.deepEqual(meterMarks(wide)[0], { at: 4, beats: CHANGE_BEATS_MAX, beatUnit: 4 });
    assert.deepEqual(meterMarks(thin)[0], { at: 4, beats: 1, beatUnit: 4 });
  });

  it("merges with a tempo or key change at the same position, and clear keeps those fields", () => {
    const base = score([n(60, 4), n(64, 4)], {
      changes: [{ at: 4, bpm: 88, key: "G", mode: "major" }],
    });
    const marked = setMeterChange(base, 4, 3, 4);
    assert.deepEqual(marked.changes, [{ at: 4, bpm: 88, key: "G", mode: "major", beats: 3, beatUnit: 4 }]);
    const cleared = clearMeterChange(marked, 4);
    assert.deepEqual(cleared.changes, [{ at: 4, bpm: 88, key: "G", mode: "major" }]);
    const onlyMeter = clearMeterChange(setMeterChange(score([n(60, 8)]), 4, 3, 4), 4);
    assert.equal(onlyMeter.changes, undefined);
  });

  it("clears a restated meter that already matches the previous bar, and summarizes by bar", () => {
    const withMark = setMeterChange(score([n(60, 4), n(64, 4)]), 4, 3, 4);
    assert.equal(barNumberAt(withMark, 4), 2);
    assert.equal(meterMarkSummary(withMark), "第 2 小节 3/4");
    const restated = setMeterChange(withMark, 4, 4, 4);
    assert.equal(restated.changes, undefined);
    assert.deepEqual(meterBefore(withMark, 4), { beats: 4, beatUnit: 4 });
    assert.equal(meterMarkSummary(score([n(60, 4)])), "");
  });
});
