/**
 * Practice mode: A-B loop, slow-down without pitch change, count-in and the
 * karaoke lyric line. Pure timing helpers; `playScore` owns the audio device.
 */
import type { Attack, Sounding } from "./expression.ts";
import type { PlaybackPlan } from "./playback.ts";
import { quarterAtSeconds, quarterSeconds, secondsAt } from "./playback-clock.ts";
import { meterAt, nextBar, stateAt } from "./score-timeline.ts";
import type { Score } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1.2;
export const SPEED_STEP = 0.05;
export type CountInBars = 0 | 1 | 2;
export const COUNT_IN_OPTIONS: readonly CountInBars[] = [0, 1, 2];
/** Quarter-note positions; `to` is exclusive. */
export type LoopRange = { from: number; to: number };

const EPS = 1e-6;

/** 50%–120% in 5% steps. Anything that is not a number plays at 100%. */
export function clampSpeed(value: number): number {
  return Math.round(playbackSpeed(Math.round(value / SPEED_STEP) * SPEED_STEP) * 100) / 100;
}

/** Playback can use exact percentage steps during progressive training. */
export function playbackSpeed(value: number): number {
  return Number.isFinite(value) ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, value)) : 1;
}

type Timeline = Pick<Score, "notes" | "voice2" | "extraVoices" | "bpm" | "beats" | "beatUnit" | "key" | "mode" | "changes">;

/** Start of every bar that begins before the music ends (meter changes end a bar). */
export function barStarts(score: Timeline): number[] {
  const total = scoreQuarters(score);
  const starts = [0];
  let at = 0;
  for (let guard = 0; guard < 100_000; guard += 1) {
    const next = nextBar(score, at);
    if (!Number.isFinite(next) || next <= at + EPS || next >= total - EPS) break;
    starts.push(next);
    at = next;
  }
  return starts;
}

/** 1-based bar under a quarter position. */
export function barOfQuarter(score: Timeline, quarter: number): number {
  const starts = barStarts(score);
  let bar = 1;
  for (let i = 0; i < starts.length; i += 1) if (quarter >= starts[i] - EPS) bar = i + 1;
  return bar;
}

export type ScheduledTone = { midi: number; when: number; seconds: number; gain: number; attack: Attack };
export type ScheduledClick = { when: number; level: number; accent: boolean };
export type PracticePass = {
  notes: ScheduledTone[];
  clicks: ScheduledClick[];
  /** Follow windows in score quarters, original note indexes. */
  events: Sounding[];
  /** Seconds one pass lasts at this speed. */
  length: number;
};

/** One pass over [from, to) with times relative to the pass start, divided by `speed`. */
export function practicePass(score: Score, plan: PlaybackPlan, range: LoopRange, speed: number): PracticePass {
  const rate = playbackSpeed(speed);
  const origin = secondsAt(score, range.from);
  const time = (q: number) => (secondsAt(score, q) - origin) / rate;
  const events: Sounding[] = [];
  for (const event of plan.events) {
    const end = event.start + event.dur;
    if (event.start >= range.to - EPS || end <= range.from + EPS) continue;
    const start = Math.max(event.start, range.from);
    events.push({ ...event, start, dur: Math.min(end, range.to) - start });
  }
  const notes = events.map((event) => ({
    midi: event.midi,
    when: time(event.start),
    seconds: Math.max(0.04, time(event.start + event.dur) - time(event.start)),
    gain: event.gain,
    attack: event.attack,
  }));
  const clicks = plan.clicks
    .filter((click) => click.quarter >= range.from - EPS && click.quarter < range.to - EPS)
    .map((click) => ({ when: time(click.quarter), level: click.level, accent: click.accent }));
  return { notes, clicks, events, length: Math.max(0.05, time(range.to)) };
}

/** Score quarter for `seconds` into a pass. */
export function practiceQuarterAt(score: Score, range: LoopRange, speed: number, seconds: number): number {
  const rate = playbackSpeed(speed);
  return quarterAtSeconds(score, secondsAt(score, range.from) + seconds * rate);
}

/** `bars` bars of clicks in the meter and tempo at `at`, before the music starts. */
export function countInClicks(score: Pick<Score, "bpm" | "beats" | "beatUnit" | "key" | "mode" | "changes">, at: number, bars: number, speed: number) {
  const meter = meterAt(score, at);
  const bpm = stateAt(score, at).bpm;
  const beatSeconds = ((4 / meter.beatUnit) * quarterSeconds(bpm)) / playbackSpeed(speed);
  const count = Math.max(0, Math.round(bars)) * Math.max(1, Math.round(meter.beats));
  const clicks: ScheduledClick[] = Array.from({ length: count }, (_, i) => ({
    when: i * beatSeconds,
    accent: i % meter.beats === 0,
    level: i % meter.beats === 0 ? 1 : 0.6,
  }));
  return { clicks, length: count * beatSeconds, beatSeconds };
}
