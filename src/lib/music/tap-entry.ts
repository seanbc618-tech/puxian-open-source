/**
 * Tap-to-enter keypad for numbered notation: pure editing helpers.
 * The cursor is "insert after the selected note"; nothing selected means the end.
 */
import { degreeMidi, type Score, type ScoreNote } from "./theory.ts";

export const TAP_DURATIONS: readonly { value: number; label: string }[] = [
  { value: 4, label: "全" },
  { value: 2, label: "二分" },
  { value: 1, label: "四分" },
  { value: 0.5, label: "八分" },
  { value: 0.25, label: "十六" },
];
export const TAP_OCTAVE_MIN = -2;
export const TAP_OCTAVE_MAX = 2;
export type TapAccidental = -1 | 0 | 1;

export function tapDuration(value: number, dotted: boolean): number {
  return value * (dotted ? 1.5 : 1);
}

export function clampTapOctave(octave: number): number {
  return Math.max(TAP_OCTAVE_MIN, Math.min(TAP_OCTAVE_MAX, Math.round(octave)));
}

/** Sounding pitch of a keypad digit, matching the 唱名 text box (no header). Rest (0) is null. */
export function tapPitch(
  score: Pick<Score, "key" | "mode" | "tonicOctave">,
  degree: number,
  octave: number,
  accidental: TapAccidental,
): number | null {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) return null;
  return degreeMidi(degree, accidental, clampTapOctave(octave), score.key, score.mode, score.tonicOctave);
}

/** Insert index for a selection (after its last note) or the end. */
export function tapCursor(notes: readonly ScoreNote[], selected: readonly number[]): number {
  const valid = selected.filter((i) => Number.isInteger(i) && i >= 0 && i < notes.length);
  return valid.length ? Math.max(...valid) + 1 : notes.length;
}

export function tapInsert(notes: readonly ScoreNote[], cursor: number, note: ScoreNote) {
  const at = Math.max(0, Math.min(notes.length, cursor));
  return { notes: [...notes.slice(0, at), note, ...notes.slice(at)], index: at };
}

/** Backspace: remove the note before the cursor; `index` is the new selection (or -1). */
export function tapBackspace(notes: readonly ScoreNote[], cursor: number) {
  const at = Math.max(0, Math.min(notes.length, cursor));
  if (at === 0) return null;
  return { notes: [...notes.slice(0, at - 1), ...notes.slice(at)], index: at - 2 };
}

/** Readable label for the cursor, e.g. 「第 3 个音后」. */
export function tapCursorLabel(notes: readonly ScoreNote[], cursor: number): string {
  if (!notes.length) return "从头开始";
  if (cursor >= notes.length) return "接在末尾";
  if (cursor <= 0) return "插在最前面";
  return `插在第 ${cursor} 个音后`;
}
