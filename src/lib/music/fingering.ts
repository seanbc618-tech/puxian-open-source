import { voiceList } from "./voices.ts";
import type { Score, ScoreNote } from "./theory.ts";

export type Finger = 1 | 2 | 3 | 4 | 5;
export type PianoHand = "right" | "left";

const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((Math.round(midi) % 12) + 12) % 12);
}

export function isFinger(value: unknown): value is Finger {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function cleanFingers(pitches: readonly number[], fingers: unknown): Finger[] | undefined {
  if (!Array.isArray(fingers) || !pitches.length) return undefined;
  const next = pitches.map((_, index) => (isFinger(fingers[index]) ? fingers[index] : undefined));
  return next.some((finger) => finger != null) ? (next as Finger[]) : undefined;
}

function handOf(voice: number, notes: readonly ScoreNote[], hasVoice2: boolean): PianoHand {
  if (hasVoice2) return voice === 1 ? "left" : "right";
  const midis = notes.flatMap((note) => note.pitches);
  if (!midis.length) return "right";
  const avg = midis.reduce((sum, midi) => sum + midi, 0) / midis.length;
  return avg < 60 ? "left" : "right";
}

function chordFingers(pitches: readonly number[], hand: PianoHand): Finger[] {
  const order = pitches.map((midi, index) => ({ midi, index })).sort((a, b) => a.midi - b.midi);
  const count = order.length;
  const shape: Finger[] =
    hand === "right"
      ? count === 1
        ? [1]
        : count === 2
          ? [1, 5]
          : count === 3
            ? [1, 3, 5]
            : count === 4
              ? [1, 2, 4, 5]
              : [1, 2, 3, 4, 5]
      : count === 1
        ? [5]
        : count === 2
          ? [5, 1]
          : count === 3
            ? [5, 3, 1]
            : count === 4
              ? [5, 3, 2, 1]
              : [5, 4, 3, 2, 1];
  const out: Finger[] = Array.from({ length: pitches.length }, () => 1);
  order.forEach((item, index) => {
    out[item.index] = shape[index] ?? (hand === "right" ? 5 : 1);
  });
  return out;
}

function preferNonThumbOnBlack(midi: number, finger: Finger, hand: PianoHand): Finger {
  if (!isBlackKey(midi) || (finger !== 1 && finger !== 5)) return finger;
  return hand === "right" ? (finger === 1 ? 2 : 4) : finger === 5 ? 4 : 2;
}

function stepMelody(prevMidi: number, prevFinger: Finger, midi: number, hand: PianoHand): Finger {
  const delta = midi - prevMidi;
  if (delta === 0) return prevFinger;
  const up = hand === "right" ? delta > 0 : delta < 0;
  // "up" means toward the fifth finger for that hand.
  if (up) {
    if (Math.abs(delta) >= 5 || prevFinger >= 4) return preferNonThumbOnBlack(midi, 1, hand);
    const next = (prevFinger + (Math.abs(delta) >= 3 ? 2 : 1)) as number;
    return preferNonThumbOnBlack(midi, (next > 5 ? 1 : next) as Finger, hand);
  }
  if (Math.abs(delta) >= 5 || prevFinger <= 2) {
    const cross: Finger = Math.abs(delta) >= 7 ? 5 : 3;
    return preferNonThumbOnBlack(midi, cross, hand);
  }
  const next = (prevFinger - (Math.abs(delta) >= 3 ? 2 : 1)) as number;
  return preferNonThumbOnBlack(midi, (next < 1 ? 3 : next) as Finger, hand);
}

function startFinger(midi: number, upcoming: number | undefined, hand: PianoHand): Finger {
  if (upcoming == null) return preferNonThumbOnBlack(midi, hand === "right" ? 1 : 5, hand);
  if (hand === "right") return preferNonThumbOnBlack(midi, upcoming < midi ? 5 : 1, hand);
  return preferNonThumbOnBlack(midi, upcoming > midi ? 5 : 1, hand);
}

/** Standard C-major-scale pattern used when a run looks like a scale. */
function scaleFinger(index: number, hand: PianoHand): Finger {
  const pattern: Finger[] = hand === "right" ? [1, 2, 3, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 3, 2, 1];
  return pattern[index % pattern.length]!;
}

function looksLikeScale(midis: number[]): boolean {
  if (midis.length < 5) return false;
  const steps = midis.slice(1).map((midi, i) => midi - midis[i]!);
  const dir = Math.sign(steps[0] ?? 0);
  if (!dir) return false;
  return steps.every((step) => Math.sign(step) === dir && Math.abs(step) <= 2);
}

function melodyFingers(notes: readonly ScoreNote[], hand: PianoHand): (Finger[] | undefined)[] {
  const singles = notes.map((note, index) => ({
    index,
    midi: note.pitches.length === 1 ? note.pitches[0]! : null,
  }));
  const run = singles.filter((item) => item.midi != null).map((item) => item.midi!) as number[];
  const useScale = looksLikeScale(run);
  let scaleAt = 0;
  let prevMidi: number | null = null;
  let prevFinger: Finger | null = null;
  return notes.map((note, index) => {
    if (!note.pitches.length) return undefined;
    if (note.pitches.length > 1) {
      prevMidi = null;
      prevFinger = null;
      return chordFingers(note.pitches, hand);
    }
    const midi = note.pitches[0]!;
    const upcoming = notes.slice(index + 1).find((item) => item.pitches.length === 1)?.pitches[0];
    let finger: Finger;
    if (useScale) {
      finger = scaleFinger(scaleAt, hand);
      scaleAt += 1;
    } else if (prevMidi == null || prevFinger == null) {
      finger = startFinger(midi, upcoming, hand);
    } else {
      finger = stepMelody(prevMidi, prevFinger, midi, hand);
    }
    prevMidi = midi;
    prevFinger = finger;
    return [finger];
  });
}

function mapVoice(notes: readonly ScoreNote[], hand: PianoHand): ScoreNote[] {
  const fingers = melodyFingers(notes, hand);
  return notes.map((note, index) => {
    const assigned = fingers[index];
    if (!assigned) {
      if (note.fingers == null) return note;
      const next = { ...note };
      delete next.fingers;
      return next;
    }
    return { ...note, fingers: assigned };
  });
}

/** Write piano fingerings 1–5 onto a copy of the score. Does not mutate the input. */
export function suggestFingering(score: Score): Score {
  const hasVoice2 = score.voice2 != null;
  const next: Score = {
    ...score,
    notes: mapVoice(score.notes, handOf(0, score.notes, hasVoice2)),
  };
  if (score.voice2) next.voice2 = mapVoice(score.voice2, handOf(1, score.voice2, true));
  if (score.extraVoices) next.extraVoices = score.extraVoices.map(v => mapVoice(v, handOf(0, v, false)));
  return next;
}

export function clearFingering(score: Score): Score {
  const strip = (notes: ScoreNote[]) =>
    notes.map((note) => {
      if (note.fingers == null) return note;
      const next = { ...note };
      delete next.fingers;
      return next;
    });
  const next: Score = { ...score, notes: strip(score.notes) };
  if (score.voice2) next.voice2 = strip(score.voice2);
  if (score.extraVoices) next.extraVoices = score.extraVoices.map(strip);
  return next;
}

export function scoreHasFingering(score: Score): boolean {
  return voiceList(score).flat().some((note) => cleanFingers(note.pitches, note.fingers));
}

export function abcFingerPrefix(note: ScoreNote | undefined, midi: number, enabled: boolean): string {
  if (!enabled || !note) return "";
  const fingers = cleanFingers(note.pitches, note.fingers);
  if (!fingers) return "";
  const index = note.pitches.indexOf(midi);
  const finger = index >= 0 ? fingers[index] : undefined;
  return isFinger(finger) ? `"_${finger}"` : "";
}
