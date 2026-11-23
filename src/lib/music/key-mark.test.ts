import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stateAt } from "./score-timeline.ts";
import { transposeScore, type Score, type ScoreNote } from "./theory.ts";
import {
  barNumberAt,
  barStartAt,
  clearKeyChange,
  hasKeyMark,
  keyAt,
  keyBefore,
  keyMarkLabel,
  keyMarkSummary,
  keyMarks,
  setKeyChange,
} from "./key-mark.ts";

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

describe("key marks", () => {
  it("sets a mid-score key on the bar that holds the note, and earlier bars keep the old key", () => {
    const base = score([n(60), n(62), n(64), n(65), n(67), n(69), n(71), n(72)]);
    const next = setKeyChange(base, 5, "G", "major");
    assert.equal(barStartAt(base, 5), 4);
    assert.deepEqual(keyMarks(next), [{ at: 4, key: "G", mode: "major" }]);
    assert.equal(hasKeyMark(next, 4), true);
    assert.equal(hasKeyMark(next, 5), false);
    assert.deepEqual(keyAt(next, 3.9), { key: "C", mode: "major" });
    assert.deepEqual(keyAt(next, 4), { key: "G", mode: "major" });
    assert.equal(next.key, "C");
    assert.equal(next.mode, "major");
    assert.equal(stateAt(next, 5).key, "G");
    assert.equal(keyMarkLabel("G"), "1=G");
  });

  it("writes the opening key when the mark sits in the first bar, and never stores a change at 0", () => {
    const next = setKeyChange(score([n(60, 4)]), 2, "F", "minor");
    assert.equal(next.key, "F");
    assert.equal(next.mode, "minor");
    assert.equal(next.changes, undefined);
    assert.deepEqual(keyAt(next, 0), { key: "F", mode: "minor" });
    assert.equal(hasKeyMark(next, 0), false);
    const cleared = clearKeyChange(next, 0);
    assert.equal(cleared.key, "F");
    assert.equal(cleared.mode, "minor");
  });

  it("merges with a tempo or meter change at the same position, and clear keeps those fields", () => {
    const base = score([n(60, 4), n(64, 4)], {
      changes: [{ at: 4, bpm: 88, beats: 3, beatUnit: 4 }],
    });
    const marked = setKeyChange(base, 4, "G", "major");
    assert.deepEqual(marked.changes, [{ at: 4, bpm: 88, beats: 3, beatUnit: 4, key: "G", mode: "major" }]);
    const cleared = clearKeyChange(marked, 4);
    assert.deepEqual(cleared.changes, [{ at: 4, bpm: 88, beats: 3, beatUnit: 4 }]);
    const onlyKey = clearKeyChange(setKeyChange(score([n(60, 8)]), 4, "G", "major"), 4);
    assert.equal(onlyKey.changes, undefined);
  });

  it("clears a restated key that already matches the previous bar, and summarizes by bar", () => {
    const withMark = setKeyChange(score([n(60, 4), n(64, 4)]), 4, "G", "major");
    assert.equal(barNumberAt(withMark, 4), 2);
    assert.equal(keyMarkSummary(withMark), "第 2 小节 1=G（大调）");
    const restated = setKeyChange(withMark, 4, "C", "major");
    assert.equal(restated.changes, undefined);
    assert.deepEqual(keyBefore(withMark, 4), { key: "C", mode: "major" });
    assert.equal(keyMarkSummary(score([n(60, 4)])), "");
  });

  it("transposes mid-score keys with the score, and spells accidentals as 1=♭E", () => {
    const base = setKeyChange(score([n(60, 4), n(64, 4)]), 4, "F", "major");
    const up = transposeScore(base, 2);
    assert.equal(up.key, "D");
    assert.deepEqual(keyMarks(up), [{ at: 4, key: "G", mode: "major" }]);
    assert.equal(keyMarkLabel("Eb"), "1=♭E");
  });
});
