import assert from "node:assert/strict";
import test from "node:test";
import { engraveAbc } from "./notation.ts";
import {
  gradualDashSegments,
  gradualNoteRange,
  markInsertPoint,
  markStaffAbc,
  staffGraduals,
  staffMarksScore,
} from "./staff-marks.ts";
import type { Score } from "./theory.ts";

function base(extra: Partial<Score> = {}): Score {
  return {
    title: "t", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
    notes: [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67].map((p) => ({ pitches: [p], dur: 1 })),
    ...extra,
  } as Score;
}

function engrave(score: Score) {
  const marked = staffMarksScore(score);
  return markStaffAbc(engraveAbc(marked), marked);
}

test("tempo, key and meter at one spot all reach the staff, even when imported data splits them", () => {
  const score = base({ changes: [{ at: 4, bpm: 120 }, { at: 4, key: "G", mode: "major" }, { at: 8, beats: 3, beatUnit: 4 }] });
  assert.ok(!engraveAbc(score).abc.includes("[K:G]"), "engraveAbc alone keeps only the first change at a spot");
  const { abc } = engrave(score);
  assert.match(abc, /\[K:G\]/);
  assert.match(abc, /\[Q:1\/4=120\]/);
  assert.match(abc, /\[M:3\/4\]/);
  assert.equal(score.changes!.length, 3, "the score itself is not rewritten");
  const valid = engrave(base({ changes: [{ at: 4, bpm: 120, key: "G", mode: "major" }] }));
  assert.match(valid.abc, /\[K:G\]\[Q:1\/4=120\]/);
});

test("repeat ♩= of the current tempo is not re-engraved, except where a rit. ends", () => {
  const plain = base({ changes: [{ at: 4, bpm: 80 }, { at: 8, bpm: 100 }] });
  const shown = staffMarksScore(plain);
  assert.deepEqual(shown.changes, [{ at: 8, bpm: 100 }]);
  const back = base({ changes: [{ at: 8, bpm: 80 }], gradualTempos: [{ from: 4, to: 8, kind: "rit" }] } as Partial<Score>);
  assert.deepEqual(staffMarksScore(back).changes, [{ at: 8, bpm: 80 }], "a tempo after rit. stays");
  const untouched = base({ changes: [{ at: 8, bpm: 100 }] });
  assert.equal(staffMarksScore(untouched), untouched);
});

test("fermatas engrave on notes and rests in their own voice, and clicks still map", () => {
  const score = base({
    notes: [{ pitches: [60], dur: 1 }, { pitches: [], dur: 1 }, { pitches: [64], dur: 2 }],
    voice2: [{ pitches: [48], dur: 2 }, { pitches: [43], dur: 2 }],
    fermatas: [{ voice: 0, at: 1 }, { voice: 1, at: 2 }],
  } as Partial<Score>);
  const out = engrave(score);
  assert.equal((out.abc.match(/!fermata!/g) ?? []).length, 2);
  assert.match(out.abc, /!fermata!z12/);
  const v2 = out.abc.slice(out.abc.indexOf("V:2"));
  assert.match(v2, /!fermata!G,,24/);
  for (const hit of out.hits) {
    const text = out.abc.slice(hit.start, hit.end);
    assert.match(text, /[A-Ga-gz]/, `hit still covers a note: ${text}`);
  }
  const rest = out.hits.find((hit) => (hit.voice ?? 0) === 0 && hit.index === 1)!;
  assert.ok(out.abc.slice(rest.start, rest.end).startsWith("!fermata!"));
});

test("rit. text sits on the first note and the char span reaches the last note before `to`", () => {
  const score = base({ gradualTempos: [{ from: 5, to: 8, kind: "rit" }, { from: 9, to: 11, kind: "accel" }] } as Partial<Score>);
  const out = engrave(score);
  assert.match(out.abc, /"\^rit\."A12/);
  assert.match(out.abc, /"\^accel\."B12/);
  assert.equal(out.graduals.length, 2);
  const [rit] = out.graduals;
  assert.ok(out.abc.slice(rit.start, rit.end).startsWith('"^rit."A12'));
  assert.ok(out.abc.slice(rit.start, rit.end).endsWith("c12"));
  assert.deepEqual(gradualNoteRange(score.notes, { from: 5.5, to: 8 }), { first: 5, last: 7 });
  assert.equal(gradualNoteRange(score.notes, { from: 40, to: 44 }), null);
  assert.deepEqual(staffGraduals({ ...score, gradualTempos: [{ from: 2, to: 1, kind: "rit" }, { from: 0, to: 4, kind: "x" }] } as Score), []);
});

test("lower staves do not repeat ♩=, tuplet prefixes keep their place", () => {
  const score = base({
    notes: [{ pitches: [60], dur: 4 }, { pitches: [62], dur: 4 }],
    voice2: [{ pitches: [48], dur: 4 }, { pitches: [50], dur: 4 }],
    changes: [{ at: 4, bpm: 132 }],
  });
  const out = engrave(score);
  assert.equal((out.abc.match(/\[Q:/g) ?? []).length, 1);
  assert.ok(out.abc.indexOf("[Q:1/4=132]") < out.abc.indexOf("V:2"));
  for (const hit of out.hits) assert.match(out.abc.slice(hit.start, hit.end), /^[A-Ga-gz]/, "hits still line up after removing lower ♩=");
  const both = engrave(base({ fermatas: [{ voice: 0, at: 5 }], gradualTempos: [{ from: 5, to: 8, kind: "accel" }] } as Partial<Score>));
  const hit = both.hits.find((h) => h.index === 5)!;
  assert.match(both.abc.slice(hit.start, hit.end), /^(!fermata!"\^accel\."|"\^accel\."!fermata!)A12$/);
  assert.equal(markInsertPoint('x "Am"(3C4', 2), 8);
  assert.equal(markInsertPoint("C12", 0), 0);
});

test("dash segments: one per staff line, starting after the words", () => {
  const segments = gradualDashSegments(
    [
      { line: 0, left: 100, right: 110 },
      { line: 0, left: 150, right: 160 },
      { line: 1, left: 20, right: 30 },
      { line: 1, left: 60, right: 70 },
      { line: 2, left: 5, right: 8 },
    ],
    { line: 0, right: 130 },
  );
  assert.deepEqual(segments, [
    { line: 0, x1: 134, x2: 160 },
    { line: 1, x1: 20, x2: 70 },
  ]);
});
