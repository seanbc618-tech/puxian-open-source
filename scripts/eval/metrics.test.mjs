import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "./common.mjs";
const n = (pitch, start, dur = 1) => ({ pitch, start, dur });
test("missing bar and extra tail are counted; insertion does not shift later matches", () => {
  const truth = [n(60, 0), n(62, 1), n(64, 4), n(65, 5)];
  const result = compare(
    truth,
    [n(60, 0), n(61, 0.5), n(62, 1), n(64, 4), n(65, 5), n(67, 8)],
    [4, 8],
  );
  assert.equal(result.pitchCorrect, 4);
  assert.equal(result.denominator, 6);
  assert.deepEqual(
    result.bars.map((b) => b.edits),
    [1, 1],
  );
  assert.deepEqual(
    compare(truth, [], [4, 8]).bars.map((b) => b.usable),
    [false, false],
  );
});
test("duplicate output cannot reuse one reference note; wrong pitch and duration are separate", () => {
  const result = compare([n(60, 0)], [n(60, 0), n(60, 0)], [4]);
  assert.equal(result.exactCorrect, 1);
  assert.equal(result.denominator, 2);
  const wrong = compare([n(60, 0)], [n(61, 0, 2)], [4]);
  assert.equal(wrong.onsetCorrect, 1);
  assert.equal(wrong.pitchCorrect, 0);
  assert.equal(wrong.durationCorrect, 0);
  assert.equal(wrong.bars[0].strict, false);
});
import { readMidi, synthesize } from "../../eval/synthesis.mjs";
test("known single-note SMF decodes tempo, onset and note-off before waveform synthesis", () => {
  const midi = Buffer.from([
    77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 19, 0, 255, 81, 3,
    7, 161, 32, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0,
  ]);
  const parsed = readMidi(midi);
  assert.equal(parsed.quarter, 0.5);
  assert.deepEqual(parsed.notes, [{ pitch: 60, start: 0, velocity: 100, dur: 0.5 }]);
  const wav = synthesize(parsed.notes, 0.5, "clean");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.ok(wav.subarray(44).some((x) => x !== 0));
  assert.deepEqual(synthesize(parsed.notes, 0.5, "noise"), synthesize(parsed.notes, 0.5, "noise"));
});
