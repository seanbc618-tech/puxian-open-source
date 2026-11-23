import test from "node:test";
import assert from "node:assert/strict";
import { pairMarks, repeatSelection, restSelection, scaleStep, selectionRun, shiftSelection } from "./selection-edit.ts";
import type { Score, ScoreNote } from "./theory.ts";

const q = (p: number, extra: Partial<ScoreNote> = {}): ScoreNote => ({ pitches: [p], dur: 1, ...extra });
const base: Score = {
  title: "t", bpm: 90, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: [q(60), q(62), q(64), q(65), q(67), q(69), q(71), q(72)],
};

test("selectionRun needs one unbroken run", () => {
  assert.deepEqual(selectionRun([3, 1, 2]), { from: 1, to: 3 });
  assert.equal(selectionRun([1, 3]), null);
  assert.equal(selectionRun([]), null);
});

test("重复一遍: copy follows the run, becomes the selection, lyrics stay behind", () => {
  const score = { ...base, notes: base.notes.map((n, i) => (i === 0 ? { ...n, lyric: { text: "啊" } } : n)) } as Score;
  const result = repeatSelection(score, 0, [0, 1]);
  assert.ok(!("error" in result));
  assert.deepEqual(result.score.notes.map((n) => n.pitches[0]), [60, 62, 60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(result.selected, [2, 3]);
  assert.equal(result.quarters, 2);
  assert.equal(result.score.notes[2].lyric, undefined);
  assert.equal(result.score.notes[0].lyric?.text, "啊");
  assert.match((repeatSelection(base, 0, [0, 2]) as { error: string }).error, /连续/);
});

test("重复一遍 carries chord symbols and moves later marks; partial bars before marks are refused", () => {
  const score: Score = { ...base, chordSymbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }], repeats: [{ from: 4, to: 8 }] };
  const result = repeatSelection(score, 0, [0, 1, 2, 3]);
  assert.ok(!("error" in result));
  assert.deepEqual(result.score.chordSymbols, [{ at: 0, symbol: "C" }, { at: 4, symbol: "C" }, { at: 8, symbol: "G" }]);
  assert.deepEqual(result.score.repeats, [{ from: 8, to: 12 }]);
  assert.match((repeatSelection(score, 0, [0, 1]) as { error: string }).error, /整小节/);
  const jumps = repeatSelection({ ...base, jumps: { fine: 4, segno: 4, dc: 8 } }, 0, [0, 1, 2, 3]);
  assert.ok(!("error" in jumps));
  assert.deepEqual(jumps.score.jumps, { fine: 4, segno: 8, dc: 12 }, "Fine at the run's end stays with it; Segno there opens what follows");
  const closing = repeatSelection({ ...base, repeats: [{ from: 0, to: 4 }] }, 0, [0, 1, 2, 3]);
  assert.ok(!("error" in closing));
  assert.deepEqual(closing.score.repeats, [{ from: 0, to: 4 }], ":| at the run's end stays");
  // With a second voice holding time, only the edited voice changes.
  const two = repeatSelection({ ...score, voice2: [{ pitches: [48], dur: 8 }] }, 0, [0, 1]);
  assert.ok(!("error" in two));
  assert.deepEqual(two.score.chordSymbols, score.chordSymbols);
});

test("pairMarks drops a slur or hairpin that lost a partner", () => {
  const notes = pairMarks([q(60, { slurStart: true }), q(62, { slurEnd: true, slurStart: true }), q(64), q(65, { hairpinEnd: true })]);
  assert.equal(notes[0].slurStart, true);
  assert.equal(notes[1].slurEnd, true);
  assert.equal(notes[1].slurStart, undefined);
  assert.equal(notes[3].hairpinEnd, undefined);
});

test("上移/下移一级 walks the key's scale; off-scale notes snap; octave; piano edge refuses", () => {
  assert.equal(scaleStep(64, "C", "major", 1), 65);
  assert.equal(scaleStep(65, "C", "major", -1), 64);
  assert.equal(scaleStep(66, "G", "major", 1), 67);
  assert.equal(scaleStep(61, "C", "major", 1), 62, "C# snaps up to D");
  assert.equal(scaleStep(68, "A", "minor", 1), 69, "G# leading tone up to A");
  const up = shiftSelection(base.notes, [0, 2], "C", "major", "step", 1);
  assert.deepEqual(up?.map((n) => n.pitches[0]), [62, 62, 65, 65, 67, 69, 71, 72]);
  const chord = shiftSelection([{ pitches: [60, 64, 67], dur: 1, fingers: [1, 3, 5] }], [0], "C", "major", "step", 1);
  assert.deepEqual(chord?.[0], { pitches: [62, 65, 69], dur: 1, fingers: [1, 3, 5] });
  const oct = shiftSelection(base.notes, [7], "C", "major", "octave", -1);
  assert.equal(oct?.[7].pitches[0], 60);
  assert.equal(shiftSelection([q(108)], [0], "C", "major", "octave", 1), null);
  assert.equal(shiftSelection([{ pitches: [], dur: 1 }], [0], "C", "major", "step", 1), null, "rests only");
  const grace = shiftSelection([q(60, { ornament: "grace", gracePitch: 62 })], [0], "C", "major", "step", 1);
  assert.equal(grace?.[0].gracePitch, 64);
});

test("改成休止 keeps the rhythm and drops marks and lyrics", () => {
  const notes = [q(60, { slurStart: true }), q(62, { slurEnd: true, lyric: { text: "好" } as ScoreNote["lyric"] }), q(64)];
  const out = restSelection(notes, [1]);
  assert.deepEqual(out, [q(60), { pitches: [], dur: 1 }, q(64)]);
  assert.equal(restSelection([{ pitches: [], dur: 1 }], [0]), null);
});
