import type { ScoreNote } from "./theory.ts";

/** 1-based bar and position inside the bar, counting rests, from the written durations. */
export function notePlace(notes: readonly ScoreNote[], index: number, beats: number, beatUnit: number) {
  const bar = Math.max(1e-6, (beats * 4) / beatUnit);
  let start = 0;
  for (let i = 0; i < index && i < notes.length; i += 1) start += notes[i].dur;
  const barIndex = Math.floor(start / bar + 1e-6);
  let nth = 1;
  let pos = start;
  for (let i = index - 1; i >= 0; i -= 1) {
    pos -= notes[i].dur;
    if (Math.floor(pos / bar + 1e-6) !== barIndex) break;
    nth += 1;
  }
  return { bar: barIndex + 1, nth };
}
