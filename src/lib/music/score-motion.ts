import { tonicMidi, type Clef, type KeyName, type Mode } from "./theory.ts";

/** What is on the staff, apart from the notes themselves. */
export type LayoutView = {
  key: KeyName;
  mode: Mode;
  clef: Clef;
  tonicOctave: number;
  /** Semitones the written staff sits above concert pitch. Concert is 0. */
  shift: number;
};

export type ScoreMotion = {
  /** Crossfade the score surface. False for the first paint, note edits, and reduced motion. */
  animate: boolean;
  /**
   * Slide distance in CSS pixels. Positive when the written pitch rose
   * (old score leaves upward, new score arrives from below).
   */
  nudge: number;
};

function anchor(view: LayoutView): number {
  return tonicMidi(view.key, view.tonicOctave) + view.shift;
}

function sameLayout(prev: LayoutView, next: LayoutView): boolean {
  return (
    prev.key === next.key &&
    prev.mode === next.mode &&
    prev.clef === next.clef &&
    prev.tonicOctave === next.tonicOctave &&
    prev.shift === next.shift
  );
}

/**
 * Decide whether a staff redraw is a transpose / instrument / clef change
 * that should move, and which way the written pitch went.
 */
export function scoreLayoutMotion(
  prev: LayoutView | null,
  next: LayoutView,
  reducedMotion: boolean,
): ScoreMotion {
  if (!prev || reducedMotion || sameLayout(prev, next)) return { animate: false, nudge: 0 };
  const delta = anchor(next) - anchor(prev);
  if (delta === 0) return { animate: true, nudge: 0 };
  const steps = Math.min(12, Math.abs(delta));
  const magnitude = Math.min(16, 6 + steps);
  return { animate: true, nudge: delta > 0 ? magnitude : -magnitude };
}
