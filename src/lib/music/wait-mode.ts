import type { Score } from "./theory.ts";
import { voiceList } from "./voices.ts";
import { hasPlayOrder, unrollSegments } from "./repeats.ts";
import { barStarts, type LoopRange } from "./practice.ts";
import type { PracticeHand } from "./practice-hands.ts";
import type { FollowSlot } from "./playback-clock.ts";
export type WaitTarget = { quarter: number; bar: number; pitches: number[]; slots: FollowSlot[] };
/** Written attacks, excluding rests and accompaniment. No tempo clock or ornament expansion. */
export function waitTargets(
  score: Score,
  hand: PracticeHand = "both",
  range: LoopRange | null = null,
): WaitTarget[] {
  // Repeats and D.C./D.S.: step through the played order; a practice loop uses the bars as drawn.
  if (!range && hasPlayOrder(score)) {
    const plain = { ...score, repeats: undefined, jumps: undefined };
    const spans = unrollSegments(score);
    if (spans.length > 1) return spans.flatMap((span) => waitTargets(plain, hand, span));
  }
  const groups = new Map<number, WaitTarget>();
  const voices = voiceList(score);
  const starts = barStarts(score);
  const selected = hand === "both" ? [0, 1] : [hand === "right" ? 0 : 1];
  selected.forEach((voice) => {
    const notes = voices[voice] ?? [];
    let quarter = 0;
    notes.forEach((note, index) => {
      const at = quarter;
      quarter += Number.isFinite(note.dur) ? note.dur : 0;
      if (range && (quarter <= range.from + 1e-6 || at >= range.to - 1e-6)) return;
      const attack = Math.max(at, range?.from ?? 0);
      const pitches = note.pitches.filter((p) => Number.isInteger(p) && p >= 0 && p <= 127);
      if (!pitches.length) return;
      const key = Math.round(attack * 1e6) / 1e6;
      const group = groups.get(key) ?? {
        quarter: attack,
        bar: Math.max(1, starts.filter((start) => attack >= start - 1e-6).length),
        pitches: [],
        slots: [],
      };
      group.pitches = [...new Set([...group.pitches, ...pitches])].sort((a, b) => a - b);
      group.slots.push({ voice, note: index });
      groups.set(key, group);
    });
  });
  return [...groups.values()].sort((a, b) => a.quarter - b.quarter);
}
export type WaitInput =
  | { kind: "on" | "off"; midi: number; at: number }
  | { kind: "mic"; midi: number | null; at: number };
export type WaitState = {
  index: number;
  correct: number;
  errors: number;
  errorsByBar: Record<number, number>;
  held: Record<number, number>;
  mic: { pitch: number; since: number; latched: boolean } | null;
  started: number;
  lastAt: number;
  finished: boolean;
  feedback: "correct" | "wrong" | "pending";
  played: number | null;
};
export function newWaitState(at: number): WaitState {
  return {
    index: 0,
    correct: 0,
    errors: 0,
    errorsByBar: {},
    held: {},
    mic: null,
    started: at,
    lastAt: at,
    finished: false,
    feedback: "pending",
    played: null,
  };
}
/** MIDI exact octaves + held chord attacks within 300ms. Mic ±50 cents for 80ms. */
export function acceptWaitInput(
  previous: WaitState,
  targets: readonly WaitTarget[],
  event: WaitInput,
  loop = false,
): WaitState {
  if (
    previous.finished ||
    !targets.length ||
    !Number.isFinite(event.at) ||
    event.at < previous.lastAt
  )
    return previous;
  const state: WaitState = {
    ...previous,
    held: { ...previous.held },
    lastAt: event.at,
    feedback: "pending",
  };
  const target = targets[state.index];
  if (!target) return previous;
  let matched = false,
    wrong = false;
  if (event.kind === "mic") {
    if (event.midi == null || !Number.isFinite(event.midi)) {
      state.mic = null;
      return state;
    }
    const pitch = Math.round(event.midi);
    state.played = pitch;
    if (!state.mic || state.mic.pitch !== pitch)
      state.mic = { pitch, since: event.at, latched: false };
    else state.mic = { ...state.mic };
    if (state.mic.latched || event.at - state.mic.since < 80) return state;
    state.mic.latched = true;
    matched = Math.abs(event.midi - Math.max(...target.pitches)) <= 0.5 + 1e-9;
    wrong = !matched;
  } else {
    if (!Number.isInteger(event.midi) || event.midi < 0 || event.midi > 127) return previous;
    if (event.kind === "off") {
      delete state.held[event.midi];
      return state;
    }
    if (state.held[event.midi] != null) return state;
    state.played = event.midi;
    state.held[event.midi] = event.at;
    wrong = !target.pitches.includes(event.midi);
    const attacks = target.pitches.map((p) => state.held[p]);
    matched =
      !wrong &&
      attacks.every((at) => at != null) &&
      Math.max(...attacks) - Math.min(...attacks) <= 300;
  }
  if (wrong) {
    state.errors++;
    state.errorsByBar = {
      ...state.errorsByBar,
      [target.bar]: (state.errorsByBar[target.bar] ?? 0) + 1,
    };
    state.feedback = "wrong";
  } else if (matched) {
    state.correct++;
    state.index++;
    state.feedback = "correct";
    for (const pitch of Object.keys(state.held)) state.held[Number(pitch)] = -Infinity;
    // Keep held keys so one sustained chord cannot answer another attack.
    if (state.index === targets.length) {
      if (loop) state.index = 0;
      else state.finished = true;
    }
  }
  return state;
}
export function waitResult(state: WaitState, ended: number) {
  const attempts = state.correct + state.errors;
  return {
    accuracy: attempts ? Math.round((state.correct / attempts) * 100) : 0,
    errors: state.errors,
    seconds: Math.max(0, Math.floor((ended - state.started) / 1000)),
    bars: Object.entries(state.errorsByBar)
      .map(([bar, errors]) => ({ bar: Number(bar), errors }))
      .sort((a, b) => b.errors - a.errors || a.bar - b.bar)
      .slice(0, 3),
  };
}
