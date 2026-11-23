/**
 * 拍节奏: tap the written rhythm of a few bars along with the beat, then see each note
 * marked 准 / 偏早 / 偏晚 / 漏拍. Pure timing and grading; the component owns the audio.
 * Times are seconds from the first beat of the range, already divided by the practice speed.
 */
import { scheduleBeats, secondsAt } from "./playback-clock.ts";
import { SPEED_MAX, SPEED_MIN, barStarts, type LoopRange } from "./practice.ts";
import { meterAt, stateAt } from "./score-timeline.ts";
import type { Score } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";

export const RHYTHM_DEFAULT_BARS = 4;
/** |offset| at or under this is 准. */
export const RHYTHM_GOOD_S = 0.07;
/** A tap further than this from every note is 多拍, and the note is 漏拍. */
export const RHYTHM_WINDOW_S = 0.2;

type Timeline = Pick<Score, "notes" | "voice2" | "extraVoices" | "bpm" | "beats" | "beatUnit" | "key" | "mode" | "changes">;

export type RhythmTarget = { at: number; note: number; bar: number };
export type RhythmClick = { when: number; accent: boolean };
export type RhythmExercise = {
  range: LoopRange;
  /** 1-based first and last bar. */
  bars: [number, number];
  /** Count-in clicks before 0 (negative times), one bar. */
  countIn: RhythmClick[];
  /** Beat clicks inside the range. */
  clicks: RhythmClick[];
  /** Voice 1 note starts (rests skipped). */
  targets: RhythmTarget[];
  /** Seconds from 0 to the end of the range. */
  length: number;
};

/** The A-B loop when one is set, else the first few bars. */
export function rhythmRange(score: Timeline, loop: LoopRange | null, bars = RHYTHM_DEFAULT_BARS): LoopRange {
  const total = scoreQuarters(score);
  if (loop && loop.to > loop.from && loop.from < total) return { from: loop.from, to: Math.min(loop.to, total) };
  const starts = barStarts(score);
  return { from: 0, to: starts[bars] ?? total };
}

export function rhythmExercise(score: Score, range: LoopRange, speed = 1): RhythmExercise {
  // Same clamp as playback (playbackSpeed); spelled out so the first-screen chunk exports nothing new.
  const rate = Number.isFinite(speed) ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed)) : 1;
  const origin = secondsAt(score, range.from);
  const time = (q: number) => (secondsAt(score, q) - origin) / rate;
  const starts = barStarts(score);
  const barAt = (q: number) => {
    let bar = 1;
    for (let i = 0; i < starts.length; i += 1) if (q >= starts[i] - 1e-6) bar = i + 1;
    return bar;
  };
  const targets: RhythmTarget[] = [];
  let at = 0;
  score.notes.forEach((note, index) => {
    if (note.pitches.length && at >= range.from - 1e-6 && at < range.to - 1e-6) targets.push({ at: time(at), note: index, bar: barAt(at) });
    at += Number.isFinite(note.dur) ? note.dur : 0;
  });
  const clicks = scheduleBeats({ changes: score.changes, bpm: score.bpm, beats: score.beats, beatUnit: score.beatUnit, quarters: scoreQuarters(score) })
    .filter((click) => click.quarter >= range.from - 1e-6 && click.quarter < range.to - 1e-6)
    .map((click) => ({ when: time(click.quarter), accent: click.accent }));
  const meter = meterAt(score, range.from);
  // One beat at the tempo where the range starts (secondsAt with no changes = quarterSeconds × length).
  const beat = secondsAt({ bpm: stateAt(score, range.from).bpm }, 4 / meter.beatUnit) / rate;
  const count = Math.max(1, Math.round(meter.beats));
  const countIn = Array.from({ length: count }, (_, i) => ({ when: (i - count) * beat, accent: i === 0 }));
  return { range, bars: [barAt(range.from), barAt(range.to - 1e-3)], countIn, clicks, targets, length: time(range.to) };
}

export type RhythmVerdict = "good" | "early" | "late" | "miss";
export type RhythmMark = { target: RhythmTarget; verdict: RhythmVerdict; /** tap − note, seconds; absent when missed. */ offset?: number };
export type RhythmResult = { marks: RhythmMark[]; extra: number[] };

/**
 * Matches taps to notes in time order: each note takes the nearest unused tap inside its
 * window (never past halfway to a neighbouring note), so one tap cannot count twice.
 */
export function gradeTaps(targets: readonly RhythmTarget[], taps: readonly number[], good = RHYTHM_GOOD_S, window = RHYTHM_WINDOW_S): RhythmResult {
  const sorted = [...taps].filter(Number.isFinite).sort((a, b) => a - b);
  const used = new Set<number>();
  const marks = targets.map((target, i) => {
    const before = i > 0 ? (target.at - targets[i - 1].at) / 2 : window;
    const after = i < targets.length - 1 ? (targets[i + 1].at - target.at) / 2 : window;
    let best = -1;
    for (let k = 0; k < sorted.length; k += 1) {
      if (used.has(k)) continue;
      const offset = sorted[k] - target.at;
      if (offset < -Math.min(window, before) || offset > Math.min(window, after)) continue;
      if (best < 0 || Math.abs(offset) < Math.abs(sorted[best] - target.at)) best = k;
    }
    if (best < 0) return { target, verdict: "miss" as const };
    used.add(best);
    const offset = sorted[best] - target.at;
    const verdict: RhythmVerdict = Math.abs(offset) <= good ? "good" : offset < 0 ? "early" : "late";
    return { target, verdict, offset };
  });
  return { marks, extra: sorted.filter((_, k) => !used.has(k)) };
}

const ms = (seconds: number) => Math.round(Math.abs(seconds) * 1000);

/** "准 6 · 偏早 1 · 偏晚 1 · 漏拍 0 · 多拍 0；整体偏早 18 毫秒，得分 81。" */
export function rhythmSummary(result: RhythmResult): string {
  const count = (verdict: RhythmVerdict) => result.marks.filter((mark) => mark.verdict === verdict).length;
  const good = count("good"), early = count("early"), late = count("late"), miss = count("miss");
  const hit = result.marks.filter((mark) => mark.offset != null);
  const total = result.marks.length;
  if (!total) return "这一段没有可拍的音符。";
  if (!hit.length) return `没有拍到音符（共 ${total} 个）。点「开始拍节奏」，预备拍后跟着谱子点按。`;
  const mean = hit.reduce((sum, mark) => sum + (mark.offset ?? 0), 0) / hit.length;
  const lean = ms(mean) <= 10 ? "整体很稳" : `整体偏${mean < 0 ? "早" : "晚"} ${ms(mean)} 毫秒`;
  const score = Math.max(0, Math.round(((good + 0.5 * (early + late)) / total) * 100 - result.extra.length * 5));
  return `准 ${good} · 偏早 ${early} · 偏晚 ${late} · 漏拍 ${miss} · 多拍 ${result.extra.length}；${lean}，得分 ${score}。`;
}

/** Bars with any note off, for "再练第 3 小节". */
export function weakBars(result: RhythmResult): number[] {
  return [...new Set(result.marks.filter((mark) => mark.verdict !== "good").map((mark) => mark.target.bar))].sort((a, b) => a - b);
}

/** 延迟补偿: Bluetooth output arrives late, so taps land late; this many ms are taken off each tap. */
export const LATENCY_KEY = "puxian-rhythm-latency-v1";
export const LATENCY_MIN_MS = -100;
export const LATENCY_MAX_MS = 400;
export const LATENCY_STEP_MS = 10;
/** 点按校准: this many clicks, one every CALIBRATION_GAP_S; the first two are a warm-up. */
export const CALIBRATION_CLICKS = 8;
export const CALIBRATION_GAP_S = 0.6;
export const CALIBRATION_WARMUP = 2;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function cleanLatency(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.min(LATENCY_MAX_MS, Math.max(LATENCY_MIN_MS, Math.round(n)));
}

export function readLatency(storage: Storage): number {
  try {
    return cleanLatency(storage.getItem(LATENCY_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function writeLatency(storage: Storage, ms: number): boolean {
  try {
    storage.setItem(LATENCY_KEY, String(cleanLatency(ms)));
    return true;
  } catch {
    return false;
  }
}

/** Taps moved earlier by the saved latency, ready for gradeTaps. */
export function compensate(taps: readonly number[], latencyMs: number): number[] {
  const shift = cleanLatency(latencyMs) / 1000;
  return taps.map((tap) => tap - shift);
}

/** Calibration click times, seconds from the first click. */
export function calibrationClicks(count = CALIBRATION_CLICKS, gap = CALIBRATION_GAP_S): number[] {
  return Array.from({ length: count }, (_, i) => i * gap);
}

/**
 * Latency from a calibration run: each click after the warm-up takes its nearest tap from
 * 150 ms early to 450 ms late; the median of those gaps, in ms. Null with fewer than 4 matches
 * (too few taps to trust).
 */
export function estimateLatency(clicks: readonly number[], taps: readonly number[], warmup = CALIBRATION_WARMUP): number | null {
  const sorted = [...taps].filter(Number.isFinite).sort((a, b) => a - b);
  const used = new Set<number>();
  const gaps: number[] = [];
  for (const click of clicks.slice(warmup)) {
    let best = -1;
    for (let k = 0; k < sorted.length; k += 1) {
      const gap = sorted[k] - click;
      if (used.has(k) || gap < -0.15 || gap > 0.45) continue;
      if (best < 0 || Math.abs(gap) < Math.abs(sorted[best] - click)) best = k;
    }
    if (best < 0) continue;
    used.add(best);
    gaps.push(sorted[best] - click);
  }
  if (gaps.length < 4) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length / 2;
  const median = gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
  return cleanLatency(median * 1000);
}
