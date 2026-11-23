import test from "node:test";
import assert from "node:assert/strict";
import {
  CHORDS,
  chordOf,
  chordPitches,
  chordQuestionEvents,
  chordSummary,
  cleanChordStats,
  pickChord,
  pickChordRoot,
  recordChordAnswer,
} from "./ear-chord.ts";

test("chord table covers triads and common sevenths with Chinese labels", () => {
  assert.equal(CHORDS.length, 9);
  assert.deepEqual(chordOf("maj").intervals, [0, 4, 7]);
  assert.equal(chordOf("min").name, "小三和弦");
  assert.equal(chordOf("m7b5").label, "半减");
  assert.deepEqual(chordOf("dim7").intervals, [0, 3, 6, 9]);
});

test("pickChord uses the pool and avoids repeating the last question", () => {
  assert.equal(pickChord("triads", null, () => 0), "maj");
  assert.equal(pickChord("triads", "maj", () => 0), "min");
  assert.equal(pickChord("common", null, () => 0), "maj");
  assert.equal(pickChord("all", "dim7", () => 0.999), "m7b5");
});

test("roots stay in a mid range and keep written chord spellings", () => {
  assert.equal(pickChordRoot("maj", () => 0), 60);
  assert.deepEqual(chordPitches("maj", 60), [60, 64, 67]);
  assert.deepEqual(chordPitches("min", 60), [60, 63, 67]);
  assert.deepEqual(chordPitches("dom7", 60), [60, 64, 67, 70]);
  const late = pickChordRoot("maj7", () => 0.999);
  const top = chordPitches("maj7", late).at(-1)!;
  assert.ok(late >= 60 && top <= 78);
});

test("block events start together; arpeggios rise one note at a time", () => {
  const block = chordQuestionEvents([60, 64, 67], "block");
  assert.deepEqual(block.map((e) => e.when), [0, 0, 0]);
  assert.deepEqual(block.map((e) => e.midi), [60, 64, 67]);
  const broken = chordQuestionEvents([60, 64, 67, 71], "arpeggio");
  assert.deepEqual(broken.map((e) => e.midi), [60, 64, 67, 71]);
  assert.ok(broken.every((e, i) => i === 0 || e.when > broken[i - 1].when));
});

test("stats ignore junk, record first-try, and summarize the weakest chord", () => {
  assert.deepEqual(cleanChordStats({ min: { right: 1, total: 4 }, no: { right: 1, total: 1 }, maj: "x" }), { min: { right: 1, total: 4 } });
  const once = recordChordAnswer({}, "maj", true);
  const twice = recordChordAnswer(once, "maj", false);
  assert.deepEqual(twice, { maj: { right: 1, total: 2 } });
  assert.equal(chordSummary({}), "还没有和弦记录。");
  assert.equal(chordSummary(twice), "和弦累计 2 题，一次答对 50%；最常错的是 大三和弦（1/2）。");
  assert.equal(
    chordSummary({ maj: { right: 1, total: 1 }, min: { right: 0, total: 2 } }),
    "和弦累计 3 题，一次答对 33%；最常错的是 小三和弦（0/2）。",
  );
});
