/**
 * Random rhythm drills for 拍节奏 (Rhythm Randomizer idea: a short generated
 * pattern in the current meter, independent of the song's written notes).
 * Playback and grading stay in rhythm-tap; this file only builds the pattern.
 */
import type { Score } from "./theory.ts";

export type RhythmEvent = { dur: number; rest: boolean };
export type RhythmQuiz = {
  seed: number;
  beats: number;
  beatUnit: number;
  bars: number;
  /** Events in quarter notes, never crossing a barline. */
  events: RhythmEvent[];
};

export const QUIZ_BARS = 2;
const ATOM = 0.5;
const MAX_TRIES = 32;

/** Unsigned 32-bit LCG; returns the next seed and a unit interval. */
export function stepSeed(seed: number): { seed: number; unit: number } {
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return { seed: next, unit: next / 0x100000000 };
}

function pick<T>(seed: number, items: readonly T[]): { seed: number; item: T } {
  const step = stepSeed(seed);
  return { seed: step.seed, item: items[Math.min(items.length - 1, Math.floor(step.unit * items.length))]! };
}

function barQuarters(beats: number, beatUnit: number): number {
  const unit = Number.isFinite(beatUnit) && beatUnit > 0 ? beatUnit : 4;
  const count = Number.isFinite(beats) && beats > 0 ? beats : 4;
  return count * (4 / unit);
}

function fillBar(seed: number, quarters: number): { seed: number; events: RhythmEvent[] } {
  const atoms = Math.max(1, Math.round(quarters / ATOM));
  const events: RhythmEvent[] = [];
  let i = 0;
  let current = seed;
  while (i < atoms) {
    const left = atoms - i;
    const options: RhythmEvent[] = [{ dur: ATOM, rest: false }];
    if (left >= 2) options.push({ dur: 2 * ATOM, rest: false });
    if (i > 0) options.push({ dur: ATOM, rest: true });
    if (i > 0 && left >= 2) options.push({ dur: 2 * ATOM, rest: true });
    const chosen = pick(current, options);
    current = chosen.seed;
    events.push(chosen.item);
    i += Math.round(chosen.item.dur / ATOM);
  }
  return { seed: current, events };
}

function sounding(events: readonly RhythmEvent[]): number {
  return events.filter((event) => !event.rest).length;
}

function interesting(events: readonly RhythmEvent[]): boolean {
  if (sounding(events) < 4) return false;
  return events.some((event) => event.rest) || events.some((event) => Math.abs(event.dur - ATOM) < 1e-9);
}

export function generateRhythmQuiz(options: {
  seed: number;
  beats: number;
  beatUnit: number;
  bars?: number;
}): RhythmQuiz {
  const beats = Number.isFinite(options.beats) && options.beats > 0 ? Math.round(options.beats) : 4;
  const beatUnit = Number.isFinite(options.beatUnit) && options.beatUnit > 0 ? Math.round(options.beatUnit) : 4;
  const bars = Math.max(1, Math.min(4, Math.round(options.bars ?? QUIZ_BARS)));
  const length = barQuarters(beats, beatUnit);
  let seed = options.seed >>> 0 || 1;
  let events: RhythmEvent[] = [];
  let used = seed;
  for (let tryNo = 0; tryNo < MAX_TRIES; tryNo += 1) {
    events = [];
    used = (seed + tryNo) >>> 0 || 1;
    for (let bar = 0; bar < bars; bar += 1) {
      const filled = fillBar(used, length);
      used = filled.seed;
      events.push(...filled.events);
    }
    if (interesting(events)) break;
  }
  return { seed: options.seed >>> 0 || 1, beats, beatUnit, bars, events };
}

/** One synthetic score so rhythmExercise can build clicks, count-in and targets. */
export function quizToScore(quiz: RhythmQuiz, bpm: number): Score {
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return {
    title: "随机节奏题",
    bpm: tempo,
    beats: quiz.beats,
    beatUnit: quiz.beatUnit,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes: quiz.events.map((event) => ({ pitches: event.rest ? [] : [67], dur: event.dur })),
  };
}

export function quizBarLength(quiz: Pick<RhythmQuiz, "beats" | "beatUnit">): number {
  return barQuarters(quiz.beats, quiz.beatUnit);
}

/** Tokens for the on-screen row and tests: 拍 / 休, grouped by bar. */
export function quizTokens(quiz: RhythmQuiz): { label: "拍" | "休"; dur: number; bar: number }[] {
  const length = quizBarLength(quiz);
  const tokens: { label: "拍" | "休"; dur: number; bar: number }[] = [];
  let at = 0;
  for (const event of quiz.events) {
    const bar = Math.min(quiz.bars, Math.floor((at + 1e-6) / length) + 1);
    tokens.push({ label: event.rest ? "休" : "拍", dur: event.dur, bar });
    at += event.dur;
  }
  return tokens;
}

export function quizText(quiz: RhythmQuiz): string {
  const tokens = quizTokens(quiz);
  const parts: string[] = [];
  let bar = 1;
  for (const token of tokens) {
    if (token.bar !== bar) {
      parts.push("|");
      bar = token.bar;
    }
    parts.push(token.label);
  }
  return parts.join(" ");
}
