import type { VoiceId } from "./voices.ts";

/** What the staff click handler remembers between clicks. */
export type StaffPick = {
  voice: VoiceId;
  /** Start of a 选一段 or Shift range. Null after an ordinary click finishes the range. */
  anchor: number | null;
  selected: number[];
};

/** Pitches and durations only. Lyrics and expression do not move the selection. */
export function noteShapeOf(notes: readonly { pitches: readonly number[]; dur: number }[]): string {
  return notes.map((note) => `${note.pitches.join(".")}/${note.dur}`).join("|");
}

/** The voice and note shape a click's selection belongs to. */
export type SelectionOwner = {
  voice: VoiceId;
  shape: string;
};

/**
 * Keep a click's selection only while that voice's notes are still the shape
 * the click was made against. A text edit, even after a same-voice click or a
 * cross-voice click onto an equal shape, must drop indexes that no longer fit.
 */
export function selectionSurvivesEdit(
  owner: SelectionOwner | null,
  voice: VoiceId,
  shape: string,
): boolean {
  return owner != null && owner.voice === voice && owner.shape === shape;
}

/**
 * One staff click, as the editor sends it.
 * `extend` is true only while Shift is held. 选一段 is `rangeMode`:
 * two ordinary clicks (extend false) still draw a range, then the anchor clears.
 * A click on the other voice drops the previous anchor so the range cannot cross staves.
 */
export function applyStaffPick(
  state: StaffPick,
  click: { index: number; extend: boolean; voice: VoiceId },
  rangeMode: boolean,
  count: number,
): StaffPick {
  if (click.index < 0 || click.index >= count) return state;
  const crossed = click.voice !== state.voice;
  const extend = crossed ? false : click.extend;
  const anchor = crossed ? null : state.anchor;
  if (!extend && !rangeMode) {
    return { voice: click.voice, anchor: click.index, selected: [click.index] };
  }
  if (anchor == null) {
    return { voice: click.voice, anchor: click.index, selected: [click.index] };
  }
  const from = Math.min(anchor, click.index);
  const to = Math.max(anchor, click.index);
  return {
    voice: click.voice,
    anchor: extend ? anchor : null,
    selected: Array.from({ length: to - from + 1 }, (_, step) => from + step),
  };
}
