import { voiceList } from "./voices.ts";
import { cleanFingers } from "./fingering.ts";
import { cleanLyric } from "./lyrics.ts";
import type { VoiceId } from "./voices.ts";
import {
  ARTICULATIONS,
  DYNAMIC_MARKS,
  HAIRPINS,
  ORNAMENTS,
  PC,
  PLAYABLE_HIGH,
  stepsFor,
  type Articulation,
  type DynamicMark,
  type Hairpin,
  type KeyName,
  type Mode,
  type Ornament,
  type Score,
  type ScoreNote,
} from "./theory.ts";

export const DYNAMIC_GAIN: Record<DynamicMark, number> = {
  p: 0.62,
  mp: 0.8,
  mf: 1,
  f: 1.28,
};

export const ACCENT_GAIN = 1.4;

/** Fraction of the written length that actually sounds. */
export const GATE = {
  normal: 0.92,
  staccato: 0.45,
  tenuto: 1,
  slur: 0.98,
} as const;

export type Attack = "normal" | "accent" | "legato";

export type Sounding = {
  /** Staff note this event belongs to. A grace or trill stays on the written note. */
  note: number;
  /** 0 is voice 1. Older callers can ignore this; single-voice events are 0. */
  voice: VoiceId;
  midi: number;
  /** Quarter notes from the start of the score. */
  start: number;
  /** Sounding length in quarter notes. Does not move the next note. */
  dur: number;
  /** Loudness relative to an unmarked note. */
  gain: number;
  attack: Attack;
};

export type MarkAction =
  | { type: "dynamic"; value: DynamicMark }
  | { type: "articulation"; value: Articulation }
  | { type: "ornament"; value: Ornament }
  | { type: "slur" }
  | { type: "hairpin"; value: Hairpin }
  | { type: "clear" };

export type Span = { from: number; to: number };

const ART_ORDER: Articulation[] = ["staccato", "accent", "tenuto"];

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function isDynamicMark(value: unknown): value is DynamicMark {
  return (DYNAMIC_MARKS as readonly string[]).includes(value as string);
}

export function isArticulation(value: unknown): value is Articulation {
  return (ARTICULATIONS as readonly string[]).includes(value as string);
}

export function isOrnament(value: unknown): value is Ornament {
  return (ORNAMENTS as readonly string[]).includes(value as string);
}

export function isHairpin(value: unknown): value is Hairpin {
  return (HAIRPINS as readonly string[]).includes(value as string);
}

/** Drops anything the staff, playback, and MusicXML do not know how to keep. */
export function cleanNote(note: ScoreNote): ScoreNote {
  const next: ScoreNote = { pitches: note.pitches.slice(), dur: note.dur };
  if (isDynamicMark(note.dynamic)) next.dynamic = note.dynamic;
  if (isHairpin(note.hairpin)) next.hairpin = note.hairpin;
  if (note.hairpinEnd === true) next.hairpinEnd = true;
  if (note.slurStart === true) next.slurStart = true;
  if (note.slurEnd === true) next.slurEnd = true;
  if (Array.isArray(note.articulations)) {
    const arts = ART_ORDER.filter((item) => note.articulations?.some((art) => art === item));
    if (arts.length) next.articulations = arts;
  }
  // A roll needs at least two tones to spread.
  if (isOrnament(note.ornament) && (note.ornament !== "arpeggio" || next.pitches.length > 1)) next.ornament = note.ornament;
  if (
    (next.ornament === "grace" || next.ornament === "appoggiatura") &&
    typeof note.gracePitch === "number" &&
    Number.isFinite(note.gracePitch)
  ) {
    const pitch = Math.round(note.gracePitch);
    if (pitch >= 0 && pitch <= 127) next.gracePitch = pitch;
  }
  const lyric = next.pitches.length ? cleanLyric(note.lyric) : undefined;
  if (lyric) next.lyric = lyric;
  const fingers = cleanFingers(next.pitches, note.fingers);
  if (fingers) next.fingers = fingers;
  return next;
}

export function cleanScore(score: Score): Score {
  const next: Score = { ...score, notes: score.notes.map(cleanNote) };
  if (score.voice2 == null) delete next.voice2;
  else next.voice2 = score.voice2.map(cleanNote);
  if (score.extraVoices) next.extraVoices = score.extraVoices.map(v => v.map(cleanNote));
  return next;
}

function samePitches(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index]);
}

/**
 * Keep expression when a text parse comes back with the same pitches and lengths.
 * An inserted or rewritten note drops every mark, so a shifted slur cannot stick.
 */
export function retainMarks(prev: ScoreNote[], next: ScoreNote[]): ScoreNote[] {
  if (prev.length !== next.length) return next;
  for (let i = 0; i < prev.length; i += 1) {
    if (Math.abs(prev[i].dur - next[i].dur) > 1e-9) return next;
    if (!samePitches(prev[i].pitches, next[i].pitches)) return next;
  }
  return next.map((note, index) => {
    const kept = cleanNote(prev[index]);
    return { ...kept, pitches: note.pitches.slice(), dur: note.dur };
  });
}

/** Slur and hairpin endpoints only. Per-note dynamics and articulations stay. */
export function withoutSpans(note: ScoreNote): ScoreNote {
  if (!note.slurStart && !note.slurEnd && !note.hairpin && !note.hairpinEnd) return note;
  const next: ScoreNote = { ...note, pitches: note.pitches.slice() };
  delete next.slurStart;
  delete next.slurEnd;
  delete next.hairpin;
  delete next.hairpinEnd;
  if (next.articulations) next.articulations = next.articulations.slice();
  return next;
}

export function slurPairs(notes: ScoreNote[]): Span[] {
  const pairs: Span[] = [];
  let open: number | null = null;
  notes.forEach((note, index) => {
    if (note.slurEnd && open != null) {
      pairs.push({ from: open, to: index });
      open = null;
    }
    if (note.slurStart) open = index;
  });
  return pairs;
}

export function hairpinPairs(notes: ScoreNote[]): Span[] {
  const pairs: Span[] = [];
  let open: number | null = null;
  notes.forEach((note, index) => {
    if (note.hairpinEnd && open != null) {
      pairs.push({ from: open, to: index });
      open = null;
    }
    if (note.hairpin) open = index;
  });
  return pairs;
}

/**
 * Hairpin that closes on this note.
 * A note may end one wedge and start the next. That new start is the opener
 * for the following end; it is not an earlier close.
 */
export function closingHairpin(notes: ScoreNote[], index: number): Hairpin | null {
  if (!notes[index]?.hairpinEnd) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (notes[i]?.hairpin) return notes[i].hairpin ?? null;
    if (notes[i]?.hairpinEnd) return null;
  }
  return null;
}

/** Next scale step up. A chromatic note still steps to the following scale tone. */
export function upperNeighbor(midi: number, key: KeyName, mode: Mode): number {
  const rounded = Math.round(midi);
  const steps = stepsFor(mode);
  const tonic = PC[key];
  for (let cursor = rounded + 1; cursor <= rounded + 4; cursor += 1) {
    if (cursor > PLAYABLE_HIGH) break;
    if (steps.includes(mod12(cursor - tonic))) return cursor;
  }
  return Math.min(PLAYABLE_HIGH, rounded + 1);
}

export function gracePitchOf(note: ScoreNote, key: KeyName, mode: Mode): number | null {
  if ((note.ornament !== "grace" && note.ornament !== "appoggiatura") || !note.pitches.length) {
    return null;
  }
  if (typeof note.gracePitch === "number") return note.gracePitch;
  return upperNeighbor(Math.max(...note.pitches), key, mode);
}

function sortedSelection(notes: ScoreNote[], selected: number[]): number[] {
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const index of selected) {
    if (!Number.isInteger(index) || index < 0 || index >= notes.length || seen.has(index)) continue;
    seen.add(index);
    indexes.push(index);
  }
  indexes.sort((a, b) => a - b);
  return indexes;
}

function contiguous(indexes: number[]): boolean {
  for (let i = 1; i < indexes.length; i += 1) {
    if (indexes[i] !== indexes[0] + i) return false;
  }
  return indexes.length > 0;
}

function cloneNotes(notes: ScoreNote[]): ScoreNote[] {
  return notes.map((note) => {
    const next: ScoreNote = { ...note, pitches: note.pitches.slice() };
    if (note.articulations) next.articulations = note.articulations.slice();
    return next;
  });
}

function changed(prev: ScoreNote[], next: ScoreNote[]): boolean {
  if (prev.length !== next.length) return true;
  return next.some(
    (note, index) => JSON.stringify(cleanNote(note)) !== JSON.stringify(cleanNote(prev[index])),
  );
}

function clearFlag(note: ScoreNote, key: "slurStart" | "slurEnd" | "hairpin" | "hairpinEnd") {
  delete note[key];
}

function dropPairs(
  notes: ScoreNote[],
  pairs: Span[],
  selected: Set<number>,
  kind: "slur" | "hairpin",
) {
  for (const pair of pairs) {
    if (!selected.has(pair.from) && !selected.has(pair.to)) continue;
    if (kind === "slur") {
      clearFlag(notes[pair.from], "slurStart");
      clearFlag(notes[pair.to], "slurEnd");
    } else {
      clearFlag(notes[pair.from], "hairpin");
      clearFlag(notes[pair.to], "hairpinEnd");
    }
  }
}

function overlaps(pair: Span, span: Span): boolean {
  return pair.from < span.to && pair.to > span.from;
}

function soundingSpan(notes: ScoreNote[], indexes: number[]): Span | null {
  if (!contiguous(indexes) || indexes.length < 2) return null;
  const sounding = indexes.filter((index) => notes[index].pitches.length);
  if (sounding.length < 2) return null;
  const from = sounding[0];
  const to = sounding[sounding.length - 1];
  if (from == null || to == null || to <= from) return null;
  return { from, to };
}

export function applyMark(notes: ScoreNote[], selected: number[], action: MarkAction): ScoreNote[] {
  const indexes = sortedSelection(notes, selected);
  if (!indexes.length) return notes;
  const next = cloneNotes(notes.map(cleanNote));

  if (action.type === "clear") {
    const picked = new Set(indexes);
    dropPairs(next, slurPairs(next), picked, "slur");
    dropPairs(next, hairpinPairs(next), picked, "hairpin");
    for (const index of indexes) {
      const note = next[index];
      delete note.dynamic;
      delete note.articulations;
      delete note.ornament;
      delete note.gracePitch;
    }
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }

  if (action.type === "dynamic") {
    const index = indexes[0];
    if (next[index].dynamic === action.value) delete next[index].dynamic;
    else next[index].dynamic = action.value;
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }

  if (action.type === "articulation") {
    const sounding = indexes.filter((index) => next[index].pitches.length);
    if (!sounding.length) return notes;
    const every = sounding.every((index) => next[index].articulations?.includes(action.value));
    for (const index of sounding) {
      const current = next[index].articulations ?? [];
      const arts = every
        ? current.filter((item) => item !== action.value)
        : ART_ORDER.filter((item) => item === action.value || current.includes(item));
      if (arts.length) next[index].articulations = arts;
      else delete next[index].articulations;
    }
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }

  if (action.type === "ornament") {
    const sounding = indexes.filter((index) => next[index].pitches.length > (action.value === "arpeggio" ? 1 : 0));
    if (!sounding.length) return notes;
    const every = sounding.every((index) => next[index].ornament === action.value);
    for (const index of sounding) {
      if (every) {
        delete next[index].ornament;
        delete next[index].gracePitch;
      } else {
        next[index].ornament = action.value;
        delete next[index].gracePitch;
      }
    }
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }

  if (action.type === "slur") {
    const span = soundingSpan(next, indexes);
    if (!span) return notes;
    const pairs = slurPairs(next);
    const exact = pairs.find((pair) => pair.from === span.from && pair.to === span.to);
    if (exact) {
      clearFlag(next[exact.from], "slurStart");
      clearFlag(next[exact.to], "slurEnd");
      return changed(notes, next) ? next.map(cleanNote) : notes;
    }
    for (const pair of pairs) {
      if (!overlaps(pair, span)) continue;
      clearFlag(next[pair.from], "slurStart");
      clearFlag(next[pair.to], "slurEnd");
    }
    next[span.from].slurStart = true;
    next[span.to].slurEnd = true;
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }

  if (!contiguous(indexes) || indexes.length < 2) return notes;
  const span = { from: indexes[0], to: indexes[indexes.length - 1] };
  const pairs = hairpinPairs(next);
  const exact = pairs.find((pair) => pair.from === span.from && pair.to === span.to);
  if (exact && next[exact.from].hairpin === action.value) {
    clearFlag(next[exact.from], "hairpin");
    clearFlag(next[exact.to], "hairpinEnd");
    return changed(notes, next) ? next.map(cleanNote) : notes;
  }
  for (const pair of pairs) {
    if (!overlaps(pair, span)) continue;
    clearFlag(next[pair.from], "hairpin");
    clearFlag(next[pair.to], "hairpinEnd");
  }
  next[span.from].hairpin = action.value;
  next[span.to].hairpinEnd = true;
  return changed(notes, next) ? next.map(cleanNote) : notes;
}

/** Per-note loudness after dynamics, hairpins, and accents. Unmarked notes stay at 1. */
export function noteGains(score: Score): number[] {
  const notes = score.notes.map(cleanNote);
  const gains = notes.map(() => 1);
  const starts: number[] = [];
  let cursor = 0;
  for (const note of notes) {
    starts.push(cursor);
    cursor += note.dur;
  }
  const opening = new Map<number, Span>();
  for (const pair of hairpinPairs(notes)) opening.set(pair.from, pair);

  let running = 1;
  let active: { span: Span; fromGain: number; toGain: number } | null = null;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    if (note.dynamic) running = DYNAMIC_GAIN[note.dynamic];
    let gain = running;
    if (active && i >= active.span.from && i <= active.span.to) {
      const t0 = starts[active.span.from];
      const t1 = starts[active.span.to];
      const mix = t1 <= t0 ? 1 : (starts[i] - t0) / (t1 - t0);
      gain = active.fromGain + (active.toGain - active.fromGain) * mix;
    }
    if (active && i === active.span.to) {
      running = active.toGain;
      active = null;
    }
    const begin = opening.get(i);
    if (begin && i !== begin.to) {
      const endDynamic = notes[begin.to]?.dynamic;
      const destination: number = endDynamic
        ? DYNAMIC_GAIN[endDynamic]
        : notes[begin.from].hairpin === "dim"
          ? DYNAMIC_GAIN.p
          : DYNAMIC_GAIN.f;
      const fromGain: number = i === begin.from && active == null ? gain : running;
      active = { span: begin, fromGain, toGain: destination };
      if (i === begin.from) gain = fromGain;
    }
    if (note.articulations?.includes("accent")) gain *= ACCENT_GAIN;
    gains[i] = gain;
  }
  return gains;
}

function gateOf(note: ScoreNote, slurred: boolean): number {
  if (note.articulations?.includes("staccato")) return GATE.staccato;
  if (note.articulations?.includes("tenuto")) return GATE.tenuto;
  if (slurred) return GATE.slur;
  return GATE.normal;
}

function slurredAt(notes: ScoreNote[]): boolean[] {
  const flags = notes.map(() => false);
  for (const pair of slurPairs(notes)) {
    for (let i = pair.from; i <= pair.to; i += 1) flags[i] = true;
  }
  return flags;
}

function eventsForVoice(score: Score, source: ScoreNote[], voice: VoiceId): Sounding[] {
  const notes = source.map(cleanNote);
  const gains = noteGains({ ...score, notes });
  const slurred = slurredAt(notes);
  const events: Sounding[] = [];
  let start = 0;
  notes.forEach((note, index) => {
    if (!note.pitches.length) {
      start += note.dur;
      return;
    }
    const sound = note.dur * gateOf(note, slurred[index]);
    const staccato = note.articulations?.includes("staccato") ?? false;
    const attack: Attack = note.articulations?.includes("accent")
      ? "accent"
      : slurred[index] && !staccato
        ? "legato"
        : "normal";
    const gain = gains[index] ?? 1;
    const top = Math.max(...note.pitches);
    const push = (event: Omit<Sounding, "note" | "voice">) => {
      events.push({ note: index, voice, ...event });
    };
    if (note.ornament === "grace" || note.ornament === "appoggiatura") {
      const crushed = note.ornament === "grace";
      const grace = note.gracePitch ?? upperNeighbor(top, score.key, score.mode);
      const graceDur = crushed ? Math.min(0.12, Math.max(0.05, sound * 0.3)) : sound * 0.5;
      const mainDur = Math.max(0.04, sound - graceDur);
      push({
        midi: grace,
        start,
        dur: graceDur,
        gain: crushed ? gain * 0.85 : gain,
        attack: "normal",
      });
      for (const midi of note.pitches) {
        push({ midi, start: start + graceDur, dur: mainDur, gain, attack });
      }
    } else if (note.ornament === "arpeggio" && note.pitches.length > 1) {
      // Rolled upward inside the written length; every tone still ends together.
      const sorted = [...note.pitches].sort((a, b) => a - b);
      const step = Math.min(0.08, (sound * 0.5) / sorted.length);
      sorted.forEach((midi, k) => {
        push({ midi, start: start + k * step, dur: Math.max(0.04, sound - k * step), gain, attack: k === 0 ? attack : "normal" });
      });
    } else if (note.ornament === "trill") {
      const neighbor = upperNeighbor(top, score.key, score.mode);
      let count = Math.max(4, Math.round(sound / 0.12));
      if (count % 2 === 0) count += 1;
      const each = sound / count;
      for (let step = 0; step < count; step += 1) {
        push({
          midi: step % 2 === 0 ? top : neighbor,
          start: start + step * each,
          dur: each,
          gain,
          attack: step === 0 ? attack : "normal",
        });
      }
      for (const midi of note.pitches) {
        if (midi === top) continue;
        push({ midi, start, dur: sound, gain, attack });
      }
    } else {
      for (const midi of note.pitches) {
        push({ midi, start, dur: sound, gain, attack });
      }
    }
    start += note.dur;
  });
  return events;
}

/**
 * Notes the synth should play, in independent voice order.
 * Each voice keeps its own onset. Grace and trill notes sit inside the written duration.
 */
export function soundingEvents(score: Score): Sounding[] {
  return voiceList(score).flatMap((notes, voice) => eventsForVoice(score, notes, voice));
}
