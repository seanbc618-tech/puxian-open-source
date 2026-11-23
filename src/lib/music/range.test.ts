import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { engraveAbc } from "./notation.ts";
import {
  outOfRangeHeadNames,
  outOfRangePitches,
  rangeNotice,
  writtenRangeOf,
  type RangeHit,
} from "./range.ts";
import { INSTRUMENTS, transposeScore, type Score, type ScoreNote } from "./theory.ts";

function n(pitches: number[]): ScoreNote {
  return { pitches, dur: 1 };
}

function asScore(notes: ScoreNote[]): Score {
  return {
    title: "试",
    bpm: 88,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
  };
}

describe("written ranges", () => {
  it("gives every named horn a student range and leaves 原调 unchecked", () => {
    assert.equal(writtenRangeOf("concert"), null);
    assert.deepEqual(writtenRangeOf("bb"), { low: 52, high: 84, label: "E3–C6" });
    assert.deepEqual(writtenRangeOf("trumpet"), { low: 54, high: 84, label: "F#3–C6" });
    assert.deepEqual(writtenRangeOf("eb"), { low: 58, high: 89, label: "Bb3–F6" });
    assert.deepEqual(writtenRangeOf("f"), { low: 55, high: 84, label: "G3–C6" });
    assert.deepEqual(writtenRangeOf("a"), { low: 52, high: 84, label: "E3–C6" });
    for (const item of INSTRUMENTS) {
      const range = writtenRangeOf(item.id);
      if (item.id === "concert") assert.equal(range, null);
      else assert.ok(range && range.low < range.high);
    }
  });
});

describe("out of range pitches", () => {
  it("flags nothing when 小星星 sits inside every horn's written range", () => {
    const notes = scoreFromExample(EXAMPLES[0]).notes;
    for (const item of INSTRUMENTS) {
      assert.deepEqual(outOfRangePitches(notes, item.id), [], item.id);
    }
  });

  it("flags one note above the written range and one note below it", () => {
    const above = outOfRangePitches([n([60]), n([83])], "bb");
    assert.deepEqual(above, [{ index: 1, pitchIndexes: [0] }]);

    const below = outOfRangePitches([n([49]), n([60])], "bb");
    assert.deepEqual(below, [{ index: 0, pitchIndexes: [0] }]);

    const edges = outOfRangePitches([n([50]), n([82])], "bb");
    assert.deepEqual(edges, []);
  });

  it("checks Bb and Eb written pitch, not the sounding concert pitch", () => {
    const trumpetIn = outOfRangePitches([n([52])], "trumpet");
    assert.deepEqual(trumpetIn, []);
    const trumpetOut = outOfRangePitches([n([83])], "trumpet");
    assert.deepEqual(trumpetOut, [{ index: 0, pitchIndexes: [0] }]);

    const saxIn = outOfRangePitches([n([49])], "eb");
    assert.deepEqual(saxIn, []);
    const saxOut = outOfRangePitches([n([81])], "eb");
    assert.deepEqual(saxOut, [{ index: 0, pitchIndexes: [0] }]);
  });

  it("detects only the out-of-range tone in a chord", () => {
    const high = outOfRangePitches([n([60, 64, 96])], "bb");
    assert.deepEqual(high, [{ index: 0, pitchIndexes: [2] }]);

    const low = outOfRangePitches([n([40, 60, 64])], "bb");
    assert.deepEqual(low, [{ index: 0, pitchIndexes: [0] }]);

    const unsorted = outOfRangePitches([n([96, 60])], "bb");
    assert.deepEqual(unsorted, [{ index: 0, pitchIndexes: [0] }]);

    const inside = outOfRangePitches([n([60, 64, 67])], "bb");
    assert.deepEqual(inside, []);
  });

  it("skips rests and does not flag 原调", () => {
    assert.deepEqual(outOfRangePitches([n([]), n([60])], "bb"), []);
    assert.deepEqual(outOfRangePitches([n([21]), n([108])], "concert"), []);
  });

  it("spells an out-of-range chord tone the way the staff does", () => {
    const chord = n([60, 64, 96]);
    const hit = outOfRangePitches([chord], "bb")[0];
    const names = outOfRangeHeadNames(chord, hit.pitchIndexes, "bb", "C", "major");
    const abc = engraveAbc(asScore([chord]), 2).abc;
    assert.equal(names.length, 1);
    assert.ok(abc.includes(names[0]), names[0]);

    const lowF = n([51]);
    const natural = outOfRangeHeadNames(lowF, [0], "trumpet", "C", "major");
    const trumpetAbc = engraveAbc(asScore([lowF]), 2).abc;
    assert.equal(natural.length, 1);
    assert.match(natural[0], /^=F/);
    assert.ok(trumpetAbc.includes(natural[0]), natural[0]);
  });

  it("flags the low tonics after 小星星 drops an octave", () => {
    const low = transposeScore(scoreFromExample(EXAMPLES[0]), -12);
    const hits = outOfRangePitches(low.notes, "bb");
    const flagged = new Set(hits.map((hit) => hit.index));
    assert.ok(hits.length > 0);
    low.notes.forEach((note, index) => {
      const out = note.pitches.some((pitch) => pitch + 2 < 52 || pitch + 2 > 84);
      assert.equal(flagged.has(index), out, `note ${index}`);
      if (out) {
        const hit = hits.find((item) => item.index === index) as RangeHit;
        assert.deepEqual(
          hit.pitchIndexes,
          note.pitches.flatMap((pitch, pitchIndex) =>
            pitch + 2 < 52 || pitch + 2 > 84 ? [pitchIndex] : [],
          ),
        );
      }
    });
  });
});

describe("range notice", () => {
  it("counts out-of-range pitches in Chinese and stays quiet when none are out", () => {
    assert.equal(rangeNotice(0, "降B单簧管", "E3–C6"), null);
    assert.equal(
      rangeNotice(3, "降B单簧管", "E3–C6"),
      "有 3 个音超出降B单簧管的常用音域（记谱 E3–C6）。",
    );
  });
});
