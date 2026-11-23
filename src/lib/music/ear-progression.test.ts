import test from "node:test";
import assert from "node:assert/strict";
import {
  EAR_PROGRESSIONS,
  answerIds,
  pickProgression,
  progSummary,
  progressionChordPitches,
  progressionLabel,
  progressionPitches,
  progressionQuestionEvents,
  progressionsFor,
  cleanProgStats,
  recordProgAnswer,
  sameProgression,
} from "./ear-progression.ts";

test("progression bank covers major and minor cadences with Roman labels", () => {
  assert.ok(EAR_PROGRESSIONS.some((item) => item.id === "I-IV-V-I"));
  assert.ok(EAR_PROGRESSIONS.some((item) => item.id === "i-iv-V-i"));
  assert.equal(progressionLabel("I-V-vi-IV"), "I–V–vi–IV");
  assert.deepEqual(answerIds("major"), ["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  assert.deepEqual(answerIds("minor"), ["i", "ii°", "III", "iv", "V", "VI", "VII", "vii°"]);
});

test("pickProgression stays in the level pool and avoids repeating the last question", () => {
  assert.equal(pickProgression("basic", "major", null, () => 0), "I-V-I");
  assert.equal(pickProgression("basic", "major", "I-V-I", () => 0), "I-IV-I");
  assert.equal(pickProgression("basic", "minor", null, () => 0), "i-V-i");
  assert.equal(pickProgression("common", "major", null, () => 0), "I-V-I");
  const allMajor = progressionsFor("all", "major").map((item) => item.id);
  assert.ok(allMajor.includes("I-V-I") && allMajor.includes("iii-vi-ii-V"));
  assert.equal(pickProgression("all", "major", "I-vi-V-I", () => 0.999), "iii-vi-ii-V");
});

test("chords stay in root position with a low bass and harmonic-minor V", () => {
  assert.deepEqual(progressionChordPitches(60, "I"), [48, 60, 64, 67]);
  assert.deepEqual(progressionChordPitches(60, "V"), [55, 67, 71, 74]);
  assert.deepEqual(progressionChordPitches(60, "iv"), [53, 65, 68, 72]);
  assert.deepEqual(progressionPitches(60, ["i", "iv", "V", "i"]), [
    [48, 60, 63, 67],
    [53, 65, 68, 72],
    [55, 67, 71, 74],
    [48, 60, 63, 67],
  ]);
});

test("block events start together per chord; arpeggios rise one note at a time", () => {
  const chords = progressionPitches(60, ["I", "V", "I"]);
  const block = progressionQuestionEvents(chords, "block");
  assert.deepEqual(block.filter((e) => e.when === 0).map((e) => e.midi), [48, 60, 64, 67]);
  assert.deepEqual(block.filter((e) => e.when === 0.8).map((e) => e.midi), [55, 67, 71, 74]);
  const broken = progressionQuestionEvents(chords, "arpeggio");
  assert.ok(broken.every((e, i) => i === 0 || e.when >= broken[i - 1].when));
  assert.deepEqual(broken.slice(0, 4).map((e) => e.midi), [48, 60, 64, 67]);
  assert.ok(broken[1].when > broken[0].when);
});

test("stats ignore junk, record first-try, and summarize the weakest progression", () => {
  assert.deepEqual(
    cleanProgStats({ "I-V-I": { right: 1, total: 4 }, no: { right: 1, total: 1 }, "I-IV-I": "x" }),
    { "I-V-I": { right: 1, total: 4 } },
  );
  const once = recordProgAnswer({}, "I-V-I", true);
  const twice = recordProgAnswer(once, "I-V-I", false);
  assert.deepEqual(twice, { "I-V-I": { right: 1, total: 2 } });
  assert.equal(progSummary({}), "还没有进行记录。");
  assert.equal(progSummary(twice), "进行累计 2 题，一次答对 50%；最常错的是 I–V–I（1/2）。");
  assert.equal(
    progSummary({ "I-V-I": { right: 1, total: 1 }, "I-IV-V-I": { right: 0, total: 2 } }),
    "进行累计 3 题，一次答对 33%；最常错的是 I–IV–V–I（0/2）。",
  );
  assert.equal(sameProgression(["I", "V", "I"], ["I", "V", "I"]), true);
  assert.equal(sameProgression(["I", "IV", "I"], ["I", "V", "I"]), false);
});
