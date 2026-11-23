import type { PlaybackPlan } from "./playback.ts";
export type PracticeHand = "both" | "right" | "left";
export type OtherHand = "mute" | "quiet";
/** Voice 3 onward follows the accompaniment bus, never becomes a practice target. */
export function isPracticeVoice(voice: number, hand: PracticeHand): boolean {
  return hand === "both" ? voice < 2 : voice === (hand === "right" ? 0 : 1);
}
/** Preserve timing, clicks and score length; only alter the note bus. */
export function handPlaybackPlan(
  plan: PlaybackPlan,
  hand: PracticeHand = "both",
  other: OtherHand = "mute",
): PlaybackPlan {
  if (hand === "both") return plan;
  return {
    ...plan,
    events: plan.events.flatMap((event) =>
      isPracticeVoice(event.voice, hand)
        ? [{ ...event }]
        : other === "quiet"
          ? [{ ...event, gain: event.gain * 0.3 }]
          : [],
    ),
  };
}
