import type { Score } from "./theory.ts";
/** Beat 1 of the bar. Other beats use {@link OFFBEAT_LEVEL}. */
export const DOWNBEAT_LEVEL = 1;
/** Quieter than the downbeat so the bar is easy to hear. */
export const OFFBEAT_LEVEL = 0.45;

export type BeatClick = {
  /** Quarter notes from the start. The score begins on beat 1. */
  quarter: number;
  /** Seconds from the musical start. This does not include the audio lead-in. */
  seconds: number;
  /** 0-based beat inside the bar. */
  beat: number;
  accent: boolean;
  /** Envelope peak before the user's volume. */
  level: number;
};

export type TimedNote = {
  dur: number;
  pitches: readonly number[];
};

/**
 * Seconds in one quarter note.
 * Matches playback: a tempo at or below 0, or a tempo that is not a number, counts as 1 BPM.
 */
export function quarterSeconds(bpm: number): number {
  if (!Number.isFinite(bpm)) return 60;
  return 60 / Math.max(1, bpm);
}

/** Integral of quarter-note tempo; no denominator scaling. */
export function secondsAt(score: Pick<Score, 'bpm' | 'changes'>, at: number): number {
  let q = 0, seconds = 0, bpm = score.bpm;
  for (const c of score.changes ?? []) {
    if (c.at > at) break;
    if (c.bpm === undefined) continue;
    seconds += (c.at-q)*quarterSeconds(bpm); q = c.at; bpm = c.bpm;
  }
  return seconds + (at-q)*quarterSeconds(bpm);
}
export function quarterAtSeconds(score: Pick<Score, 'bpm' | 'changes'>, seconds: number): number {
  let q = 0, elapsed = 0, bpm = score.bpm;
  for (const c of score.changes ?? []) {
    if (c.bpm === undefined) continue;
    const end = elapsed + (c.at-q)*quarterSeconds(bpm);
    if (end > seconds) break;
    q = c.at; elapsed = end; bpm = c.bpm;
  }
  return q + (seconds-elapsed)/quarterSeconds(bpm);
}

/** Written length in quarter notes. A non-number duration does not move the end. */
export function writtenQuarters(notes: readonly { dur: number }[]): number {
  let sum = 0;
  for (const note of notes) {
    if (Number.isFinite(note.dur)) sum += note.dur;
  }
  return sum;
}

function beatsPerBar(beats: number): number {
  if (!Number.isFinite(beats) || beats < 1) return 4;
  const rounded = Math.round(beats);
  return rounded >= 1 ? rounded : 4;
}

function beatUnitOf(beatUnit: number): number {
  if (
    beatUnit === 1 ||
    beatUnit === 2 ||
    beatUnit === 4 ||
    beatUnit === 8 ||
    beatUnit === 16 ||
    beatUnit === 32
  ) {
    return beatUnit;
  }
  return 4;
}

/** Length of one written beat, in quarter notes. An unknown beat unit counts as a quarter. */
export function beatQuarters(beatUnit: number): number {
  return 4 / beatUnitOf(beatUnit);
}

/**
 * One click for each beat that starts before the music ends.
 * The click on the final barline is left out: that beat belongs to the next bar.
 */
export function scheduleBeats(input: {
  bpm: number;
  beats: number;
  beatUnit: number;
  quarters: number;
  changes?: Score["changes"];
}): BeatClick[] {
  const quarters = input.quarters;
  if (!Number.isFinite(quarters) || quarters <= 0) return [];
  const clicks: BeatClick[] = [];
  const meters = [{ at: 0, beats: input.beats, beatUnit: input.beatUnit }, ...(input.changes ?? []).filter(c => c.beats !== undefined)];
  meters.forEach((meter, index) => {
    const end = Math.min(quarters, meters[index+1]?.at ?? quarters);
    const beatQ = beatQuarters(meter.beatUnit!);
    for (let i = 0; meter.at + i * beatQ < end - 1e-9; i++) {
      const quarter = meter.at + i * beatQ;
      const beat = i % beatsPerBar(meter.beats!);
      clicks.push({ quarter, seconds: secondsAt(input, quarter), beat, accent: beat === 0, level: beat === 0 ? DOWNBEAT_LEVEL : OFFBEAT_LEVEL });
    }
  });
  return clicks;
}

/**
 * Written slot under a quarter-note position.
 * A rest is null. The instant a note ends belongs to the next note.
 * This is not the playback cursor: a staccato still fills its written length here.
 * The sounding cursor is {@link followNoteAt}.
 */
export function noteAtQuarter(notes: readonly TimedNote[], quarter: number): number | null {
  if (!Number.isFinite(quarter) || quarter < 0) return null;
  let cursor = 0;
  for (let index = 0; index < notes.length; index += 1) {
    const dur = notes[index].dur;
    if (!Number.isFinite(dur)) continue;
    const end = cursor + dur;
    if (dur > 0 && quarter >= cursor && quarter < end) {
      return notes[index].pitches.length ? index : null;
    }
    cursor = end;
  }
  return null;
}

export type FollowEvent = {
  /** Staff note index. Grace and trill events use the written note. */
  note: number;
  start: number;
  dur: number;
  /** Absent or 0 is voice 1. 1 is voice 2. */
  voice?: number;
};

export type FollowSlot = {
  voice: number;
  note: number;
};

/**
 * Staff note that is actually sounding at `quarter`.
 * The windows are the synth events, so a staccato goes dark when its sound ends
 * instead of waiting out the written length. Nothing sounding is null.
 */
function eventSounds(event: FollowEvent, quarter: number): boolean {
  if (!Number.isFinite(event.start) || !Number.isFinite(event.dur) || !(event.dur > 0))
    return false;
  if (!Number.isInteger(event.note) || event.note < 0) return false;
  return quarter >= event.start && quarter < event.start + event.dur;
}

/**
 * Voice 1 staff note that is actually sounding at `quarter`.
 * Voice 2 does not steal this index. The windows are the synth events, so a
 * staccato goes dark when its sound ends instead of waiting out the written length.
 */
export function followNoteAt(events: readonly FollowEvent[], quarter: number): number | null {
  if (!Number.isFinite(quarter) || quarter < 0) return null;
  let found: number | null = null;
  for (const event of events) {
    if ((event.voice ?? 0) > 0) continue;
    if (eventSounds(event, quarter)) found = event.note;
  }
  return found;
}

/** Every voice that is sounding at `quarter`. A chord is one slot, not one per pitch. */
export function followSlotsAt(events: readonly FollowEvent[], quarter: number): FollowSlot[] {
  if (!Number.isFinite(quarter) || quarter < 0) return [];
  const seen = new Set<string>();
  const slots: FollowSlot[] = [];
  for (const event of events) {
    if (!eventSounds(event, quarter)) continue;
    const voice = event.voice ?? 0;
    const key = `${voice}:${event.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ voice, note: event.note });
  }
  return slots;
}

/**
 * Expression selection and the follow fill are separate marks.
 * Clearing the fill does not clear a note the user selected.
 */
export function staffFollowMarks(
  index: number | null,
  selected: readonly number[],
  sounding: number | null,
): { chosen: boolean; sounding: boolean } {
  if (index == null) return { chosen: false, sounding: false };
  return {
    chosen: selected.includes(index),
    sounding: sounding === index,
  };
}
