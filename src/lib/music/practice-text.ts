/**
 * Editor-only practice helpers: loop ranges from bars / selection, practice-change
 * classification, loop labels, the loop status line and the karaoke line.
 * Kept out of practice.ts so the home page's score chunk stays small.
 */
import { barOfQuarter, barStarts, clampSpeed, type LoopRange } from "./practice.ts";
import type { Score, ScoreNote } from "./theory.ts";
import { scoreQuarters, voiceNotes as getVoiceNotes, type VoiceId } from "./voices.ts";

const EPS = 1e-6;
type Timeline = Pick<Score, "notes" | "voice2" | "extraVoices" | "bpm" | "beats" | "beatUnit" | "key" | "mode" | "changes">;

export function describeLoop(score: Timeline, loop: LoopRange): string {
  const starts = barStarts(score);
  const first = barOfQuarter(score, loop.from);
  const last = barOfQuarter(score, loop.to - 1e-3);
  const bars = first === last ? `第 ${first} 小节` : `第 ${first}–${last} 小节`;
  const onBars = starts.some((s) => Math.abs(s - loop.from) < EPS) &&
    (starts.some((s) => Math.abs(s - loop.to) < EPS) || Math.abs(loop.to - scoreQuarters(score)) < EPS);
  return onBars ? bars : `${bars}（选中的音）`;
}

/** Status line for the practice loop. “正在循环” is only used while playing. */
export function practiceLoopStatus(input: {
  playing: boolean;
  loopOn: boolean;
  loopRange: LoopRange | null;
  label: string;
  /** Pass now playing (1-based) and pause seconds left, while a plain loop runs. */
  now?: { pass: number; rest: number } | null;
  /** Passes before stopping; 0 = until stopped. */
  times?: number;
}): string {
  if (input.loopOn && input.loopRange) {
    const of = input.times ? ` / ${input.times}` : "";
    if (input.playing && input.now?.rest) return `第 ${input.now.pass}${of} 遍练完，停 ${input.now.rest} 秒再来。`;
    if (input.playing && input.now?.pass) return `正在循环${input.label}：第 ${input.now.pass}${of} 遍，按停止结束。`;
    return input.playing
      ? `正在循环${input.label}，按停止结束。`
      : `已设循环${input.label}，播放时反复这一段${input.times ? `，练 ${input.times} 遍后停` : ""}。`;
  }
  return "不循环：从头播到尾。在谱面上点一个音、Shift 再点一个音，可以用选中的音设循环段。";
}

export type KaraokeSyllable = {
  index: number;
  text: string;
  state: "sung" | "now" | "next";
  /** Latin word continues into the next syllable (Twin-kle): no space between them. */
  joinNext: boolean;
};

/**
 * Lyric phrase (`barsPerPhrase` bars) around note `current`, each syllable marked
 * sung / now / next. Null when the voice has no lyrics.
 */
export function karaokeLine(
  notes: readonly ScoreNote[],
  timeline: Pick<Score, "beats" | "beatUnit" | "changes">,
  current: number,
  barsPerPhrase = 2,
): KaraokeSyllable[] | null {
  if (!notes.some((note) => note.lyric?.text)) return null;
  const starts: number[] = [];
  let at = 0;
  for (const note of notes) {
    starts.push(at);
    at += Number.isFinite(note.dur) ? note.dur : 0;
  }
  const score = { ...timeline, notes: notes as ScoreNote[], bpm: 60, key: "C" as const, mode: "major" as const };
  const bars = barStarts(score);
  const barOf = (q: number) => {
    let bar = 0;
    for (let i = 0; i < bars.length; i += 1) if (q >= bars[i] - EPS) bar = i;
    return bar;
  };
  // Before the first sung syllable: the opening phrase, nothing lit yet.
  const safe = current < 0 ? -1 : Math.min(current, notes.length - 1);
  const phrase = safe < 0 ? 0 : Math.floor(barOf(starts[safe]) / Math.max(1, barsPerPhrase));
  const line: KaraokeSyllable[] = [];
  notes.forEach((note, index) => {
    const text = note.lyric?.text;
    if (!text || !note.pitches.length) return;
    if (Math.floor(barOf(starts[index]) / Math.max(1, barsPerPhrase)) !== phrase) return;
    const syllabic = note.lyric?.syllabic;
    line.push({
      index,
      text,
      state: index < safe ? "sung" : index === safe ? "now" : "next",
      joinNext: syllabic === "begin" || syllabic === "middle",
    });
  });
  return line.length ? line : null;
}

/** Whole bars `a`…`b` (1-based, either order, clamped to the score). */
export function loopFromBars(score: Timeline, a: number, b: number): LoopRange | null {
  const starts = barStarts(score);
  const total = scoreQuarters(score);
  if (!(total > EPS) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = Math.round(Math.min(a, b));
  const hi = Math.round(Math.max(a, b));
  if (hi < 1) return null;
  const first = Math.min(Math.max(1, lo), starts.length);
  const last = Math.min(Math.max(1, hi), starts.length);
  return { from: starts[first - 1], to: starts[last] ?? total };
}

/** From the first selected note's start to the last selected note's end. */
export function loopFromSelection(score: Timeline, voice: VoiceId, indexes: readonly number[]): LoopRange | null {
  const notes = getVoiceNotes(score, voice);
  if (!notes || !indexes.length) return null;
  const valid = indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < notes.length);
  if (!valid.length) return null;
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  let at = 0;
  let from = 0;
  for (let i = 0; i <= hi; i += 1) {
    if (i === lo) from = at;
    at += Number.isFinite(notes[i].dur) ? notes[i].dur : 0;
  }
  return at > from + EPS ? { from, to: at } : null;
}

export type PracticeKey = { speed: number; countInBars: number; loopOn: boolean; from?: number; to?: number; loopPause?: number; loopTimes?: number };

/**
 * How a running practice playback reacts to a settings change: only the speed
 * moved → resume at the current spot without a count-in; anything else → restart.
 */
export function practiceChange(before: PracticeKey, after: PracticeKey): "none" | "resume" | "restart" {
  const same = (a?: number, b?: number) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-6);
  const layout =
    before.countInBars === after.countInBars && before.loopOn === after.loopOn &&
    (before.loopPause ?? 0) === (after.loopPause ?? 0) && (before.loopTimes ?? 0) === (after.loopTimes ?? 0) &&
    same(before.from, after.from) && same(before.to, after.to);
  if (!layout) return "restart";
  return clampSpeed(before.speed) === clampSpeed(after.speed) ? "none" : "resume";
}

/**
 * Where a resumed practice run starts: the rest of the current pass, from
 * `startAt` to the loop end. Null when `startAt` is missing, outside the loop or
 * at its very start (then a normal full pass is the same thing).
 */
export function resumeRange(range: LoopRange, startAt: number | null | undefined): LoopRange | null {
  if (startAt == null || !Number.isFinite(startAt)) return null;
  if (startAt <= range.from + 1e-3 || startAt >= range.to - 1e-3) return null;
  return { from: startAt, to: range.to };
}
