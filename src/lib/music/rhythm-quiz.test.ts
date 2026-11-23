import test from "node:test";
import assert from "node:assert/strict";
import { generateRhythmQuiz, quizBarLength, quizText, quizToScore, quizTokens, stepSeed } from "./rhythm-quiz.ts";
import { rhythmExercise } from "./rhythm-tap.ts";

test("stepSeed is deterministic and stays in 0…1", () => {
  const first = stepSeed(1);
  const again = stepSeed(1);
  assert.equal(first.seed, again.seed);
  assert.equal(first.unit, again.unit);
  assert.ok(first.unit >= 0 && first.unit < 1);
  assert.notEqual(stepSeed(first.seed).seed, first.seed);
});

test("4/4 two-bar quiz fills the exact length, stays inside bars, and is stable for a seed", () => {
  const quiz = generateRhythmQuiz({ seed: 42, beats: 4, beatUnit: 4, bars: 2 });
  assert.equal(quiz.beats, 4);
  assert.equal(quiz.bars, 2);
  const total = quiz.events.reduce((sum, event) => sum + event.dur, 0);
  assert.equal(total, 8);
  assert.equal(quizBarLength(quiz), 4);
  let at = 0;
  for (const event of quiz.events) {
    const startBar = Math.floor((at + 1e-9) / 4);
    const endBar = Math.floor((at + event.dur - 1e-9) / 4);
    assert.equal(startBar, endBar, `event at ${at} spans a bar`);
    at += event.dur;
  }
  assert.ok(quiz.events.filter((event) => !event.rest).length >= 4);
  assert.deepEqual(generateRhythmQuiz({ seed: 42, beats: 4, beatUnit: 4, bars: 2 }), quiz);
  assert.notDeepEqual(
    generateRhythmQuiz({ seed: 43, beats: 4, beatUnit: 4, bars: 2 }).events,
    quiz.events,
  );
});

test("3/4 and 6/8 quizzes fill complete bars", () => {
  const triple = generateRhythmQuiz({ seed: 7, beats: 3, beatUnit: 4, bars: 2 });
  assert.equal(triple.events.reduce((sum, event) => sum + event.dur, 0), 6);
  const compound = generateRhythmQuiz({ seed: 9, beats: 6, beatUnit: 8, bars: 2 });
  assert.equal(compound.events.reduce((sum, event) => sum + event.dur, 0), 6);
});

test("quizToScore + rhythmExercise skips rests and keeps count-in", () => {
  const quiz = generateRhythmQuiz({ seed: 42, beats: 4, beatUnit: 4, bars: 2 });
  const score = quizToScore(quiz, 120);
  assert.equal(score.title, "随机节奏题");
  assert.equal(score.notes.length, quiz.events.length);
  const sounding = quiz.events.filter((event) => !event.rest).length;
  const exercise = rhythmExercise(score, { from: 0, to: 8 }, 1);
  assert.equal(exercise.targets.length, sounding);
  assert.equal(exercise.length, 4);
  assert.equal(exercise.countIn.length, 4);
  assert.equal(exercise.clicks.length, 8);
  assert.ok(exercise.targets.every((target, i) => i === 0 || target.at >= exercise.targets[i - 1]!.at));
});

test("quizText groups bars with 拍 / 休", () => {
  const quiz = generateRhythmQuiz({ seed: 42, beats: 4, beatUnit: 4, bars: 2 });
  const text = quizText(quiz);
  assert.match(text, /拍/);
  assert.match(text, /\|/);
  assert.equal(quizTokens(quiz).length, quiz.events.length);
  assert.equal(quizTokens(quiz).filter((token) => token.label === "拍").length, quiz.events.filter((event) => !event.rest).length);
});
