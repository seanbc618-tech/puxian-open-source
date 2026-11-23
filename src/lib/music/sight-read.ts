/**
 * Short sight-reading drills in the current key and meter (Sight Reading Factory idea).
 * The written score is left alone until the player explicitly writes the drill in.
 */
import { degreeMidi, degreeToken, stepsFor, tonicMidi, type KeyName, type Mode, type Score, type ScoreNote } from "./theory.ts";

export type SightDensity = "beats" | "split" | "rests";

export const SIGHT_DENSITIES = [
  { id: "beats", label: "按拍" },
  { id: "split", label: "半拍" },
  { id: "rests", label: "含休止" },
] as const satisfies readonly { id: SightDensity; label: string }[];

export const SIGHT_BARS = 2;

export function isSightDensity(value: string | null | undefined): value is SightDensity {
  return value === "beats" || value === "split" || value === "rests";
}

type Meter = { beats: number; beatUnit: number; key: KeyName; mode: Mode; tonicOctave: number };

export function barQuarters(beats: number, beatUnit: number): number {
  const unit = Number.isFinite(beatUnit) && beatUnit > 0 ? beatUnit : 4;
  const count = Number.isFinite(beats) && beats > 0 ? beats : 4;
  return count * (4 / unit);
}

export function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pulseOf(meter: Meter): number {
  return 4 / (meter.beatUnit > 0 ? meter.beatUnit : 4);
}

function scaleMidis(meter: Meter): number[] {
  return [1, 2, 3, 4, 5, 6, 7].map((degree) =>
    degreeMidi(degree, 0, 0, meter.key, meter.mode, meter.tonicOctave),
  ).concat(degreeMidi(1, 0, 1, meter.key, meter.mode, meter.tonicOctave));
}

function fillRhythm(density: SightDensity, barLen: number, pulse: number, rng: () => number): number[] {
  const half = pulse / 2;
  const out: number[] = [];
  let left = barLen;
  while (left > 1e-9) {
    const takePulse = density === "beats" || left <= pulse + 1e-9 || (left >= pulse && rng() < 0.45);
    const dur = takePulse ? Math.min(pulse, left) : Math.min(half, left);
    const snapped = Math.round(dur * 1000) / 1000;
    out.push(snapped);
    left = Math.round((left - snapped) * 1000) / 1000;
  }
  return out;
}

function pickPitch(scale: readonly number[], index: number, rng: () => number): { midi: number; index: number } {
  const jump = [-2, -1, -1, -1, 0, 1, 1, 1, 2][Math.min(8, Math.floor(rng() * 9))];
  let next = Math.max(0, Math.min(scale.length - 1, index + jump));
  if (next === index && scale.length > 1 && rng() < 0.7) {
    next = Math.max(0, Math.min(scale.length - 1, index + (rng() < 0.5 ? -1 : 1)));
  }
  return { midi: scale[next], index: next };
}

export type SightDrill = {
  seed: number;
  density: SightDensity;
  notes: ScoreNote[];
  line: string;
};

function meterOf(score: Pick<Score, "beats" | "beatUnit" | "key" | "mode" | "tonicOctave">): Meter {
  return {
    beats: score.beats,
    beatUnit: score.beatUnit,
    key: score.key,
    mode: score.mode,
    tonicOctave: score.tonicOctave,
  };
}

function formatLine(meter: Meter, notes: readonly ScoreNote[]): string {
  const barLen = barQuarters(meter.beats, meter.beatUnit);
  const bars: string[] = [];
  let current: string[] = [];
  let used = 0;
  for (const note of notes) {
    current.push(note.pitches.length ? degreeToken(note.pitches[0], meter.key, meter.mode, meter.tonicOctave) : "-");
    used += note.dur;
    if (used + 1e-9 >= barLen) {
      bars.push(current.join(" "));
      current = [];
      used = 0;
    }
  }
  if (current.length) bars.push(current.join(" "));
  return `1=${meter.key} ${meter.beats}/${meter.beatUnit}  ${bars.join(" | ")}`;
}

/**
 * Two bars of diatonic melody in the score's key and meter.
 * `rests` always includes at least one rest and one sounded note.
 */
export function generateSightRead(
  score: Pick<Score, "beats" | "beatUnit" | "key" | "mode" | "tonicOctave">,
  density: SightDensity,
  seed: number,
  bars = SIGHT_BARS,
): SightDrill {
  const meter = meterOf(score);
  const barLen = barQuarters(meter.beats, meter.beatUnit);
  const pulse = pulseOf(meter);
  const scale = scaleMidis(meter);
  const rng = createRng(seed);
  const notes: ScoreNote[] = [];
  let index = 0;
  let rests = 0;
  let sounded = 0;
  for (let bar = 0; bar < bars; bar += 1) {
    const durs = fillRhythm(density, barLen, pulse, rng);
    for (let i = 0; i < durs.length; i += 1) {
      const wantRest = density === "rests" && rng() < 0.28 && !(bar === 0 && i === 0);
      if (wantRest) {
        notes.push({ pitches: [], dur: durs[i] });
        rests += 1;
        continue;
      }
      const picked = pickPitch(scale, index, rng);
      index = picked.index;
      notes.push({ pitches: [picked.midi], dur: durs[i] });
      sounded += 1;
    }
  }
  if (density === "rests" && !rests) {
    const slot = notes.findIndex((note, i) => i > 0 && note.pitches.length);
    if (slot >= 0) {
      notes[slot] = { pitches: [], dur: notes[slot].dur };
      rests += 1;
      sounded -= 1;
    }
  }
  if (sounded === 0 && notes.length) {
    notes[0] = { pitches: [scale[0]], dur: notes[0].dur };
  }
  return { seed, density, notes, line: formatLine(meter, notes) };
}

export function sightPreviewScore(
  score: Pick<Score, "title" | "bpm" | "beats" | "beatUnit" | "key" | "mode" | "clef" | "tonicOctave">,
  notes: readonly ScoreNote[],
): Score {
  return {
    title: "视奏练习",
    bpm: score.bpm,
    beats: score.beats,
    beatUnit: score.beatUnit,
    key: score.key,
    mode: score.mode,
    clef: score.clef,
    tonicOctave: score.tonicOctave,
    notes: notes.map((note) => ({ pitches: [...note.pitches], dur: note.dur })),
  };
}

/** True when every pitch is in the written key (rests allowed). */
export function sightInKey(score: Pick<Score, "key" | "mode">, notes: readonly ScoreNote[]): boolean {
  const steps = new Set(stepsFor(score.mode));
  const tonic = tonicMidi(score.key, 0);
  return notes.every((note) =>
    note.pitches.every((midi) => steps.has((((midi - tonic) % 12) + 12) % 12)),
  );
}
