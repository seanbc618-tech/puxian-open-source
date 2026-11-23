import type { Score } from "./theory.ts";
import type { FollowSlot } from "./playback-clock.ts";
import { isBlackKey, isFinger } from "./fingering.ts";
export type KeyboardHand = "both" | "right" | "left";
/** Score pitches are already concert / transposed pitches, never add the instrument's written offset. */
export function keyboardNotes(
  score: Pick<Score, "notes" | "voice2">,
  slots: readonly FollowSlot[],
  hand: KeyboardHand = "both",
  fingers = false,
  transposed = false,
) {
  return slots.flatMap((slot) => {
    if (slot.voice !== 0 && slot.voice !== 1) return [];
    if ((hand === "right" && slot.voice !== 0) || (hand === "left" && slot.voice !== 1)) return [];
    const note = (slot.voice === 1 ? score.voice2 : score.notes)?.[slot.note];
    return (note?.pitches ?? [])
      .filter((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127)
      .map((midi) => {
        const finger = note?.fingers?.[note.pitches.indexOf(midi)];
        return {
          midi,
          voice: slot.voice,
          finger: fingers && !transposed && isFinger(finger) ? finger : undefined,
        };
      });
  });
}
export function keyboardRange(score: Pick<Score, "notes" | "voice2">) {
  const pitches = [...score.notes, ...(score.voice2 ?? [])]
    .flatMap((n) => n.pitches)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 127);
  let low = 48;
  let high = 72;
  if (pitches.length) {
    low = 127;
    high = 0;
    for (const midi of pitches) {
      low = Math.min(low, midi);
      high = Math.max(high, midi);
    }
  }
  while (high - low < 24) {
    if (low > 0) low--;
    if (high < 127) high++;
  }
  while (isBlackKey(low)) low--;
  while (isBlackKey(high)) high++;
  return { low, high };
}
