import assert from "node:assert/strict";
import { test } from "node:test";
import { checkScoreBars, describeBarCheck } from "./bar-check.ts";

const note = (dur: number, pitches = [60]) => ({ dur, pitches });
const score = (notes = [note(4)], voice2?: ReturnType<typeof note>[]) => ({
  beats: 4,
  beatUnit: 4,
  notes,
  voice2,
});

test("full bars and long notes crossing bars are valid; rests and chords count once", () => {
  assert.deepEqual(checkScoreBars(score([note(8)])), []);
  assert.deepEqual(checkScoreBars(score([note(1, []), note(3, [60, 64, 67])])), []);
  assert.deepEqual(checkScoreBars(score([], [])), []);
});
test("checks both independent written timelines without padding or mutation", () => {
  const input = score([note(5)], [note(2)]);
  const before = JSON.stringify(input);
  const issues = checkScoreBars(input);
  assert.deepEqual(issues, [
    { voice: 0, measure: 2, actual: 1, expected: 4, missing: 3 },
    { voice: 1, measure: 1, actual: 2, expected: 4, missing: 2 },
  ]);
  assert.equal(JSON.stringify(input), before);
  assert.match(describeBarCheck(issues[1], 4), /声部二第 1 小节.*差 2 拍/);
});
test("6/8 reports eighth-note beats; fractional durations tolerate floating error", () => {
  const issues = checkScoreBars({ ...score([note(3.5)]), beats: 6, beatUnit: 8 });
  assert.deepEqual(issues, [{ voice: 0, measure: 2, actual: 1, expected: 6, missing: 5 }]);
  assert.deepEqual(checkScoreBars(score(Array.from({ length: 12 }, () => note(1 / 3)))), []);
  assert.equal(checkScoreBars(score([note(0.75)]))[0].missing, 3.25);
});
test("empty or invalid input does not invent a bar warning", () => {
  assert.deepEqual(checkScoreBars({ ...score(), beats: NaN }), []);
  assert.deepEqual(checkScoreBars({ ...score(), beatUnit: 0 }), []);
  assert.deepEqual(checkScoreBars(score([note(NaN), note(-1), note(0)])), []);
});

test("mid-measure meter changes do not flag the short bar they close", () => {
  const score = {
    beats: 4,
    beatUnit: 4,
    notes: [{ dur: 1, pitches: [60] }, { dur: 3, pitches: [62] }],
    changes: [{ at: 1, beats: 3, beatUnit: 4 }],
  };
  assert.deepEqual(checkScoreBars(score), []);
});
